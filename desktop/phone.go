// Phone access: the Windows app serves OptionPulse to an iPhone or Android phone on the same Wi-Fi.
//
//   - A second listener on every network interface (port 47812) serves the same app files and the
//     same /api/* endpoints, so broker calls still leave from this PC's internet connection (the
//     static IP the broker has on file).
//   - A phone pairs once with a 6-digit code shown on the PC (or by scanning a QR code). It then gets
//     its own long random token in its app address (http://<pc-ip>:47812/p/<token>/) and sends the
//     token with every API call. The home-screen bookmark keeps the token, so iPhone's separate
//     storage for home-screen apps is not a problem.
//   - Logins and settings are shared between the PC and the paired phones through /api/session.
//   - While phone access is on, the launcher keeps running after the PC window closes and starts with
//     Windows, so the phone can connect whenever the PC is on.
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	phonePort       = 47812
	pairCodeTTL     = 10 * time.Minute
	pairMaxAttempts = 5
	maxPhones       = 10
	phoneHeader     = "X-OP-Phone"
)

type phoneDevice struct {
	Hash     string    `json:"hash"` // SHA-256 of the device token (the token itself lives only on the phone)
	Name     string    `json:"name"`
	Added    time.Time `json:"added"`
	LastSeen time.Time `json:"lastSeen"`
}

type phoneConfig struct {
	Enabled bool          `json:"enabled"`
	Devices []phoneDevice `json:"devices"`
}

type sessionFile struct {
	Rev  int             `json:"rev"`
	Data json.RawMessage `json:"data"`
}

func phoneConfigPath() string { return filepath.Join(dataDir(), "phones.json") }
func sessionPath() string     { return filepath.Join(dataDir(), "session.json") }

func (s *server) loadPhoneState() {
	if b, err := os.ReadFile(phoneConfigPath()); err == nil {
		_ = json.Unmarshal(b, &s.phone)
	}
	if b, err := os.ReadFile(sessionPath()); err == nil {
		var f sessionFile
		if json.Unmarshal(b, &f) == nil && len(f.Data) > 0 {
			s.session, s.sessionRev = f.Data, f.Rev
		}
	}
}

// Callers hold s.mu.
func (s *server) savePhoneConfigLocked() {
	_ = os.MkdirAll(dataDir(), 0o700)
	b, _ := json.MarshalIndent(s.phone, "", "  ")
	_ = os.WriteFile(phoneConfigPath(), b, 0o600)
}

func (s *server) saveSessionLocked() {
	_ = os.MkdirAll(dataDir(), 0o700)
	b, _ := json.Marshal(sessionFile{Rev: s.sessionRev, Data: s.session})
	_ = os.WriteFile(sessionPath(), b, 0o600)
}

// ---------- Listener ----------

func (s *server) startPhoneListener() error {
	s.mu.Lock()
	if s.phoneLn != nil {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", phonePort))
	if err != nil {
		return fmt.Errorf("port %d is used by another program: %v", phonePort, err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(s.servePhone), ReadHeaderTimeout: 10 * time.Second}
	s.mu.Lock()
	s.phoneLn, s.phoneSrv = ln, srv
	s.mu.Unlock()
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("phone listener: %v", err)
		}
		s.mu.Lock()
		if s.phoneLn == ln {
			s.phoneLn, s.phoneSrv = nil, nil
		}
		s.mu.Unlock()
	}()
	log.Printf("phone access listening on :%d", phonePort)
	return nil
}

func (s *server) stopPhoneListener() {
	s.mu.Lock()
	srv := s.phoneSrv
	s.phoneLn, s.phoneSrv = nil, nil
	s.mu.Unlock()
	if srv != nil {
		_ = srv.Close()
	}
}

// localAddresses lists this PC's IPv4 addresses, the one on the default route first.
func localAddresses() (primary string, all []string) {
	seen := map[string]bool{}
	if c, err := net.Dial("udp4", "8.8.8.8:53"); err == nil { // no packet is sent; only picks the outgoing interface
		if a, ok := c.LocalAddr().(*net.UDPAddr); ok && a.IP != nil && !a.IP.IsLoopback() {
			primary = a.IP.String()
		}
		c.Close()
	}
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipn.IP.To4()
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
				continue
			}
			if !seen[ip.String()] {
				seen[ip.String()] = true
				all = append(all, ip.String())
			}
		}
	}
	sort.SliceStable(all, func(i, j int) bool { // home Wi-Fi ranges first
		return strings.HasPrefix(all[i], "192.168.") && !strings.HasPrefix(all[j], "192.168.")
	})
	if primary == "" && len(all) > 0 {
		primary = all[0]
	}
	if primary != "" {
		rest := []string{primary}
		for _, a := range all {
			if a != primary {
				rest = append(rest, a)
			}
		}
		all = rest
	}
	return primary, all
}

// phoneHostOK accepts only requests addressed to this PC by one of its own addresses (blocks DNS rebinding).
func (s *server) phoneHostOK(hostport string) bool {
	host, port, err := net.SplitHostPort(hostport)
	if err != nil || port != fmt.Sprint(phonePort) {
		return false
	}
	host = strings.ToLower(strings.Trim(host, "[]"))
	if hn, err := os.Hostname(); err == nil && hn != "" {
		hn = strings.ToLower(hn)
		if host == hn || host == hn+".local" {
			return true
		}
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	s.mu.Lock()
	if time.Since(s.localIPsAt) > 5*time.Second {
		_, s.localIPs = localAddresses()
		s.localIPsAt = time.Now()
	}
	ips := s.localIPs
	s.mu.Unlock()
	for _, a := range ips {
		if a == ip.String() {
			return true
		}
	}
	return false
}

// ---------- Pairing ----------

func (s *server) newPairCodeLocked() {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	n := (uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])) % 1_000_000
	s.pairCode, s.pairExpiry, s.pairTries = fmt.Sprintf("%06d", n), time.Now().Add(pairCodeTTL), 0
}

func tokenHash(tok string) string {
	h := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(h[:])
}

func validToken(tok string) bool {
	if len(tok) < 16 || len(tok) > 64 {
		return false
	}
	for _, c := range tok {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

// deviceFor returns the paired device that owns the token (constant-time compare on the hash).
func (s *server) deviceFor(tok string) *phoneDevice {
	if !validToken(tok) {
		return nil
	}
	want := []byte(tokenHash(tok))
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.phone.Devices {
		if subtle.ConstantTimeCompare([]byte(s.phone.Devices[i].Hash), want) == 1 {
			return &s.phone.Devices[i]
		}
	}
	return nil
}

func (s *server) touchDevice(tok string) {
	hash := tokenHash(tok)
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.phone.Devices {
		if s.phone.Devices[i].Hash == hash {
			if time.Since(s.phone.Devices[i].LastSeen) > time.Minute {
				s.phone.Devices[i].LastSeen = time.Now()
				s.savePhoneConfigLocked()
			}
			s.lastPing = time.Now() // a phone counts as an open window
			return
		}
	}
}

// tryPair checks a code typed on the phone; on success the phone gets its own token.
func (s *server) tryPair(code, ua string) (token string, msg string) {
	code = strings.TrimSpace(code)
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.pairCode == "" || time.Now().After(s.pairExpiry):
		return "", "No pairing code is active. On your PC open Settings → iPhone & other phones → Pair a phone."
	case s.pairTries >= pairMaxAttempts:
		s.pairCode = ""
		return "", "Too many wrong attempts. Get a new code on your PC."
	case len(code) != 6 || subtle.ConstantTimeCompare([]byte(code), []byte(s.pairCode)) != 1:
		s.pairTries++
		return "", fmt.Sprintf("That code is not right (%d attempts left).", pairMaxAttempts-s.pairTries)
	}
	s.pairCode = ""
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	name := deviceName(ua)
	s.phone.Devices = append(s.phone.Devices, phoneDevice{Hash: tokenHash(token), Name: name, Added: time.Now(), LastSeen: time.Now()})
	if len(s.phone.Devices) > maxPhones {
		s.phone.Devices = s.phone.Devices[len(s.phone.Devices)-maxPhones:]
	}
	s.savePhoneConfigLocked()
	log.Printf("phone paired: %s", name)
	return token, ""
}

func deviceName(ua string) string {
	switch {
	case strings.Contains(ua, "iPhone"):
		return "iPhone"
	case strings.Contains(ua, "iPad"):
		return "iPad"
	case strings.Contains(ua, "Android"):
		return "Android phone"
	case strings.Contains(ua, "Macintosh"):
		return "Mac"
	case strings.Contains(ua, "Windows"):
		return "Windows PC"
	}
	return "Phone"
}

// ---------- Phone listener handler ----------

func (s *server) servePhone(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	enabled := s.phone.Enabled
	s.mu.Unlock()
	if !enabled || !s.phoneHostOK(r.Host) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Content-Security-Policy", "frame-ancestors 'none'")
	h.Set("Referrer-Policy", "no-referrer")

	p := r.URL.Path
	switch {
	case p == "/" || p == "/pair":
		s.pairHandler(w, r)
	case strings.HasPrefix(p, "/api/"):
		tok := r.Header.Get(phoneHeader)
		if s.deviceFor(tok) == nil || !trustedPostFrom(r, "http://"+r.Host) {
			http.Error(w, "not paired", http.StatusForbidden)
			return
		}
		s.touchDevice(tok)
		s.api(w, r, true)
	case strings.HasPrefix(p, "/p/"):
		rest := strings.TrimPrefix(p, "/p/")
		tok, sub, hasSlash := strings.Cut(rest, "/")
		if s.deviceFor(tok) == nil {
			pairPage(w, http.StatusForbidden, "This phone is not paired any more. Pair it again with a new code from your PC.", "")
			return
		}
		if !hasSlash {
			http.Redirect(w, r, p+"/", http.StatusFound) // relative asset paths need the trailing slash
			return
		}
		s.touchDevice(tok)
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + sub
		s.serveStatic(w, r2)
	default:
		http.NotFound(w, r)
	}
}

func (s *server) pairHandler(w http.ResponseWriter, r *http.Request) {
	code := ""
	switch r.Method {
	case http.MethodGet:
		code = r.URL.Query().Get("code") // from the QR code
	case http.MethodPost:
		if err := r.ParseForm(); err == nil {
			code = r.PostForm.Get("code")
		}
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if code == "" {
		pairPage(w, 200, "", "")
		return
	}
	tok, msg := s.tryPair(code, r.UserAgent())
	if tok == "" {
		pairPage(w, http.StatusForbidden, msg, code)
		return
	}
	http.Redirect(w, r, "/p/"+tok+"/", http.StatusFound)
}

func pairPage(w http.ResponseWriter, status int, msg, code string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	note := ""
	if msg != "" {
		note = `<p class="err">` + html.EscapeString(msg) + `</p>`
	}
	fmt.Fprintf(w, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#000000"><title>OptionPulse — pair this phone</title>
<style>body{background:#000;color:#fff;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center}
.box{max-width:380px;padding:28px 20px;text-align:center}h1{font-size:22px;margin:8px 0 4px}p{color:#98989f;line-height:1.5;margin:8px 0}
input{font-size:30px;letter-spacing:8px;text-align:center;width:220px;padding:10px;border-radius:12px;border:1px solid #3a3a3c;background:#1c1c1e;color:#fff;margin:14px 0}
button{display:block;width:100%%;padding:14px;border:0;border-radius:12px;background:#30d158;color:#000;font-size:17px;font-weight:700}
.err{color:#ff9f0a}.logo{width:56px;height:56px;border-radius:14px;background:#30d158;display:inline-grid;place-items:center;color:#000;font-weight:900;font-size:26px}</style></head>
<body><form class="box" method="post" action="/pair"><div class="logo">OP</div><h1>OptionPulse</h1>
<p>Enter the 6-digit code shown on your PC under <b>Settings → iPhone &amp; other phones</b>.</p>%s
<input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" autofocus value="%s" required>
<button type="submit">Connect this phone</button>
<p style="font-size:12px;margin-top:18px">Your phone and the PC must be on the same Wi-Fi. Orders and prices still go through the PC.</p></form></body></html>`, note, html.EscapeString(code))
}

// trustedPostFrom accepts only JSON POSTs sent by a page served from the given origin.
func trustedPostFrom(r *http.Request, want string) bool {
	if r.Method != http.MethodPost {
		return false
	}
	if ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); ct != "application/json" {
		return false
	}
	return r.Header.Get("Origin") == want
}

// ---------- PC-side API ----------

type phoneStatus struct {
	Enabled   bool     `json:"enabled"`
	Listening bool     `json:"listening"`
	Port      int      `json:"port"`
	Primary   string   `json:"primary"`
	Addresses []string `json:"addresses"`
	Devices   []struct {
		Name     string    `json:"name"`
		Added    time.Time `json:"added"`
		LastSeen time.Time `json:"lastSeen"`
	} `json:"devices"`
	Pair *struct {
		Code      string    `json:"code"`
		URL       string    `json:"url"`
		ExpiresAt time.Time `json:"expiresAt"`
	} `json:"pair,omitempty"`
	Firewall  string `json:"firewall"` // "allowed", "blocked", "unknown", "n/a"
	Autostart bool   `json:"autostart"`
	Error     string `json:"error,omitempty"`
}

func (s *server) phoneStatus(errMsg string) phoneStatus {
	primary, all := localAddresses()
	s.mu.Lock()
	defer s.mu.Unlock()
	st := phoneStatus{Enabled: s.phone.Enabled, Listening: s.phoneLn != nil, Port: phonePort, Primary: primary, Addresses: all, Error: errMsg}
	for _, d := range s.phone.Devices {
		st.Devices = append(st.Devices, struct {
			Name     string    `json:"name"`
			Added    time.Time `json:"added"`
			LastSeen time.Time `json:"lastSeen"`
		}{d.Name, d.Added, d.LastSeen})
	}
	if s.pairCode != "" && time.Now().Before(s.pairExpiry) && s.pairTries < pairMaxAttempts {
		st.Pair = &struct {
			Code      string    `json:"code"`
			URL       string    `json:"url"`
			ExpiresAt time.Time `json:"expiresAt"`
		}{s.pairCode, fmt.Sprintf("http://%s:%d/pair?code=%s", primary, phonePort, s.pairCode), s.pairExpiry}
	}
	if time.Since(s.winStateAt) > 30*time.Second { // netsh + PowerShell take a moment; the card polls every 3 s while pairing
		s.mu.Unlock()
		fw, auto := firewallState(), autostartEnabled()
		s.mu.Lock()
		s.fwState, s.autoState, s.winStateAt = fw, auto, time.Now()
	}
	st.Firewall, st.Autostart = s.fwState, s.autoState
	return st
}

func (s *server) forgetWinState() {
	s.mu.Lock()
	s.winStateAt = time.Time{}
	s.mu.Unlock()
}

// phoneAccessAPI: the PC window turns phone access on/off, starts a pairing, forgets phones, fixes the firewall.
func (s *server) phoneAccessAPI(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	errMsg := ""
	switch req.Action {
	case "status":
	case "enable":
		if err := s.startPhoneListener(); err != nil {
			errMsg = err.Error()
			break
		}
		s.mu.Lock()
		s.phone.Enabled = true
		s.newPairCodeLocked()
		s.savePhoneConfigLocked()
		s.mu.Unlock()
		if err := setAutostart(true); err != nil {
			log.Printf("autostart: %v", err)
		}
		s.forgetWinState()
	case "pair":
		s.mu.Lock()
		if s.phone.Enabled {
			s.newPairCodeLocked()
		}
		s.mu.Unlock()
	case "cancel-pair":
		s.mu.Lock()
		s.pairCode = ""
		s.mu.Unlock()
	case "forget":
		s.mu.Lock()
		s.phone.Devices = nil
		s.pairCode = ""
		s.savePhoneConfigLocked()
		s.mu.Unlock()
	case "disable":
		s.stopPhoneListener()
		s.mu.Lock()
		s.phone.Enabled = false
		s.pairCode = ""
		s.savePhoneConfigLocked()
		s.mu.Unlock()
		if err := setAutostart(false); err != nil {
			log.Printf("autostart: %v", err)
		}
		s.forgetWinState()
	case "firewall":
		if err := allowFirewall(); err != nil {
			errMsg = err.Error()
		}
		s.forgetWinState()
	default:
		http.Error(w, "unknown action", 400)
		return
	}
	writeJSON(w, 200, s.phoneStatus(errMsg))
}

// sessionAPI shares logins and settings between the PC window and paired phones.
// {data: {...}} publishes a new bundle; {rev: n} asks for anything newer than n.
func (s *server) sessionAPI(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Rev  int             `json:"rev"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	s.mu.Lock()
	if len(req.Data) > 2 && json.Valid(req.Data) { // "{}" or "null" don't count
		s.session = req.Data
		s.sessionRev++
		s.saveSessionLocked()
	}
	rev, data := s.sessionRev, s.session
	s.mu.Unlock()
	if req.Rev == rev || len(data) == 0 {
		writeJSON(w, 200, map[string]any{"rev": rev})
		return
	}
	writeJSON(w, 200, map[string]any{"rev": rev, "data": data})
}

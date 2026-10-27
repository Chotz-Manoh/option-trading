// OptionPulse desktop launcher.
//
// One small executable that:
//   - installs itself per-user on first run (no admin rights, Start Menu + Desktop shortcuts),
//   - serves the OptionPulse web app on http://127.0.0.1:47811,
//   - forwards broker API calls (Zerodha Kite, Upstox, Dhan, GitHub) so the app is not blocked by CORS,
//   - opens the app in its own Microsoft Edge / Chrome window,
//   - updates itself in one click from this project's own GitHub Releases (pinned repo + SHA-256 check).
//
// Standard library only.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed all:web
var webFiles embed.FS

// Set at build time:
//
//	-ldflags "-X main.version=1.2.3 -X main.updateRepo=owner/repo"
var (
	version    = "dev"
	updateRepo = ""
)

const (
	appName = "OptionPulse"
	port    = 47811
)

var (
	origin     = fmt.Sprintf("http://127.0.0.1:%d", port)
	hostHeader = fmt.Sprintf("127.0.0.1:%d", port)
)

// Hosts the app may reach through /api/proxy.
var proxyHosts = map[string]bool{
	"api.kite.trade":     true,
	"kite.zerodha.com":   true,
	"api.upstox.com":     true,
	"api-hft.upstox.com": true, // Upstox order placement / modify / cancel
	"api.dhan.co":        true,
	"api.github.com":     true,
}

type server struct {
	mu            sync.Mutex
	lastPing      time.Time
	kiteState     string
	pendingToken  string
	upstoxState   string // one-time value for the next Upstox login
	upstoxCode    string // authorization code waiting for the app to collect
	pendingStatus string
	updating      bool
	leaseID       string // the one app window allowed to run Live Auto Trade
	leaseExpiry   time.Time
	// Phone access (phone.go)
	phone      phoneConfig
	phoneLn    net.Listener
	phoneSrv   *http.Server
	pairCode   string
	pairExpiry time.Time
	pairTries  int
	session    json.RawMessage // logins + settings shared by the PC window and paired phones
	sessionRev int
	localIPs   []string
	localIPsAt time.Time
	fwState    string // cached Windows Firewall / start-with-Windows state for the Settings card
	autoState  bool
	winStateAt time.Time
	static     http.Handler
	web        fs.FS
	client     *http.Client
	quit       chan struct{}
}

func main() {
	noBrowser := flag.Bool("no-browser", false, "serve only, do not open a window")
	afterUpdate := flag.Bool("after-update", false, "started by the updater")
	installed := flag.Bool("installed", false, "started by setup (skip the install check)")
	uninstall := flag.Bool("uninstall", false, "remove OptionPulse from this computer")
	portable := flag.Bool("portable", false, "run from this folder without installing")
	flag.Parse()

	logFile := setupLog()
	if logFile != nil {
		defer logFile.Close()
	}
	log.Printf("%s %s starting (%s)", appName, version, strings.Join(os.Args[1:], " "))

	if *uninstall {
		runUninstall()
		return
	}

	// First run from Downloads (or a newer setup file): install, then start the installed copy.
	if !*portable && !*afterUpdate && !*installed && needsInstall() {
		if err := install(); err != nil {
			log.Printf("install failed: %v", err)
			alert(appName, "Could not install OptionPulse:\n\n"+err.Error())
		}
		return
	}

	removeOldExe() // left over from an update or a reinstall

	ln, err := listenWithRetry(*afterUpdate)
	if err != nil {
		// Already running? Then just open another window onto it.
		if running() {
			if !*noBrowser {
				openWindow()
			}
			return
		}
		alert(appName, fmt.Sprintf("Port %d on this computer is used by another program (or by OptionPulse for another Windows user), so OptionPulse can't start.\n\n%v", port, err))
		return
	}

	s := newServer()
	s.loadPhoneState()
	if s.phone.Enabled {
		if err := s.startPhoneListener(); err != nil {
			log.Printf("phone access: %v", err)
		}
	}
	go s.watchdog(*noBrowser)
	if !*noBrowser && !*afterUpdate {
		go func() {
			time.Sleep(150 * time.Millisecond)
			openWindow()
		}()
	}
	registerApp() // keep the "Installed apps" entry's version current

	srv := &http.Server{Handler: s, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-s.quit
		time.Sleep(300 * time.Millisecond)
		_ = srv.Close()
	}()
	log.Printf("serving on %s (updates from %q)", origin, updateRepo)
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("server error: %v", err)
	}
}

func setupLog() *os.File {
	dir := dataDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil
	}
	p := filepath.Join(dir, "launcher.log")
	if st, err := os.Stat(p); err == nil && st.Size() > 1<<20 {
		_ = os.Rename(p, p+".1")
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil
	}
	log.SetOutput(io.MultiWriter(f, os.Stderr))
	return f
}

func listenWithRetry(wait bool) (net.Listener, error) {
	deadline := time.Now().Add(500 * time.Millisecond)
	if wait {
		deadline = time.Now().Add(20 * time.Second) // the old version is still shutting down
	}
	for {
		ln, err := net.Listen("tcp", hostHeader)
		if err == nil || time.Now().After(deadline) {
			return ln, err
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// ---------- Instance proof ----------
//
// 127.0.0.1:47811 is shared by every Windows user on the PC. Before trusting a server that already
// listens there (to open a window onto it or ask it to quit) we make it prove it knows a secret that
// only this Windows user can read.

var (
	secretOnce sync.Once
	secret     []byte
)

func instanceSecret() []byte {
	secretOnce.Do(func() {
		p := filepath.Join(dataDir(), "instance.key")
		if b, err := os.ReadFile(p); err == nil {
			if k, err := hex.DecodeString(strings.TrimSpace(string(b))); err == nil && len(k) == 32 {
				secret = k
				return
			}
		}
		k := make([]byte, 32)
		if _, err := rand.Read(k); err != nil {
			panic(err)
		}
		_ = os.MkdirAll(dataDir(), 0o700)
		_ = os.WriteFile(p, []byte(hex.EncodeToString(k)), 0o600)
		secret = k
	})
	return secret
}

func proof(nonce string) string {
	m := hmac.New(sha256.New, instanceSecret())
	m.Write([]byte(nonce))
	return hex.EncodeToString(m.Sum(nil))
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// running reports whether *our* OptionPulse already answers on the port.
func running() bool {
	nonce := randomHex(16)
	c := &http.Client{Timeout: 2 * time.Second}
	res, err := c.Get(origin + "/api/hello?nonce=" + nonce)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var j struct {
		App   string `json:"app"`
		Proof string `json:"proof"`
	}
	if res.StatusCode != 200 || json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&j) != nil {
		return false
	}
	return j.App == appName && hmac.Equal([]byte(j.Proof), []byte(proof(nonce)))
}

// askRunningToQuit stops an older running copy (used by setup and uninstall).
func askRunningToQuit() {
	if !running() {
		return
	}
	req, _ := http.NewRequest("POST", origin+"/api/quit", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", origin)
	c := &http.Client{Timeout: 3 * time.Second}
	if res, err := c.Do(req); err == nil {
		res.Body.Close()
	}
	for i := 0; i < 40; i++ {
		ln, err := net.Listen("tcp", hostHeader)
		if err == nil {
			ln.Close()
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func newServer() *server {
	sub, err := fs.Sub(webFiles, "web")
	if err != nil {
		panic(err)
	}
	instanceSecret()
	return &server{
		lastPing: time.Now(),
		web:      sub,
		static:   http.FileServer(http.FS(sub)),
		client: &http.Client{
			Timeout: 60 * time.Second,
			// Never let a broker redirect carry a request to a host outside the allowlist.
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 || req.URL.Scheme != "https" || !proxyHosts[strings.ToLower(req.URL.Hostname())] {
					return http.ErrUseLastResponse
				}
				return nil
			},
		},
		quit: make(chan struct{}),
	}
}

// watchdog exits when no app window has pinged for a while (all windows closed). While phone access is
// on it stays up (phones may connect any time); a background copy started with Windows for phone access
// exits once phone access is turned off and the windows are closed.
func (s *server) watchdog(serveOnly bool) {
	s.mu.Lock()
	forPhones := s.phone.Enabled
	s.mu.Unlock()
	if serveOnly && !forPhones {
		return
	}
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	lastTick := time.Now()
	for {
		select {
		case <-s.quit:
			return
		case <-t.C:
			now := time.Now()
			s.mu.Lock()
			if now.Sub(lastTick) > 45*time.Second {
				// The computer was asleep: give the windows time to wake up and ping again.
				s.lastPing = now
			}
			idle := now.Sub(s.lastPing)
			busy := s.updating || s.phone.Enabled // phones may connect any time, so stay up
			s.mu.Unlock()
			lastTick = now
			if !busy && idle > 3*time.Minute {
				log.Printf("no window for %v - exiting", idle.Round(time.Second))
				s.stop()
				return
			}
		}
	}
}

func (s *server) stop() {
	s.mu.Lock()
	srv := s.phoneSrv
	select {
	case <-s.quit:
	default:
		close(s.quit)
	}
	s.mu.Unlock()
	if srv != nil {
		_ = srv.Close()
	}
}

// ---------- HTTP ----------

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only answer requests addressed to 127.0.0.1:47811 (blocks DNS-rebinding attacks).
	if r.Host != hostHeader {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Content-Security-Policy", "frame-ancestors 'none'")
	h.Set("Referrer-Policy", "no-referrer")

	switch {
	case r.URL.Path == "/api/hello":
		writeJSON(w, 200, map[string]string{"app": appName, "proof": proof(r.URL.Query().Get("nonce"))})
	case r.URL.Path == "/api/info":
		s.info(w)
	case r.URL.Path == "/api/ping":
		s.ping(w)
	case r.URL.Path == "/kite-callback":
		s.kiteCallback(w, r)
	case r.URL.Path == "/upstox-callback":
		s.upstoxCallback(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/"):
		if !trustedPost(r) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		s.api(w, r, false)
	default:
		s.serveStatic(w, r)
	}
}

func (s *server) ping(w http.ResponseWriter) {
	s.mu.Lock()
	s.lastPing = time.Now()
	s.mu.Unlock()
	writeJSON(w, 200, map[string]any{"ok": true, "version": version})
}

// api serves /api/* for the PC window and (fromPhone) for paired phones. Phones share data, orders
// and the Auto Trade lease, but cannot collect the PC's broker logins, update or quit the launcher.
func (s *server) api(w http.ResponseWriter, r *http.Request, fromPhone bool) {
	switch r.URL.Path {
	case "/api/ping":
		s.ping(w)
	case "/api/info":
		s.info(w)
	case "/api/proxy":
		s.proxy(w, r)
	case "/api/session":
		s.sessionAPI(w, r)
	case "/api/engine-lease":
		s.engineLease(w, r)
	default:
		if fromPhone {
			http.Error(w, "not available on a phone", http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case "/api/kite-begin":
			// A fresh state value for the next Kite login; the redirect must bring it back.
			st := randomHex(16)
			s.mu.Lock()
			s.kiteState, s.pendingToken = st, ""
			s.mu.Unlock()
			writeJSON(w, 200, map[string]string{"state": st})
		case "/api/upstox-begin":
			st := randomHex(16)
			s.mu.Lock()
			s.upstoxState, s.upstoxCode = st, ""
			s.mu.Unlock()
			writeJSON(w, 200, map[string]string{"state": st})
		case "/api/upstox-pending":
			s.mu.Lock()
			code := s.upstoxCode
			s.upstoxCode = ""
			s.mu.Unlock()
			out := map[string]string{}
			if code != "" {
				out["code"] = code
			}
			writeJSON(w, 200, out)
		case "/api/kite-pending":
			s.mu.Lock()
			tok, status := s.pendingToken, s.pendingStatus
			s.pendingToken, s.pendingStatus = "", ""
			s.mu.Unlock()
			out := map[string]string{}
			if tok != "" {
				out["request_token"] = tok
			}
			if status != "" {
				out["status"] = status
			}
			writeJSON(w, 200, out)
		case "/api/phone-access":
			s.phoneAccessAPI(w, r)
		case "/api/update":
			s.update(w)
		case "/api/quit":
			writeJSON(w, 200, map[string]bool{"ok": true})
			s.stop()
		default:
			http.NotFound(w, r)
		}
	}
}

// engineLease grants Live Auto Trade to one window at a time, across windows and browsers on this PC.
// The holder renews it every few seconds; it lapses 20 s after the holder goes away.
func (s *server) engineLease(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID      string `json:"id"`
		Release bool   `json:"release"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil || req.ID == "" || len(req.ID) > 64 {
		http.Error(w, "bad request", 400)
		return
	}
	now := time.Now()
	s.mu.Lock()
	ok := false
	switch {
	case req.Release:
		if s.leaseID == req.ID {
			s.leaseID = ""
		}
		ok = true
	case s.leaseID == "" || s.leaseID == req.ID || now.After(s.leaseExpiry):
		s.leaseID, s.leaseExpiry = req.ID, now.Add(20*time.Second)
		ok = true
	}
	s.mu.Unlock()
	writeJSON(w, 200, map[string]bool{"ok": ok})
}

// trustedPost accepts only JSON POSTs sent by the app's own page (blocks cross-site requests).
func trustedPost(r *http.Request) bool { return trustedPostFrom(r, origin) }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *server) info(w http.ResponseWriter) {
	exe, _ := os.Executable()
	writeJSON(w, 200, map[string]any{
		"app": appName, "version": version, "installDir": filepath.Dir(exe), "updateRepo": updateRepo,
	})
}

func (s *server) serveStatic(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if p == "" {
		p = "index.html"
	}
	st, err := fs.Stat(s.web, p)
	switch {
	case err == nil && st.IsDir():
		http.NotFound(w, r) // no directory listings
		return
	case err != nil && path.Ext(p) != "":
		http.NotFound(w, r)
		return
	case err != nil:
		p = "index.html" // single-page app routes
	}
	if p == "index.html" {
		b, err := fs.ReadFile(s.web, "index.html")
		if err != nil {
			http.Error(w, "missing app files", 500)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(b)
		return
	}
	if strings.HasPrefix(p, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	r2 := r.Clone(r.Context())
	r2.URL.Path = "/" + p
	s.static.ServeHTTP(w, r2)
}

func validParam(v string) bool {
	if len(v) == 0 || len(v) > 128 {
		return false
	}
	for _, c := range v {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

// kiteCallback receives Kite's redirect after login (request_token + our state) or after a basket (status).
func (s *server) kiteCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	tok, st, state := q.Get("request_token"), q.Get("status"), q.Get("op_state")
	title, msg := appName, "You can close this window and return to OptionPulse."
	s.mu.Lock()
	switch {
	case validParam(tok) && s.kiteState != "" && hmac.Equal([]byte(state), []byte(s.kiteState)):
		s.pendingToken, s.kiteState = tok, ""
		title, msg = "Kite login received", "Finishing the login in OptionPulse... this window closes by itself."
	case validParam(tok):
		title, msg = "Login not accepted", "This Kite login wasn't started from OptionPulse. Start it again from Settings > Zerodha Kite."
	case validParam(st):
		s.pendingStatus = st
		title = "Kite: " + st
	}
	s.mu.Unlock()
	callbackPage(w, title, msg)
}

// upstoxCallback receives Upstox's redirect after login (?code=…&state=…).
func (s *server) upstoxCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	code, state := q.Get("code"), q.Get("state")
	title, msg := "Login not accepted", "This Upstox login wasn't started from OptionPulse. Start it again from Settings > Data source."
	s.mu.Lock()
	if validParam(code) && s.upstoxState != "" && hmac.Equal([]byte(state), []byte(s.upstoxState)) {
		s.upstoxCode, s.upstoxState = code, ""
		title, msg = "Upstox login received", "Finishing the login in OptionPulse... this window closes by itself."
	} else if !validParam(code) {
		title, msg = "Upstox login cancelled", "No authorization code came back. Try again from Settings > Data source."
	}
	s.mu.Unlock()
	callbackPage(w, title, msg)
}

func callbackPage(w http.ResponseWriter, title, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprintf(w, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title></head>
<body style="background:#000;color:#fff;font-family:'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:48px;color:#30d158">&#10003;</div>
<h2 style="margin:8px 0">%s</h2><p style="color:#98989f">%s</p></div>
<script>setTimeout(function(){window.close()},1200)</script></body></html>`, html.EscapeString(title), html.EscapeString(title), html.EscapeString(msg))
}

type proxyRequest struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

func (s *server) proxy(w http.ResponseWriter, r *http.Request) {
	var pr proxyRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&pr); err != nil {
		http.Error(w, "bad request", 400)
		return
	}
	u, err := url.Parse(pr.URL)
	if err != nil || u.Scheme != "https" || !proxyHosts[strings.ToLower(u.Hostname())] || u.Port() != "" || u.User != nil {
		http.Error(w, "host not allowed", 403)
		return
	}
	method := strings.ToUpper(pr.Method)
	if method == "" {
		method = "GET"
	}
	if method != "GET" && method != "POST" && method != "DELETE" && method != "PUT" {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body io.Reader
	if pr.Body != "" && method != "GET" {
		body = strings.NewReader(pr.Body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, u.String(), body)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	for k, v := range pr.Headers {
		switch strings.ToLower(k) {
		case "host", "content-length", "accept-encoding", "connection", "cookie", "origin", "referer":
			continue
		}
		req.Header.Set(k, v)
	}
	req.Header.Set("User-Agent", appName+"/"+version)
	res, err := s.client.Do(req)
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": err.Error()})
		return
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 128<<20))
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"status": res.StatusCode, "body": string(data)})
}

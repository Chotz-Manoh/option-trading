package main

// One-click self-update from this project's own GitHub Releases.
//
// The page only says "update now". The launcher itself looks up the latest release of the
// repository baked in at build time (main.updateRepo), accepts only that repository's
// OptionPulse-Setup.exe, verifies its SHA-256 (GitHub's asset digest, or SHA256SUMS.txt),
// swaps the executable and restarts.

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const setupAsset = "OptionPulse-Setup.exe"

var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

type ghAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Digest string `json:"digest"`
	Size   int64  `json:"size"`
}

type ghRelease struct {
	Tag    string    `json:"tag_name"`
	Draft  bool      `json:"draft"`
	Assets []ghAsset `json:"assets"`
}

// githubBases returns the API and download bases. Automated tests may point them at a local
// server with OPTIONPULSE_DEV_GITHUB=http://127.0.0.1:<port> (environment of this Windows user only).
func githubBases() (api, download string) {
	if d := os.Getenv("OPTIONPULSE_DEV_GITHUB"); strings.HasPrefix(d, "http://127.0.0.1:") {
		return strings.TrimRight(d, "/"), strings.TrimRight(d, "/")
	}
	return "https://api.github.com", "https://github.com"
}

func allowedDownloadHost(h string) bool {
	return h == "github.com" || strings.HasSuffix(h, ".githubusercontent.com")
}

func updateClient(timeout time.Duration) *http.Client {
	_, dl := githubBases()
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 6 {
				return errors.New("too many redirects")
			}
			if strings.HasPrefix(req.URL.String(), dl+"/") || req.URL.Scheme == "https" && allowedDownloadHost(strings.ToLower(req.URL.Hostname())) {
				return nil
			}
			return fmt.Errorf("refusing redirect to %s", req.URL.Host)
		},
	}
}

func compareVersions(a, b string) int {
	pa := strings.Split(strings.TrimPrefix(strings.TrimPrefix(a, "v"), "V"), ".")
	pb := strings.Split(strings.TrimPrefix(strings.TrimPrefix(b, "v"), "V"), ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			if x > y {
				return 1
			}
			return -1
		}
	}
	return 0
}

func latestRelease() (*ghRelease, error) {
	if !repoPattern.MatchString(updateRepo) {
		return nil, errors.New("this copy of OptionPulse was built without an update source. Install OptionPulse-Setup.exe from your GitHub Releases once - later versions then update in one click")
	}
	api, _ := githubBases()
	req, _ := http.NewRequest("GET", api+"/repos/"+updateRepo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", appName+"/"+version)
	res, err := updateClient(30 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub answered HTTP %d", res.StatusCode)
	}
	var rel ghRelease
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&rel); err != nil {
		return nil, err
	}
	return &rel, nil
}

func (s *server) update(w http.ResponseWriter) {
	s.mu.Lock()
	if s.updating {
		s.mu.Unlock()
		http.Error(w, "An update is already running.", 409)
		return
	}
	s.updating = true
	s.mu.Unlock()
	fail := func(status int, err error) {
		s.mu.Lock()
		s.updating = false
		s.mu.Unlock()
		log.Printf("update failed: %v", err)
		http.Error(w, "Update failed: "+err.Error(), status)
	}

	rel, err := latestRelease()
	if err != nil {
		fail(502, err)
		return
	}
	newVersion := strings.TrimPrefix(rel.Tag, "v")
	if compareVersions(newVersion, version) <= 0 {
		fail(409, fmt.Errorf("you already have the latest version (%s)", version))
		return
	}
	_, dl := githubBases()
	prefix := dl + "/" + updateRepo + "/releases/download/"
	var exe *ghAsset
	var sums *ghAsset
	for i := range rel.Assets {
		a := &rel.Assets[i]
		if !strings.HasPrefix(a.URL, prefix) {
			continue
		}
		switch a.Name {
		case setupAsset:
			exe = a
		case "SHA256SUMS.txt":
			sums = a
		}
	}
	if exe == nil {
		fail(502, fmt.Errorf("release %s has no %s", rel.Tag, setupAsset))
		return
	}
	want := ""
	if d := strings.TrimPrefix(exe.Digest, "sha256:"); len(d) == 64 && d != exe.Digest {
		want = strings.ToLower(d)
	} else if sums != nil {
		want, err = checksumFromSums(sums.URL, setupAsset)
		if err != nil {
			fail(502, err)
			return
		}
	}
	if len(want) != 64 {
		fail(502, errors.New("the release has no SHA-256 checksum, so it was not installed"))
		return
	}
	if err := applyUpdate(exe.URL, want); err != nil {
		fail(500, err)
		return
	}
	log.Printf("update to %s installed - restarting", newVersion)
	writeJSON(w, 200, map[string]any{"ok": true, "version": newVersion})
	go func() {
		time.Sleep(500 * time.Millisecond)
		s.stop()
	}()
}

func checksumFromSums(sumsURL, name string) (string, error) {
	res, err := updateClient(30 * time.Second).Get(sumsURL)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", fmt.Errorf("checksum file: HTTP %d", res.StatusCode)
	}
	sc := bufio.NewScanner(io.LimitReader(res.Body, 64<<10))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == name && len(f[0]) == 64 {
			return strings.ToLower(f[0]), nil
		}
	}
	return "", errors.New("checksum not listed for " + name)
}

func selfPath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	return exe, nil
}

func renameRetry(from, to string) error {
	var err error
	for i := 0; i < 20; i++ { // antivirus scanners briefly lock new files
		if err = os.Rename(from, to); err == nil {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return err
}

// applyUpdate downloads the new executable, checks its SHA-256, swaps it in and starts it.
func applyUpdate(downloadURL, wantSHA string) error {
	exe, err := selfPath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(exe)
	tmp := filepath.Join(dir, appName+".new"+exeSuffix)
	old := filepath.Join(dir, appName+".old"+exeSuffix)

	res, err := updateClient(10 * time.Minute).Get(downloadURL)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("download: HTTP %d", res.StatusCode)
	}
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(res.Body, 300<<20))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return fmt.Errorf("download: %w", err)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != wantSHA {
		os.Remove(tmp)
		return errors.New("the download doesn't match the release checksum, so it was not installed")
	}
	if err := checkExecutable(tmp, n); err != nil {
		os.Remove(tmp)
		return err
	}
	_ = os.Remove(old)
	if err := renameRetry(exe, old); err != nil { // Windows allows renaming a running exe
		os.Remove(tmp)
		return fmt.Errorf("could not replace the app: %w", err)
	}
	if err := renameRetry(tmp, exe); err != nil {
		_ = os.Rename(old, exe)
		return fmt.Errorf("could not replace the app: %w", err)
	}
	if err := startDetached(exe, "--after-update"); err != nil {
		_ = os.Rename(exe, tmp)
		_ = os.Rename(old, exe)
		return fmt.Errorf("could not start the new version: %w", err)
	}
	return nil
}

func checkExecutable(p string, size int64) error {
	if size < 1<<20 {
		return errors.New("the downloaded file is too small to be OptionPulse")
	}
	f, err := os.Open(p)
	if err != nil {
		return err
	}
	defer f.Close()
	head := make([]byte, 2)
	if _, err := io.ReadFull(f, head); err != nil {
		return err
	}
	if exeSuffix == ".exe" && string(head) != "MZ" {
		return errors.New("the downloaded file is not a Windows program")
	}
	return nil
}

// removeOldExe deletes OptionPulse.old.exe left by an update or reinstall (retrying while it is still locked).
func removeOldExe() {
	exe, err := selfPath()
	if err != nil {
		return
	}
	old := filepath.Join(filepath.Dir(exe), appName+".old"+exeSuffix)
	if _, err := os.Stat(old); err != nil {
		return
	}
	go func() {
		for i := 0; i < 60; i++ {
			if err := os.Remove(old); err == nil || os.IsNotExist(err) {
				return
			}
			time.Sleep(time.Second)
		}
	}()
}

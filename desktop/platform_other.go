//go:build !windows

// macOS / Linux: no installer — used for development and automated tests.
package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

const exeSuffix = ""

func dataDir() string {
	d, err := os.UserConfigDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, appName)
}

func needsInstall() bool { return false }
func install() error     { return nil }
func runUninstall()      {}
func registerApp()       {}

func alert(title, msg string) { log.Printf("%s: %s", title, msg) }

func openWindow() {
	for _, b := range []string{"xdg-open", "open"} {
		if p, err := exec.LookPath(b); err == nil {
			_ = exec.Command(p, origin+"/").Start()
			return
		}
	}
	log.Printf("open %s/ in a browser", origin)
}

func startDetached(exe string, args ...string) error {
	cmd := exec.Command(exe, args...)
	cmd.Dir = filepath.Dir(exe)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// Phone access helpers (Windows only; no-ops elsewhere).
func firewallState() string      { return "n/a" }
func allowFirewall() error       { return nil }
func autostartEnabled() bool     { return false }
func setAutostart(on bool) error { return nil }

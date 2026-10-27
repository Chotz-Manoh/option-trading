//go:build windows

package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const exeSuffix = ".exe"

const (
	createNoWindow        = 0x08000000
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
)

func localAppData() string {
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		return v
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "AppData", "Local")
}

// Per-user install location: no administrator rights needed.
func installDir() string   { return filepath.Join(localAppData(), "Programs", appName) }
func installedExe() string { return filepath.Join(installDir(), appName+".exe") }
func dataDir() string      { return filepath.Join(localAppData(), appName) }

func currentExe() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	return filepath.Clean(exe)
}

func needsInstall() bool {
	exe := currentExe()
	if exe == "" {
		return false
	}
	a, err1 := os.Stat(exe)
	b, err2 := os.Stat(installedExe())
	if err1 == nil && err2 == nil && os.SameFile(a, b) {
		return false
	}
	return !strings.EqualFold(exe, filepath.Clean(installedExe()))
}

// install copies this program to the install folder, adds shortcuts and an
// "Installed apps" entry, then starts the installed copy. Running a newer setup
// file over an older install upgrades it in place (settings are kept).
func install() error {
	src := currentExe()
	askRunningToQuit()
	if err := os.MkdirAll(installDir(), 0o755); err != nil {
		return err
	}
	dst := installedExe()
	tmp := dst + ".tmp"
	if err := copyFile(src, tmp); err != nil {
		return err
	}
	if _, err := os.Stat(dst); err == nil {
		old := filepath.Join(installDir(), appName+".old.exe")
		_ = os.Remove(old)
		if err := os.Remove(dst); err != nil {
			if err2 := os.Rename(dst, old); err2 != nil {
				_ = os.Remove(tmp)
				return fmt.Errorf("OptionPulse is still running. Close its window and run setup again.\n(%v)", err)
			}
		}
	}
	if err := os.Rename(tmp, dst); err != nil {
		return err
	}
	if err := powershell(shortcutScript(dst) + registryScript(dst)); err != nil {
		log.Printf("shortcuts/registry: %v", err)
	}
	markRegistered()
	log.Printf("installed to %s", dst)
	return startDetached(dst, "--installed")
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// psq quotes a value for a single-quoted PowerShell string. PowerShell also treats the
// typographic quotes \u2018 \u2019 \u201A \u201B as single quotes, so those are doubled too.
func psq(s string) string {
	var b strings.Builder
	b.WriteByte('\'')
	for _, r := range s {
		switch r {
		case '\'', '\u2018', '\u2019', '\u201A', '\u201B':
			b.WriteRune(r)
		}
		b.WriteRune(r)
	}
	b.WriteByte('\'')
	return b.String()
}

func shortcutScript(exe string) string {
	return fmt.Sprintf(`
$w = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  if (-not $dir) { continue }
  $s = $w.CreateShortcut((Join-Path $dir 'OptionPulse.lnk'))
  $s.TargetPath = %s
  $s.WorkingDirectory = %s
  $s.IconLocation = %s
  $s.Description = 'OptionPulse - options analysis for Nifty, Bank Nifty and Sensex'
  $s.Save()
}
`, psq(exe), psq(filepath.Dir(exe)), psq(exe+",0"))
}

const uninstallKey = `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\OptionPulse`

func registryScript(exe string) string {
	return fmt.Sprintf(`
$k = %s
New-Item -Path $k -Force | Out-Null
Set-ItemProperty -Path $k -Name DisplayName -Value 'OptionPulse'
Set-ItemProperty -Path $k -Name DisplayVersion -Value %s
Set-ItemProperty -Path $k -Name Publisher -Value 'OptionPulse'
Set-ItemProperty -Path $k -Name DisplayIcon -Value %s
Set-ItemProperty -Path $k -Name InstallLocation -Value %s
Set-ItemProperty -Path $k -Name UninstallString -Value %s
New-ItemProperty -Path $k -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $k -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
`, psq(uninstallKey), psq(version), psq(exe+",0"), psq(filepath.Dir(exe)), psq(`"`+exe+`" --uninstall`))
}

func markerPath() string { return filepath.Join(dataDir(), "registered-version") }

func markRegistered() { _ = os.WriteFile(markerPath(), []byte(version), 0o644) }

// registerApp refreshes the "Installed apps" entry after an update (once per version).
func registerApp() {
	if needsInstall() {
		return
	}
	if b, err := os.ReadFile(markerPath()); err == nil && string(b) == version {
		return
	}
	go func() {
		if err := powershell(registryScript(installedExe())); err != nil {
			log.Printf("registry: %v", err)
			return
		}
		markRegistered()
	}()
}

func runUninstall() {
	if !confirm(appName, "Remove OptionPulse from this computer?\n\nThis also deletes its saved settings, alerts and trade journal.") {
		return
	}
	askRunningToQuit()
	script := fmt.Sprintf(`
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  if ($dir) { Remove-Item -LiteralPath (Join-Path $dir 'OptionPulse.lnk') -Force -ErrorAction SilentlyContinue }
}
Remove-Item -Path %s -Recurse -Force -ErrorAction SilentlyContinue
`, psq(uninstallKey))
	if err := powershell(script); err != nil {
		log.Printf("uninstall: %v", err)
	}
	alert(appName, "OptionPulse has been removed.")

	// Delete the program and data folders once this process has exited: close OptionPulse's own
	// Edge/Chrome windows (they lock the window profile), then retry the deletes for a while.
	cleanup := fmt.Sprintf(`
Wait-Process -Id %d -Timeout 30 -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*OptionPulse\window*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
foreach ($p in @(%s, %s)) {
  for ($i = 0; $i -lt 20 -and (Test-Path -LiteralPath $p); $i++) {
    Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $p) { Start-Sleep -Milliseconds 500 }
  }
}
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`, os.Getpid(), psq(installDir()), psq(dataDir()))
	file := filepath.Join(os.TempDir(), fmt.Sprintf("optionpulse-uninstall-%d.ps1", os.Getpid()))
	if err := writeScript(file, cleanup); err != nil {
		log.Printf("uninstall: %v", err)
		return
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", file)
	cmd.Dir = os.TempDir()
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow | createNewProcessGroup}
	if err := cmd.Start(); err == nil {
		_ = cmd.Process.Release()
	}
}

// writeScript saves a PowerShell script as UTF-8 with BOM (so Windows PowerShell 5.1 reads it correctly).
func writeScript(file, script string) error {
	return os.WriteFile(file, append([]byte{0xEF, 0xBB, 0xBF}, []byte("$ErrorActionPreference='Continue'\r\n"+strings.ReplaceAll(script, "\n", "\r\n"))...), 0o600)
}

// powershell runs a script from a temporary .ps1 file (plain -File, no encoded command lines).
func powershell(script string) error {
	_ = os.MkdirAll(dataDir(), 0o700)
	file := filepath.Join(dataDir(), fmt.Sprintf("setup-%d.ps1", time.Now().UnixNano()))
	if err := writeScript(file, script); err != nil {
		return err
	}
	defer os.Remove(file)
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func startDetached(exe string, args ...string) error {
	cmd := exec.Command(exe, args...)
	cmd.Dir = filepath.Dir(exe)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | createNewProcessGroup}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// browserPath finds Microsoft Edge (built into Windows 10/11), then Chrome.
func browserPath() string {
	var candidates []string
	for _, rel := range []string{`Microsoft\Edge\Application\msedge.exe`, `Google\Chrome\Application\chrome.exe`} {
		for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
			if base := os.Getenv(env); base != "" {
				candidates = append(candidates, filepath.Join(base, rel))
			}
		}
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// openWindow shows the app in its own window (Edge/Chrome "app" mode, separate profile).
func openWindow() {
	url := origin + "/"
	if b := browserPath(); b != "" {
		profile := filepath.Join(dataDir(), "window")
		cmd := exec.Command(b, "--app="+url, "--user-data-dir="+profile, "--no-first-run", "--no-default-browser-check",
			"--window-size=1400,900", "--disable-features=msEdgeSidebarV2,msHubAppsTenantId,EdgeCollectionsEnabled",
			// Keep refreshes, alerts and Auto Trade running at full speed when the window is minimised.
			"--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows")
		if err := cmd.Start(); err == nil {
			go func() { _ = cmd.Wait() }()
			return
		} else {
			log.Printf("browser start failed: %v", err)
		}
	}
	cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
	if err := cmd.Start(); err != nil {
		alert(appName, "Open "+url+" in your web browser to use OptionPulse.")
	}
}

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	messageBoxW = user32.NewProc("MessageBoxW")
)

func messageBox(title, msg string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(msg)
	r, _, _ := messageBoxW.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
	return int(r)
}

func alert(title, msg string) { messageBox(title, msg, 0x40 /* MB_ICONINFORMATION */) }

func confirm(title, msg string) bool {
	return messageBox(title, msg, 0x04|0x20 /* MB_YESNO | MB_ICONQUESTION */) == 6 /* IDYES */
}

// ---------- Phone access helpers ----------

const (
	firewallRule = "OptionPulse (phone access)"
	runKey       = `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run`
)

// firewallState reports whether an inbound rule for the phone port exists ("allowed"), or "unknown".
func firewallState() string {
	cmd := exec.Command("netsh", "advfirewall", "firewall", "show", "rule", "name="+firewallRule)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	out, err := cmd.CombinedOutput()
	if err == nil && strings.Contains(string(out), firewallRule) {
		return "allowed"
	}
	return "unknown"
}

// allowFirewall adds an inbound allow rule for the phone port (asks for administrator approval once).
// Any earlier rule Windows created for this program (e.g. a "Cancel" on the firewall prompt) is removed first.
func allowFirewall() error {
	exe := installedExe()
	if needsInstall() {
		exe = currentExe()
	}
	script := fmt.Sprintf(`netsh advfirewall firewall delete rule name=%s | Out-Null
netsh advfirewall firewall delete rule name=all program=%s | Out-Null
netsh advfirewall firewall add rule name=%s dir=in action=allow protocol=TCP localport=%d profile=any program=%s description='Lets your phone open OptionPulse from this PC over Wi-Fi.'`,
		psq(firewallRule), psq(exe), psq(firewallRule), phonePort, psq(exe))
	_ = os.MkdirAll(dataDir(), 0o700)
	file := filepath.Join(dataDir(), fmt.Sprintf("firewall-%d.ps1", time.Now().UnixNano()))
	if err := writeScript(file, script); err != nil {
		return err
	}
	// Elevate: Start-Process -Verb RunAs shows the UAC prompt; -Wait so we can report the result.
	outer := fmt.Sprintf(`$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',%s)
if ($p.ExitCode -ne 0) { exit $p.ExitCode }`, psq(file))
	err := powershell(outer)
	_ = os.Remove(file)
	if err != nil {
		if strings.Contains(err.Error(), "canceled") || strings.Contains(err.Error(), "cancelled") {
			return fmt.Errorf("administrator approval was declined, so the firewall rule was not added")
		}
		return fmt.Errorf("could not add the firewall rule: %v", err)
	}
	return nil
}

// autostartEnabled reports whether OptionPulse starts with Windows (needed so phones can connect any time).
func autostartEnabled() bool {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		fmt.Sprintf(`(Get-ItemProperty -Path %s -Name OptionPulse -ErrorAction SilentlyContinue).OptionPulse`, psq(runKey)))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	out, err := cmd.Output()
	return err == nil && strings.Contains(string(out), "--no-browser")
}

// setAutostart registers (or removes) a per-user "start with Windows" entry that runs the launcher
// in the background (no window) so paired phones can connect after a restart.
func setAutostart(on bool) error {
	if on {
		exe := installedExe()
		if needsInstall() {
			exe = currentExe()
		}
		return powershell(fmt.Sprintf(`New-Item -Path %s -Force | Out-Null
Set-ItemProperty -Path %s -Name OptionPulse -Value %s`, psq(runKey), psq(runKey), psq(`"`+exe+`" --no-browser`)))
	}
	return powershell(fmt.Sprintf(`Remove-ItemProperty -Path %s -Name OptionPulse -ErrorAction SilentlyContinue`, psq(runKey)))
}

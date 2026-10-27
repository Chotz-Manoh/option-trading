# One-time setup: puts OptionPulse on your GitHub account and starts the first build.
# GitHub then builds OptionPulse-Setup.exe and OptionPulse.apk for you, and the installed
# apps update themselves from this repository's releases.
#
# Needs: Git (https://git-scm.com) and GitHub CLI (https://cli.github.com), then run once:  gh auth login
#
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\publish-to-github.ps1 -Keystore ..\signing\optionpulse-release.jks -Password <keystore password>

param(
  [string]$RepoName = "optionpulse",
  [Parameter(Mandatory = $true)][string]$Keystore,
  [Parameter(Mandatory = $true)][string]$Password,
  [string]$Alias = "optionpulse",
  [string]$Version = "1.9.0"
)
$ErrorActionPreference = "Continue"   # git/gh print progress on stderr; we check exit codes instead
function Check($what) { if ($LASTEXITCODE -ne 0) { Write-Host "Failed: $what" -ForegroundColor Red; exit 1 } }

foreach ($tool in @("git", "gh")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed. See the comments at the top of this script." }
}
gh auth status | Out-Null; Check "GitHub login (run: gh auth login)"
if (-not (Test-Path $Keystore)) { throw "Keystore not found: $Keystore" }

if (-not (Test-Path ".git")) {
  git init -b main | Out-Null
}
if (-not (git config user.email)) {
  $login = gh api user -q .login
  git config user.name $login
  git config user.email "$login@users.noreply.github.com"
}
git add -A
git commit -q -m "OptionPulse $Version" | Out-Null

# Releases must be public so the apps can download updates without a GitHub login.
gh repo view $RepoName *> $null
if ($LASTEXITCODE -ne 0) {
  gh repo create $RepoName --public --source . --remote origin --push; Check "create repository"
} else {
  if (-not (git remote | Select-String -Quiet "^origin$")) { git remote add origin (gh repo view $RepoName --json url -q .url) }
  git push -u origin main; Check "push"
}

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $Keystore)))
gh secret set ANDROID_KEYSTORE_BASE64 --body $b64; Check "save secret"
gh secret set ANDROID_KEYSTORE_PASSWORD --body $Password; Check "save secret"
gh secret set ANDROID_KEY_ALIAS --body $Alias; Check "save secret"
gh secret set ANDROID_KEY_PASSWORD --body $Password; Check "save secret"

Start-Sleep -Seconds 3
gh workflow run "Build & release" -f version=$Version -f notes="First release."; Check "start the build"
Write-Host ""
Write-Host "Started the build. In about 10 minutes the files appear under Releases:" -ForegroundColor Green
$repoUrl = gh repo view --json url -q .url
Write-Host ""
Write-Host "Web version (one link for every device, iPhone included) - one click:" -ForegroundColor Green
Write-Host "  https://vercel.com/new/clone?repository-url=$repoUrl"
Write-Host "  (Vercel builds it and gives you https://<name>.vercel.app; then add <that address>/upstox-callback to your Upstox app's redirect URLs.)"
gh repo view --web

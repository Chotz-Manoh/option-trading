# Publish a new version. Every installed copy (Windows and Android) then offers a one-click update.
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.0.1 -Notes "Better Kite login"
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "Improvements and fixes."
)
$ErrorActionPreference = "Continue"
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Write-Host "Version must look like 1.2.3" -ForegroundColor Red; exit 1 }
git add -A
git commit -q -m "OptionPulse $Version" | Out-Null
git push
if ($LASTEXITCODE -ne 0) { Write-Host "git push failed" -ForegroundColor Red; exit 1 }
gh workflow run "Build & release" -f version=$Version -f notes="$Notes"
if ($LASTEXITCODE -ne 0) { Write-Host "Could not start the build" -ForegroundColor Red; exit 1 }
Write-Host "Building $Version - check the Actions tab; the release appears when it finishes." -ForegroundColor Green

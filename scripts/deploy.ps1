#!/usr/bin/env pwsh
# Static production deploy for AICrew Studio.
# Mirrors C:\project\my\agent-build\scripts\deploy.ps1.

[CmdletBinding()]
param(
  [string]$DeployHost = "root@47.253.230.197",
  [string]$WebRoot = "/opt/aicrew/current/out",
  [string]$Domain = "songuu.top",
  [string]$BasePath = "/aicrew/",
  [ValidateSet("https", "http")]
  [string]$VerifyScheme = "https",
  [string[]]$VerifyPaths = @("", "workbench/", "skills/", "admin/"),
  [switch]$SkipTests,
  [switch]$SkipBuild,
  [switch]$SkipVerify,
  [switch]$DryRun,
  [switch]$KeepArchive
)

$ErrorActionPreference = "Stop"
$script:DryRunEnabled = [bool]$DryRun

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Step([string]$Message) {
  Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Normalize-BasePath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "/" }
  $normalized = $Value.Trim()
  if (-not $normalized.StartsWith("/")) { $normalized = "/$normalized" }
  if (-not $normalized.EndsWith("/")) { $normalized = "$normalized/" }
  return $normalized
}

function Quote-BashValue([string]$Value) {
  if ($Value -match "'") {
    throw "Remote argument contains a single quote and cannot be safely embedded in bash: $Value"
  }
  return "'$Value'"
}

function Invoke-Native([string]$File, [string[]]$Arguments) {
  if ($script:DryRunEnabled) {
    Write-Host "DRYRUN: $File $($Arguments -join ' ')" -ForegroundColor DarkGray
    return
  }

  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed (exit $LASTEXITCODE): $File $($Arguments -join ' ')"
  }
}

function Write-ConfigLine([string]$Label, [string]$Value) {
  Write-Host ("  {0,-14} {1}" -f $Label, $Value)
}

$resolvedBasePath = Normalize-BasePath $BasePath

Step "Deploy config"
Write-ConfigLine "DeployHost" $DeployHost
Write-ConfigLine "WebRoot" $WebRoot
Write-ConfigLine "Domain" $Domain
Write-ConfigLine "BasePath" $resolvedBasePath
Write-ConfigLine "Scheme" $VerifyScheme

if ($DryRun) {
  Write-Host "DryRun: config only. No tests, build, upload, swap, or verification." -ForegroundColor Yellow
  return
}

if (-not $SkipTests) {
  Step "Gates: tests"
  Invoke-Native "npm" @("test")
} else {
  Write-Host "Skipping tests (-SkipTests)" -ForegroundColor Yellow
}

if (-not $SkipBuild) {
  Step "Production build"
  Invoke-Native "npm" @("run", "build")
} else {
  Write-Host "Skipping build (-SkipBuild). Reusing out/." -ForegroundColor Yellow
}

Step "Build self-check"
$distIndex = Join-Path $RepoRoot "out/index.html"
if (-not (Test-Path $distIndex)) {
  throw "Missing out/index.html. Build first."
}

$expectedAssetsPrefix = "$($resolvedBasePath.TrimEnd('/'))/_next"
if ((Get-Content -Raw $distIndex) -notmatch [regex]::Escape($expectedAssetsPrefix)) {
  throw "Wrong base: out/index.html does not use $resolvedBasePath. Stop deploy to avoid assets 404."
}

$fileCount = (Get-ChildItem -Recurse -File "out" | Measure-Object).Count
Write-Host "out file count: $fileCount"

Step "Package + upload to ${DeployHost}:/tmp"
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$archiveName = "aicrew-out-$timestamp.tgz"
$localArchive = Join-Path ([System.IO.Path]::GetTempPath()) $archiveName
$remoteArchive = "/tmp/$archiveName"
$remoteStage = "/tmp/aicrew-stage-$timestamp"

Invoke-Native "tar" @("-czf", $localArchive, "-C", "out", ".")
Invoke-Native "scp" @("-o", "BatchMode=yes", $localArchive, "${DeployHost}:$remoteArchive")

Step "Remote backup + atomic swap"
$quotedWebRoot = Quote-BashValue $WebRoot
$quotedRemoteArchive = Quote-BashValue $remoteArchive
$quotedRemoteStage = Quote-BashValue $remoteStage
$swap = @(
  "set -e",
  "D=$quotedWebRoot",
  "T=$quotedRemoteArchive",
  "S=$quotedRemoteStage",
  "TS=`$(date +%Y%m%d%H%M%S)",
  'rm -rf "$S"',
  'mkdir -p "$S"',
  'tar -xzf "$T" -C "$S"',
  'test -f "$S/index.html"',
  'chmod -R a+rX "$S"',
  'mkdir -p "$(dirname "$D")"',
  'if [ -e "$D" ]; then mv "$D" "${D}.bak.${TS}"; fi',
  'mv "$S" "$D"',
  'rm -f "$T"',
  'echo "ROLLBACK_BACKUP=${D}.bak.${TS}"',
  'echo "FILE_COUNT=$(find "$D" -type f | wc -l)"'
) -join '; '
Invoke-Native "ssh" @("-o", "BatchMode=yes", $DeployHost, $swap)

if (-not $SkipVerify) {
  Step "Remote loopback verification"
  $quotedDomainHeader = Quote-BashValue "Host: $Domain"
  $quotedBase = Quote-BashValue $resolvedBasePath
  $quotedScheme = Quote-BashValue $VerifyScheme
  $verifyPathArgs = ($VerifyPaths | ForEach-Object { Quote-BashValue $_ }) -join " "
  $verify = @(
    "set -e",
    "H=$quotedDomainHeader",
    "BASE=$quotedBase",
    "SCHEME=$quotedScheme",
    "for p in $verifyPathArgs; do code=`$(curl -sk -o /dev/null -w %{http_code} -H `"`$H`" `"`${SCHEME}://127.0.0.1`${BASE}`${p}`"); echo `"`${BASE}`${p} -> `${code}`"; test `"`$code`" = `"200`"; done",
    'asset_count=$(curl -sk -H "$H" "${SCHEME}://127.0.0.1${BASE}" | grep -c "/aicrew/_next" || true)',
    'echo "asset_count=${asset_count}"',
    'test "$asset_count" != "0"'
  ) -join '; '
  Invoke-Native "ssh" @("-o", "BatchMode=yes", $DeployHost, $verify)

  Step "Public HTTPS verification"
  foreach ($path in $VerifyPaths) {
    $url = "$($VerifyScheme)://$Domain$resolvedBasePath$path"
    $status = (curl.exe -k -s -o NUL -w "%{http_code}" $url)
    Write-Host "$url -> $status"
    if ($status -ne "200") {
      throw "Public verification failed: $url -> $status"
    }
  }
}

if (-not $KeepArchive) {
  Remove-Item $localArchive -ErrorAction SilentlyContinue
}

Step "Deploy complete"
Write-Host "Target: ${VerifyScheme}://$Domain$resolvedBasePath" -ForegroundColor Green

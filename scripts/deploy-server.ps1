#!/usr/bin/env pwsh
# Deploy the Next server runtime release. The project .env is packaged into the
# server release so production can start immediately with system AI config.

[CmdletBinding()]
param(
  [string]$DeployHost = "root@47.253.230.197",
  [string]$ReleaseRoot = "/opt/aicrew/releases",
  [string]$CurrentLink = "/opt/aicrew/current-server",
  [string]$AppName = "aicrew-studio",
  [string]$Domain = "songuu.top",
  [string]$BasePath = "/aicrew",
  [int]$Port = 3101,
  [string]$HostName = "127.0.0.1",
  [string]$EnvFile = ".env",
  [switch]$SkipTests,
  [switch]$SkipBuild,
  [switch]$SkipRemoteInstall,
  [switch]$SkipVerify,
  [switch]$DryRun,
  [switch]$KeepArchive
)

$ErrorActionPreference = "Stop"
$script:DryRunEnabled = [bool]$DryRun

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Clear-LocalReleaseArtifacts {
  if ($KeepArchive) { return }
  if ($script:LocalArchiveToClean -and (Test-Path -LiteralPath $script:LocalArchiveToClean)) {
    Remove-Item -LiteralPath $script:LocalArchiveToClean -Force -ErrorAction SilentlyContinue
  }
  if ($script:StageRootToClean -and (Test-Path -LiteralPath $script:StageRootToClean)) {
    Remove-Item -LiteralPath $script:StageRootToClean -Recurse -Force -ErrorAction SilentlyContinue
  }
}

trap {
  Clear-LocalReleaseArtifacts
  throw
}

function Step([string]$Message) {
  Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Normalize-BasePath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "/" }
  $normalized = $Value.Trim()
  if (-not $normalized.StartsWith("/")) { $normalized = "/$normalized" }
  if ($normalized.EndsWith("/") -and $normalized.Length -gt 1) {
    $normalized = $normalized.TrimEnd("/")
  }
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

function Require-Path([string]$PathValue, [string]$Kind) {
  if (-not (Test-Path -LiteralPath $PathValue)) {
    throw "Missing required ${Kind}: $PathValue"
  }
}

function Copy-ReleaseItem([string]$Source, [string]$DestinationRoot) {
  $leaf = Split-Path -Leaf $Source
  $destination = Join-Path $DestinationRoot $leaf
  if (Test-Path -LiteralPath $Source -PathType Container) {
    Copy-Item -LiteralPath $Source -Destination $destination -Recurse -Force
  } else {
    Copy-Item -LiteralPath $Source -Destination $destination -Force
  }
}

function Read-EnvNames([string]$PathValue) {
  $names = New-Object System.Collections.Generic.HashSet[string]
  foreach ($line in Get-Content -LiteralPath $PathValue) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
    $equals = $trimmed.IndexOf("=")
    if ($equals -le 0) { continue }
    [void]$names.Add($trimmed.Substring(0, $equals).Trim())
  }
  return $names
}

function Read-EnvValues([string]$PathValue) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $PathValue) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
    $equals = $trimmed.IndexOf("=")
    if ($equals -le 0) { continue }
    $name = $trimmed.Substring(0, $equals).Trim()
    $value = $trimmed.Substring($equals + 1).Trim()
    if ($value.Length -ge 2) {
      $first = $value.Substring(0, 1)
      $last = $value.Substring($value.Length - 1, 1)
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    $values[$name] = $value
  }
  return $values
}

function Test-EnabledFlag([string]$Value, [bool]$Fallback) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Fallback }
  $disabledValues = @("0", "false", "off", "no", "disabled")
  return -not ($disabledValues -contains $Value.Trim().ToLowerInvariant())
}

function Write-ConfigLine([string]$Label, [string]$Value) {
  Write-Host ("  {0,-18} {1}" -f $Label, $Value)
}

$resolvedBasePath = Normalize-BasePath $BasePath
$resolvedEnvFile = Join-Path $RepoRoot $EnvFile

Step "Deploy config"
Write-ConfigLine "DeployHost" $DeployHost
Write-ConfigLine "ReleaseRoot" $ReleaseRoot
Write-ConfigLine "CurrentLink" $CurrentLink
Write-ConfigLine "PM2 app" $AppName
Write-ConfigLine "Domain" $Domain
Write-ConfigLine "BasePath" $resolvedBasePath
Write-ConfigLine "Next server" "$HostName`:$Port"
Write-ConfigLine "Env file" $EnvFile

Step "Project env gate"
Require-Path $resolvedEnvFile "project env file"
$envNames = Read-EnvNames $resolvedEnvFile
$envValues = Read-EnvValues $resolvedEnvFile
$requiredEnv = @("AICREW_AI_BASE_URL", "AICREW_AI_API_KEY", "AICREW_AI_TEXT_MODEL")
$missingEnv = @($requiredEnv | Where-Object { -not $envNames.Contains($_) })
if ($missingEnv.Count -gt 0) {
  throw "Missing required env values in ${EnvFile}: $($missingEnv -join ', ')"
}
$creditsFlagValue = $null
if ($envValues.ContainsKey("NEXT_PUBLIC_AICREW_CREDITS_ENABLED")) {
  $creditsFlagValue = $envValues["NEXT_PUBLIC_AICREW_CREDITS_ENABLED"]
} elseif ($envValues.ContainsKey("AICREW_CREDITS_ENABLED")) {
  $creditsFlagValue = $envValues["AICREW_CREDITS_ENABLED"]
}
$expectedCreditsEnabled = Test-EnabledFlag $creditsFlagValue $true
$creditsExpectationLabel = if ($expectedCreditsEnabled) { "enabled" } else { "disabled" }
Write-Host "Project env present: $EnvFile"
Write-Host "Required AI env present: $($requiredEnv -join ', ')"
Write-Host "Credits system expected: $creditsExpectationLabel"

if ($DryRun) {
  Write-Host "DryRun: config and env gate only. No tests, build, upload, remote swap, or verification." -ForegroundColor Yellow
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
  Write-Host "Skipping build (-SkipBuild). Reusing .next/." -ForegroundColor Yellow
}

Step "Build self-check"
Require-Path ".next" "Next build directory"
Require-Path ".next/server" "Next server output"
Require-Path "app/api/ai/config/route.ts" "AI config route"
Require-Path "app/api/ai/generate/route.ts" "AI generate route"

$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$releaseName = "aicrew-server-$timestamp"
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) $releaseName
$archiveName = "$releaseName.tgz"
$localArchive = Join-Path ([System.IO.Path]::GetTempPath()) $archiveName
$remoteArchive = "/tmp/$archiveName"
$remoteRelease = "$ReleaseRoot/$releaseName"
$script:StageRootToClean = $stageRoot
$script:LocalArchiveToClean = $localArchive

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot | Out-Null

Step "Prepare release package"
$releaseItems = @("app", "components", "lib", "styles", ".next", "package.json", "package-lock.json", "next.config.mjs", "tsconfig.json", "next-env.d.ts", $EnvFile)
if (Test-Path -LiteralPath "public") { $releaseItems += "public" }
foreach ($item in $releaseItems) {
  Require-Path $item "release item"
  Copy-ReleaseItem $item $stageRoot
}
$nextCache = Join-Path $stageRoot ".next/cache"
if (Test-Path -LiteralPath $nextCache) {
  Remove-Item -LiteralPath $nextCache -Recurse -Force
}
Write-Host "Release includes .env for server runtime. Secret values are not printed."

if (Test-Path -LiteralPath $localArchive) {
  Remove-Item -LiteralPath $localArchive -Force
}
Invoke-Native "tar" @("-czf", $localArchive, "-C", $stageRoot, ".")

Step "Upload release archive"
Invoke-Native "scp" @("-o", "BatchMode=yes", $localArchive, "${DeployHost}:$remoteArchive")

Step "Remote release + PM2 restart"
$quotedReleaseRoot = Quote-BashValue $ReleaseRoot
$quotedCurrentLink = Quote-BashValue $CurrentLink
$quotedRemoteArchive = Quote-BashValue $remoteArchive
$quotedRemoteRelease = Quote-BashValue $remoteRelease
$quotedAppName = Quote-BashValue $AppName
$quotedHostName = Quote-BashValue $HostName
$quotedPort = Quote-BashValue ([string]$Port)

$installCommand = 'runtime_deps_match() { node -e ''const fs=require("fs"); const [currentPath,releasePath]=process.argv.slice(1); const pick=(root)=>{const pkg=JSON.parse(fs.readFileSync(`${root}/package.json`,"utf8")); return JSON.stringify({dependencies:pkg.dependencies||{},optionalDependencies:pkg.optionalDependencies||{},peerDependencies:pkg.peerDependencies||{},overrides:pkg.overrides||{}});}; process.exit(pick(currentPath)===pick(releasePath)?0:1);'' "$C" "$D"; }; if [ -d "$C/node_modules" ] && { cmp -s "$C/package-lock.json" "$D/package-lock.json" || runtime_deps_match; }; then cp -a "$C/node_modules" "$D/node_modules"; echo "Reused current node_modules"; else npm ci --omit=dev --no-audit --no-fund; fi'
if ($SkipRemoteInstall) {
  $installCommand = "echo 'Skipping remote dependency install'"
}

$remoteDeploy = @(
  "set -e",
  "R=$quotedReleaseRoot",
  "C=$quotedCurrentLink",
  "T=$quotedRemoteArchive",
  "D=$quotedRemoteRelease",
  "APP=$quotedAppName",
  "HOST=$quotedHostName",
  "PORT=$quotedPort",
  'DEPLOY_SWITCHED=0',
  'trap ''rm -f "$T"; if [ "$DEPLOY_SWITCHED" != "1" ]; then rm -rf "$D"; fi'' EXIT',
  'mkdir -p "$R"',
  'rm -rf "$D"',
  'mkdir -p "$D"',
  'tar -xzf "$T" -C "$D"',
  'test -f "$D/.env"',
  'chmod 600 "$D/.env"',
  'cd "$D"',
  $installCommand,
  'ln -sfn "$D" "${C}.next"',
  'mv -Tf "${C}.next" "$C"',
  'DEPLOY_SWITCHED=1',
  'if pm2 describe "$APP" >/dev/null 2>&1; then pm2 restart "$APP" --update-env; else HOSTNAME="$HOST" PORT="$PORT" pm2 start npm --name "$APP" --cwd "$C" -- start; fi',
  'pm2 save',
  'rm -f "$T"',
  'echo "CURRENT_SERVER=$(readlink -f "$C")"',
  'echo "ENV_FILE=$D/.env"',
  'echo "ENV_PERMS=$(stat -c %a "$D/.env")"'
) -join '; '
Invoke-Native "ssh" @("-o", "BatchMode=yes", $DeployHost, $remoteDeploy)

if (-not $SkipVerify) {
  Step "Remote verification"
  $quotedDirectUrl = Quote-BashValue "http://$HostName`:$Port$resolvedBasePath/api/ai/config/"
  $quotedLoopbackUrl = Quote-BashValue "https://127.0.0.1$resolvedBasePath/api/ai/config/"
  $quotedDomainHeader = Quote-BashValue "Host: $Domain"
  $expectedCreditsJson = if ($expectedCreditsEnabled) { '"creditsEnabled":true' } else { '"creditsEnabled":false' }
  $quotedExpectedCreditsJson = Quote-BashValue $expectedCreditsJson
  $verify = @(
    "set -e",
    "DIRECT=$quotedDirectUrl",
    "LOOP=$quotedLoopbackUrl",
    "H=$quotedDomainHeader",
    "EXPECT_CREDITS=$quotedExpectedCreditsJson",
    'direct_json=$(curl -fsSL "$DIRECT")',
    'echo "$direct_json" | grep -q ''"configured":true''',
    'echo "$direct_json" | grep -q "$EXPECT_CREDITS"',
    'loop_json=$(curl -fkSLsS -H "$H" "$LOOP")',
    'echo "$loop_json" | grep -q ''"configured":true''',
    'echo "$loop_json" | grep -q "$EXPECT_CREDITS"',
    'echo "AI config route verified ($EXPECT_CREDITS)"'
  ) -join '; '
  Invoke-Native "ssh" @("-o", "BatchMode=yes", $DeployHost, $verify)

  Step "Public HTTPS verification"
  $publicUrl = "https://$Domain$resolvedBasePath/"
  $status = (curl.exe -k -s -o NUL -w "%{http_code}" $publicUrl)
  Write-Host "$publicUrl -> $status"
  if ($status -ne "200") {
    throw "Public verification failed: $publicUrl -> $status"
  }
}

if (-not $KeepArchive) {
  Remove-Item -LiteralPath $localArchive -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Step "Deploy complete"
Write-Host "Target: https://$Domain$resolvedBasePath/" -ForegroundColor Green
Write-Host "Server env: $remoteRelease/.env" -ForegroundColor Green








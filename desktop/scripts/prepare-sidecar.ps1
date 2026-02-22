Param(
  [string]$TargetTriple = ""
)

$ErrorActionPreference = "Stop"

function Get-HostTriple {
  try {
    $t = (& rustc --print host-tuple).Trim()
    if ($t) { return $t }
  } catch {}

  $vv = (& rustc -Vv)
  foreach ($line in $vv) {
    if ($line -match '^host:\s+(\S+)') { return $Matches[1] }
  }
  throw "Unable to determine Rust host triple"
}

if (-not $TargetTriple) {
  $TargetTriple = Get-HostTriple
}

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "../..")
$ServerManifest = Join-Path $RootDir "server/Cargo.toml"
$TauriBinDir = Join-Path $RootDir "desktop/src-tauri/binaries"

$Ext = ""
if ($TargetTriple -match 'windows') { $Ext = ".exe" }

Write-Host "Building server sidecar for $TargetTriple..."
& cargo build --manifest-path "$ServerManifest" --release --target "$TargetTriple" --locked

$SrcBin = Join-Path $RootDir "server/target/$TargetTriple/release/opencode-studio$Ext"
if (-not (Test-Path $SrcBin)) {
  throw "Built binary not found at: $SrcBin"
}

New-Item -ItemType Directory -Force -Path $TauriBinDir | Out-Null
$DestBin = Join-Path $TauriBinDir "opencode-studio-$TargetTriple$Ext"
Copy-Item -Force $SrcBin $DestBin

Write-Host "Sidecar ready: $DestBin"

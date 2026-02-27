Param(
  [ValidateSet("desktop", "headless")]
  [string]$Variant = "desktop",
  [string]$Repo = "canxin121/opencode-studio",
  [string]$Version = "",
  [string]$InstallDir = "",
  [string]$Host = "127.0.0.1",
  [ValidateRange(1, 65535)]
  [int]$Port = 3000,
  [string]$ServiceName = "OpenCodeStudio"
)

$ErrorActionPreference = "Stop"

function Get-TargetCandidates {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch) {
    "Arm64" { return @("aarch64-pc-windows-msvc", "x86_64-pc-windows-msvc") }
    "X64" { return @("x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc") }
    default { throw "Unsupported Windows architecture for installer: $arch" }
  }
}

function Get-ReleaseJson {
  if ($Version) {
    $url = "https://api.github.com/repos/$Repo/releases/tags/$Version"
  } else {
    $url = "https://api.github.com/repos/$Repo/releases/latest"
  }
  return Invoke-RestMethod -Uri $url -Headers @{"User-Agent"="opencode-studio-installer"}
}

function Find-AssetUrl([object]$Release, [string]$Name) {
  foreach ($asset in $Release.assets) {
    if ($asset.name -eq $Name) {
      return $asset.browser_download_url
    }
  }
  throw "Asset not found in release: $Name"
}

function Find-FirstAsset([object]$Release, [string[]]$Names) {
  foreach ($name in $Names) {
    foreach ($asset in $Release.assets) {
      if ($asset.name -eq $name) {
        return $asset
      }
    }
  }
  throw "Asset not found in release. Tried: $($Names -join ', ')"
}

function Download([string]$Url, [string]$OutFile) {
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile
}

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "OpenCodeStudio"
}

$BinDir = Join-Path $InstallDir "bin"
$UiDir = Join-Path $InstallDir "ui\dist"
$ConfigFile = Join-Path $BinDir "opencode-studio.toml"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$Targets = Get-TargetCandidates
$Release = Get-ReleaseJson
$TagName = $Release.tag_name
if (-not $TagName) {
  throw "Failed to determine release tag_name"
}

$Tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP ("ocstudio-" + [Guid]::NewGuid().ToString()))
try {
  $BackendCandidates = @()
  foreach ($target in $Targets) {
    $BackendCandidates += "opencode-studio-backend-$target-$TagName.zip"
  }
  foreach ($target in $Targets) {
    $BackendCandidates += "opencode-studio-$target.zip"
  }

  $BackendAsset = Find-FirstAsset $Release $BackendCandidates
  $BackendUrl = $BackendAsset.browser_download_url
  $BackendZip = Join-Path $Tmp $BackendAsset.name
  Download $BackendUrl $BackendZip
  Expand-Archive -Force -Path $BackendZip -DestinationPath $Tmp

  $BackendExe = Join-Path $Tmp "opencode-studio.exe"
  if (-not (Test-Path $BackendExe)) {
    throw "Unexpected archive layout; expected opencode-studio.exe"
  }

  $BackendInstall = Join-Path $BinDir "opencode-studio.exe"
  Copy-Item -Force $BackendExe $BackendInstall

  if ($Variant -eq "desktop") {
    $WebAsset = "opencode-studio-web-dist-$TagName.zip"
    $WebUrl = Find-AssetUrl $Release $WebAsset
    $WebZip = Join-Path $Tmp $WebAsset
    Download $WebUrl $WebZip

    $UiRoot = Join-Path $InstallDir "ui"
    if (Test-Path $UiRoot) {
      Remove-Item -Recurse -Force $UiRoot
    }
    New-Item -ItemType Directory -Force -Path $UiRoot | Out-Null
    Expand-Archive -Force -Path $WebZip -DestinationPath $UiRoot

    if (-not (Test-Path (Join-Path $UiDir "index.html"))) {
      throw "Unexpected web archive layout; expected dist/index.html"
    }
  }

  $TomlLines = @(
    "# Runtime configuration for opencode-studio.",
    "# CLI flags and environment variables can still override these values.",
    "",
    "[backend]",
    "host = '$Host'",
    "port = $Port",
    "skip_opencode_start = false",
    "opencode_host = '127.0.0.1'",
    "",
    "# To connect to an already running OpenCode, set:",
    "# opencode_port = 16000"
  )
  if ($Variant -eq "desktop") {
    $TomlLines += "ui_dir = '$UiDir'"
  }
  $TomlLines | Set-Content -Encoding UTF8 -Path $ConfigFile

  $Args = @("--config", $ConfigFile)

  $QuotedExe = '"' + $BackendInstall + '"'
  $BinPathWithArgs = $QuotedExe + " " + ($Args -join " ")

  Write-Host "Configuring Windows service (auto start): $ServiceName"
  & sc.exe stop $ServiceName | Out-Null 2>$null
  & sc.exe delete $ServiceName | Out-Null 2>$null
  & sc.exe create $ServiceName binPath= $BinPathWithArgs start= auto | Out-Null
  & sc.exe start $ServiceName | Out-Null

  Write-Host "Wrote runtime config: $ConfigFile"
  Write-Host "Install complete ($Variant). Service: $ServiceName"
  Write-Host "Open: http://$Host`:$Port"
  if ($Variant -eq "headless") {
    Write-Host "Headless mode: no bundled UI installed (API/service only)."
  }
} finally {
  Remove-Item -Recurse -Force $Tmp | Out-Null
}

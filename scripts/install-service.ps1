Param(
  [string]$Repo = "canxin121/opencode-studio",
  [string]$Version = "",
  [switch]$WithFrontend,
  [string]$InstallDir = "",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name, [string]$Hint = "") {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    if ($Hint) {
      throw "Missing dependency: $Name. $Hint"
    }
    throw "Missing dependency: $Name"
  }
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "This installer must run in an elevated PowerShell (Run as Administrator)."
}

Require-Command "sc.exe" "Windows service management requires sc.exe."
Require-Command "opencode" "Install OpenCode first (for example: scoop install opencode, choco install opencode, or npm i -g opencode-ai@latest)."

function Get-TargetTriple {
  # GitHub Actions + release assets currently publish x64 Windows builds.
  return "x86_64-pc-windows-msvc"
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
  foreach ($a in $Release.assets) {
    if ($a.name -eq $Name) { return $a.browser_download_url }
  }
  throw "Asset not found in release: $Name"
}

function Download([string]$Url, [string]$OutFile) {
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile
}

$Target = Get-TargetTriple
$Release = Get-ReleaseJson
$TagName = $Release.tag_name
if (-not $TagName) { throw "Failed to determine release tag_name" }

if (-not $InstallDir) {
  $InstallDir = Join-Path $HOME "opencode-studio"
}

$BinDir = Join-Path $InstallDir "bin"
$UiDir = Join-Path $InstallDir "dist"
$ConfigFile = Join-Path $InstallDir "opencode-studio.toml"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$Tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP ("ocstudio-" + [Guid]::NewGuid().ToString()))
try {
  $BackendAsset = "opencode-studio-$Target.zip"
  $BackendUrl = Find-AssetUrl $Release $BackendAsset
  $BackendZip = Join-Path $Tmp $BackendAsset
  Download $BackendUrl $BackendZip
  Expand-Archive -Force -Path $BackendZip -DestinationPath $Tmp

  $BackendExe = Join-Path $Tmp "opencode-studio.exe"
  if (-not (Test-Path $BackendExe)) { throw "Unexpected archive layout; expected opencode-studio.exe" }
  $BackendInstall = Join-Path $BinDir "opencode-studio.exe"
  Copy-Item -Force $BackendExe $BackendInstall

  if ($WithFrontend) {
    $WebAsset = "opencode-studio-web-dist-$TagName.zip"
    $WebUrl = Find-AssetUrl $Release $WebAsset
    $WebZip = Join-Path $Tmp $WebAsset
    Download $WebUrl $WebZip
    if (Test-Path $UiDir) {
      Remove-Item -Recurse -Force $UiDir
    }
    $LegacyUiDir = Join-Path $InstallDir "ui"
    if (Test-Path $LegacyUiDir) {
      Remove-Item -Recurse -Force $LegacyUiDir
    }
    Expand-Archive -Force -Path $WebZip -DestinationPath $InstallDir
    if (-not (Test-Path (Join-Path $UiDir "index.html"))) {
      throw "Unexpected web archive layout; expected dist/index.html"
    }
  }

  # Install Windows service. Requires an elevated PowerShell.
  $ServiceName = "OpenCodeStudio"
  $BinPath = $BackendInstall

  $TomlLines = @(
    "# Runtime configuration for opencode-studio.",
    "",
    "[backend]",
    "host = '127.0.0.1'",
    "port = $Port",
    "skip_opencode_start = false",
    "opencode_host = '127.0.0.1'",
    "",
    "# To connect to an already running OpenCode, set:",
    "# opencode_port = 16000"
  )
  if ($WithFrontend) {
    $TomlLines += "ui_dir = '$UiDir'"
  }
  $TomlLines | Set-Content -Encoding UTF8 -Path $ConfigFile

  $BinPathWithArgs = '"' + $BinPath + '" --config "' + $ConfigFile + '"'

  Write-Host "Creating Windows service $ServiceName"
  & sc.exe stop $ServiceName | Out-Null 2>$null
  & sc.exe delete $ServiceName | Out-Null 2>$null
  & sc.exe create $ServiceName binPath= $BinPathWithArgs start= auto | Out-Null
  & sc.exe start $ServiceName | Out-Null

  Write-Host "Installed. Service: $ServiceName"
  Write-Host "Runtime config: $ConfigFile"
  Write-Host "Open: http://127.0.0.1:$Port"
} finally {
  Remove-Item -Recurse -Force $Tmp | Out-Null
}

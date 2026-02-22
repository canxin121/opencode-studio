Param(
  [string]$Repo = "canxin121/opencode-studio",
  [string]$Version = "",
  [switch]$WithFrontend,
  [string]$InstallDir = "",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

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
  $InstallDir = Join-Path $env:LOCALAPPDATA "OpenCodeStudio"
}

$BinDir = Join-Path $InstallDir "bin"
$UiDir = Join-Path $InstallDir "ui\dist"
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
    if (Test-Path (Join-Path $InstallDir "ui")) {
      Remove-Item -Recurse -Force (Join-Path $InstallDir "ui")
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "ui") | Out-Null
    Expand-Archive -Force -Path $WebZip -DestinationPath (Join-Path $InstallDir "ui")
    if (-not (Test-Path (Join-Path $UiDir "index.html"))) {
      throw "Unexpected web archive layout; expected dist/index.html"
    }
  }

  # Install Windows service. Requires an elevated PowerShell.
  $ServiceName = "OpenCodeStudio"
  $BinPath = $BackendInstall

  $Args = @("--host","127.0.0.1","--port", "$Port")
  if ($WithFrontend) {
    $Args += @("--ui-dir", $UiDir)
  }

  $BinPathWithArgs = '"' + $BinPath + '" ' + ($Args -join ' ')

  Write-Host "Creating Windows service $ServiceName"
  & sc.exe stop $ServiceName | Out-Null 2>$null
  & sc.exe delete $ServiceName | Out-Null 2>$null
  & sc.exe create $ServiceName binPath= $BinPathWithArgs start= auto | Out-Null
  & sc.exe start $ServiceName | Out-Null

  Write-Host "Installed. Service: $ServiceName"
  Write-Host "Open: http://127.0.0.1:$Port"
} finally {
  Remove-Item -Recurse -Force $Tmp | Out-Null
}

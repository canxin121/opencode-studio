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

function Get-TargetTriple {
  # Current releases publish x64 Windows artifacts.
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
  foreach ($asset in $Release.assets) {
    if ($asset.name -eq $Name) {
      return $asset.browser_download_url
    }
  }
  throw "Asset not found in release: $Name"
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
$EnvFile = Join-Path $InstallDir "service.env.ps1"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$Target = Get-TargetTriple
$Release = Get-ReleaseJson
$TagName = $Release.tag_name
if (-not $TagName) {
  throw "Failed to determine release tag_name"
}

$Tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP ("ocstudio-" + [Guid]::NewGuid().ToString()))
try {
  $BackendAsset = "opencode-studio-$Target.zip"
  $BackendUrl = Find-AssetUrl $Release $BackendAsset
  $BackendZip = Join-Path $Tmp $BackendAsset
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

  @(
    "# Variables used by the installer-generated Windows service.",
    "`$Host = '$Host'",
    "`$Port = $Port",
    "`$Variant = '$Variant'",
    "`$InstallDir = '$InstallDir'",
    "`$ServiceName = '$ServiceName'"
  ) | Set-Content -Encoding UTF8 -Path $EnvFile

  $Args = @("--host", $Host, "--port", "$Port")
  if ($Variant -eq "desktop") {
    $Args += @("--ui-dir", $UiDir)
  }

  $QuotedExe = '"' + $BackendInstall + '"'
  $BinPathWithArgs = $QuotedExe + " " + ($Args -join " ")

  Write-Host "Configuring Windows service (auto start): $ServiceName"
  & sc.exe stop $ServiceName | Out-Null 2>$null
  & sc.exe delete $ServiceName | Out-Null 2>$null
  & sc.exe create $ServiceName binPath= $BinPathWithArgs start= auto | Out-Null
  & sc.exe start $ServiceName | Out-Null

  Write-Host "Wrote installer state: $EnvFile"
  Write-Host "Install complete ($Variant). Service: $ServiceName"
  Write-Host "Open: http://$Host`:$Port"
  if ($Variant -eq "headless") {
    Write-Host "Headless mode: no bundled UI installed (API/service only)."
  }
} finally {
  Remove-Item -Recurse -Force $Tmp | Out-Null
}

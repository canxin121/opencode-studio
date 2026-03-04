Param(
  [ValidateSet("desktop", "headless")]
  [string]$Variant = "desktop",
  [string]$Repo = "canxin121/opencode-studio",
  [string]$Version = "",
  [string]$InstallDir = "",
  [string]$Host = "127.0.0.1",
  [ValidateRange(1, 65535)]
  [int]$Port = 3210,
  [string]$ServiceName = "OpenCodeStudio",
  [string]$UiPassword = ""
)

$ErrorActionPreference = "Stop"

function Invoke-ScCommand {
  Param(
    [string[]]$Arguments,
    [int[]]$AllowedExitCodes = @(0),
    [string]$ErrorMessage = "sc.exe command failed"
  )

  $output = & sc.exe @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($AllowedExitCodes -contains $exitCode) {
    return
  }

  $details = (($output | ForEach-Object { $_.ToString().TrimEnd() }) -join [Environment]::NewLine).Trim()
  if ($details) {
    throw "$ErrorMessage (exit code $exitCode).`n$details"
  }
  throw "$ErrorMessage (exit code $exitCode)."
}

function Invoke-ExeCommand {
  Param(
    [string]$ExePath,
    [string[]]$Arguments,
    [int[]]$AllowedExitCodes = @(0),
    [string]$ErrorMessage = "External command failed"
  )

  $output = & $ExePath @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($AllowedExitCodes -contains $exitCode) {
    return
  }

  $details = (($output | ForEach-Object { $_.ToString().TrimEnd() }) -join [Environment]::NewLine).Trim()
  if ($details) {
    throw "$ErrorMessage (exit code $exitCode).`n$details"
  }
  throw "$ErrorMessage (exit code $exitCode)."
}

function Get-GitHubHeaders {
  $headers = @{ "User-Agent" = "opencode-studio-installer" }
  if ($env:GITHUB_TOKEN) {
    $headers["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
  } elseif ($env:GH_TOKEN) {
    $headers["Authorization"] = "Bearer $($env:GH_TOKEN)"
  }
  return $headers
}

function Ensure-Nssm([string]$InstallDir, [string]$TmpDir) {
  $cmd = Get-Command "nssm.exe" -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $toolsDir = Join-Path $InstallDir "tools"
  $bundled = Join-Path $toolsDir "nssm.exe"
  if (Test-Path $bundled) {
    return $bundled
  }

  $archive = Join-Path $TmpDir "nssm-2.24.zip"
  $cacheArchive = Join-Path $env:TEMP "opencode-studio-nssm-2.24.zip"
  if (Test-Path $cacheArchive) {
    Copy-Item -Force $cacheArchive $archive
  } else {
    Download "https://nssm.cc/release/nssm-2.24.zip" $archive
    Copy-Item -Force $archive $cacheArchive
  }
  $extractDir = Join-Path $TmpDir "nssm"
  Expand-Archive -Force -Path $archive -DestinationPath $extractDir

  $candidates = @(
    (Join-Path $extractDir "nssm-2.24\\win64\\nssm.exe"),
    (Join-Path $extractDir "nssm-2.24\\win32\\nssm.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
      Copy-Item -Force $candidate $bundled
      return $bundled
    }
  }

  throw "Failed to install NSSM wrapper (nssm.exe not found in downloaded archive)."
}

function Wait-HealthEndpoint([string]$Url, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return
      }
    } catch {
    }
    Start-Sleep -Seconds 1
  }

  throw "Service health check timed out at $Url"
}

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
  return Invoke-RestMethod -Uri $url -Headers (Get-GitHubHeaders)
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

if ([string]::IsNullOrWhiteSpace($Host)) {
  throw "Host must be a non-empty hostname or IP address."
}

function Convert-ToTomlBasicString([string]$Value) {
  if ($null -eq $Value) {
    $Value = ""
  }
  $escaped = $Value `
    -replace '\\', '\\\\' `
    -replace '"', '\"' `
    -replace "`t", '\t' `
    -replace "`r", '\r' `
    -replace "`n", '\n'
  return '"' + $escaped + '"'
}

function Resolve-HealthHost([string]$BindHost) {
  $host = if ($null -eq $BindHost) { "" } else { $BindHost.Trim() }
  if (-not $host) {
    return "127.0.0.1"
  }
  if ($host -eq "0.0.0.0") {
    return "127.0.0.1"
  }
  if ($host -eq "::" -or $host -eq "[::]") {
    return "::1"
  }
  return $host
}

function Format-HttpUrl([string]$Address, [int]$Port) {
  $host = if ($null -eq $Address) { "" } else { $Address.Trim() }
  if (-not $host) {
    $host = "127.0.0.1"
  }
  if ($host.Contains(":")) {
    if (-not ($host.StartsWith("[") -and $host.EndsWith("]"))) {
      $host = "[$host]"
    }
  }
  return "http://$host`:$Port"
}

function Resolve-InstallerProfileContext {
  $home = ""
  foreach ($candidate in @($env:HOME, $env:USERPROFILE, [Environment]::GetFolderPath("UserProfile"))) {
    $value = if ($null -eq $candidate) { "" } else { $candidate.ToString().Trim() }
    if ($value) {
      $home = $value
      break
    }
  }
  if (-not $home) {
    throw "Unable to resolve installer user profile directory."
  }

  $appData = [Environment]::GetFolderPath("ApplicationData")
  if (-not $appData) {
    $appData = Join-Path $home "AppData\Roaming"
  }

  $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
  if (-not $localAppData) {
    $localAppData = Join-Path $home "AppData\Local"
  }

  $homeConfigDir = Join-Path $home ".config"
  $homeOpenCodeDir = Join-Path $homeConfigDir "opencode"
  $appDataOpenCodeDir = Join-Path $appData "opencode"

  $openCodeConfig = ""
  $openCodeConfigCandidates = @(
    (Join-Path $homeOpenCodeDir "opencode.jsonc"),
    (Join-Path $homeOpenCodeDir "opencode.json"),
    (Join-Path $homeOpenCodeDir "config.json"),
    (Join-Path $appDataOpenCodeDir "opencode.jsonc"),
    (Join-Path $appDataOpenCodeDir "opencode.json"),
    (Join-Path $appDataOpenCodeDir "config.json")
  )
  foreach ($candidate in $openCodeConfigCandidates) {
    if (Test-Path $candidate) {
      $openCodeConfig = $candidate
      break
    }
  }

  return @{
    Home = $home
    AppData = $appData
    LocalAppData = $localAppData
    XdgConfigHome = $homeConfigDir
    XdgDataHome = Join-Path (Join-Path $home ".local") "share"
    StudioDataDir = Join-Path $appData "opencode-studio"
    OpenCodeConfig = $openCodeConfig
  }
}

function Get-ServiceEnvironmentPairs([hashtable]$ProfileContext) {
  $pairs = @(
    "HOME=$($ProfileContext.Home)",
    "USERPROFILE=$($ProfileContext.Home)",
    "APPDATA=$($ProfileContext.AppData)",
    "LOCALAPPDATA=$($ProfileContext.LocalAppData)",
    "XDG_CONFIG_HOME=$($ProfileContext.XdgConfigHome)",
    "XDG_DATA_HOME=$($ProfileContext.XdgDataHome)",
    "OPENCODE_STUDIO_DATA_DIR=$($ProfileContext.StudioDataDir)"
  )

  $openCodeConfig = if ($null -eq $ProfileContext.OpenCodeConfig) { "" } else { $ProfileContext.OpenCodeConfig.ToString().Trim() }
  if ($openCodeConfig) {
    $pairs += "OPENCODE_CONFIG=$openCodeConfig"
  }
  return $pairs
}

function Configure-NssmServiceContext {
  Param(
    [string]$NssmExe,
    [string]$ServiceName,
    [string]$AppDirectory,
    [string[]]$EnvironmentPairs
  )

  Invoke-ExeCommand -ExePath $NssmExe -Arguments @("set", $ServiceName, "AppDirectory", $AppDirectory) -ErrorMessage "Failed to set app directory for service '$ServiceName'"
  $envArgs = @("set", $ServiceName, "AppEnvironmentExtra")
  $envArgs += $EnvironmentPairs
  Invoke-ExeCommand -ExePath $NssmExe -Arguments $envArgs -ErrorMessage "Failed to set environment for service '$ServiceName'"
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
    "host = $(Convert-ToTomlBasicString $Host)",
    "port = $Port",
    "# Optional UI session password. Keep empty to disable password login.",
    "ui_password = $(Convert-ToTomlBasicString $UiPassword)",
    "skip_opencode_start = true",
    "opencode_host = '127.0.0.1'",
    "opencode_port = 16000",
    "",
    "# To disable managed OpenCode service, remove opencode_port and adjust skip_opencode_start."
  )
  if ($Variant -eq "desktop") {
    $TomlLines += "ui_dir = '$UiDir'"
  }
  $TomlLines | Set-Content -Encoding UTF8 -Path $ConfigFile

  $NssmExe = Ensure-Nssm -InstallDir $InstallDir -TmpDir $Tmp
  $ProfileContext = Resolve-InstallerProfileContext
  $ServiceEnvironmentPairs = Get-ServiceEnvironmentPairs -ProfileContext $ProfileContext
  $OpenCodeServiceName = "$ServiceName-OpenCode"
  $OpenCodeExe = (Get-Command "opencode").Source

  Write-Host "Configuring Windows OpenCode companion service (auto start): $OpenCodeServiceName"
  Invoke-ScCommand -Arguments @("stop", $OpenCodeServiceName) -AllowedExitCodes @(0, 1060, 1062) -ErrorMessage "Failed to stop existing service '$OpenCodeServiceName'"
  Invoke-ScCommand -Arguments @("delete", $OpenCodeServiceName) -AllowedExitCodes @(0, 1060, 1072) -ErrorMessage "Failed to delete existing service '$OpenCodeServiceName'"
  Invoke-ExeCommand -ExePath $NssmExe -Arguments @("install", $OpenCodeServiceName, $OpenCodeExe, "serve", "--port", "16000") -ErrorMessage "Failed to register service '$OpenCodeServiceName' with NSSM"
  Configure-NssmServiceContext -NssmExe $NssmExe -ServiceName $OpenCodeServiceName -AppDirectory $InstallDir -EnvironmentPairs $ServiceEnvironmentPairs
  Invoke-ExeCommand -ExePath $NssmExe -Arguments @("set", $OpenCodeServiceName, "Start", "SERVICE_AUTO_START") -ErrorMessage "Failed to set startup mode for service '$OpenCodeServiceName'"

  Write-Host "Configuring Windows service (auto start): $ServiceName"
  Invoke-ScCommand -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 1060, 1062) -ErrorMessage "Failed to stop existing service '$ServiceName'"
  Invoke-ScCommand -Arguments @("delete", $ServiceName) -AllowedExitCodes @(0, 1060, 1072) -ErrorMessage "Failed to delete existing service '$ServiceName'"
  Invoke-ExeCommand -ExePath $NssmExe -Arguments @("install", $ServiceName, $BackendInstall, "--config", $ConfigFile) -ErrorMessage "Failed to register service '$ServiceName' with NSSM"
  Configure-NssmServiceContext -NssmExe $NssmExe -ServiceName $ServiceName -AppDirectory $InstallDir -EnvironmentPairs $ServiceEnvironmentPairs
  Invoke-ExeCommand -ExePath $NssmExe -Arguments @("set", $ServiceName, "Start", "SERVICE_AUTO_START") -ErrorMessage "Failed to set startup mode for service '$ServiceName'"
  Invoke-ScCommand -Arguments @("config", $ServiceName, "depend=", $OpenCodeServiceName) -ErrorMessage "Failed to configure service dependency for '$ServiceName'"

  Invoke-ScCommand -Arguments @("start", $OpenCodeServiceName) -ErrorMessage "Failed to start service '$OpenCodeServiceName'"
  Invoke-ScCommand -Arguments @("start", $ServiceName) -ErrorMessage "Failed to start service '$ServiceName'"

  $HealthHost = Resolve-HealthHost $Host
  $HealthUrl = "$(Format-HttpUrl $HealthHost $Port)/health"
  Wait-HealthEndpoint -Url $HealthUrl

  Write-Host "Wrote runtime config: $ConfigFile"
  Write-Host "Install complete ($Variant). Service: $ServiceName"
  Write-Host "Managed OpenCode service: $OpenCodeServiceName (port 16000)"
  Write-Host "Service environment profile: $($ProfileContext.Home)"
  Write-Host "Open: $(Format-HttpUrl $HealthHost $Port)"
  if ($Variant -eq "headless") {
    Write-Host "Headless mode: no bundled UI installed (API/service only)."
  }
} finally {
  Remove-Item -Recurse -Force $Tmp | Out-Null
}

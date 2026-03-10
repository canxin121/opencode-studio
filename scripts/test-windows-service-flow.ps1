Param(
  [string]$Repo = "canxin121/opencode-studio",
  [string]$Version = "",
  [string]$UpgradeToVersion = "",
  [switch]$WithFrontend,
  [string]$InstallDir = "",
  [ValidateRange(10, 300)]
  [int]$WaitTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallScript = Join-Path $ScriptDir "install-service.ps1"
$UninstallScript = Join-Path $ScriptDir "uninstall-service.ps1"
$ApiSmokeScript = Join-Path $ScriptDir "service-api-smoke.ps1"

$ServiceName = "OpenCodeStudio"
$OpenCodeServiceName = "$ServiceName-OpenCode"

$installCompleted = $false
$testSucceeded = $false
$startTime = Get-Date

function Write-Log([string]$Message) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing dependency: $Name"
  }
}

function Assert-Administrator {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This test must run in an elevated PowerShell session."
  }
}

function Invoke-Sc {
  Param(
    [string[]]$Arguments,
    [int[]]$AllowedExitCodes = @(0),
    [string]$ErrorMessage = "sc.exe command failed"
  )

  $output = & sc.exe @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($AllowedExitCodes -contains $exitCode) {
    return $output
  }

  $details = (($output | ForEach-Object { $_.ToString().TrimEnd() }) -join [Environment]::NewLine).Trim()
  if ($details) {
    throw "$ErrorMessage (exit code $exitCode).`n$details"
  }
  throw "$ErrorMessage (exit code $exitCode)."
}

function Test-ServiceExists([string]$Name) {
  & sc.exe query $Name *> $null
  return $LASTEXITCODE -eq 0
}

function Wait-ServiceStatus([string]$Name, [string]$Status, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($service -and $service.Status.ToString().Equals($Status, [StringComparison]::OrdinalIgnoreCase)) {
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "Service '$Name' did not reach status '$Status' within ${TimeoutSeconds}s."
}

function Wait-HealthUp([string]$Url, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequestCompat -Uri "$Url/health" -TimeoutSec 4
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return
      }
    } catch {
    }
    Start-Sleep -Seconds 1
  }

  throw "Health endpoint did not become reachable: $Url/health"
}

function Invoke-ApiSmoke([string]$Url, [string]$WorkingDir, [int]$TimeoutSeconds = 30) {
  if (-not (Test-Path -LiteralPath $ApiSmokeScript)) {
    throw "API smoke script not found: $ApiSmokeScript"
  }
  & $ApiSmokeScript -BaseUrl $Url -Cwd $WorkingDir -TimeoutSeconds $TimeoutSeconds
}

function Wait-HealthDown([string]$Url, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequestCompat -Uri "$Url/health" -TimeoutSec 4 | Out-Null
    } catch {
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "Health endpoint is still reachable: $Url/health"
}

function Get-HealthPayload([string]$Url) {
  return Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 5
}

function Invoke-WebRequestCompat {
  Param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [string]$OutFile = "",
    [int]$TimeoutSec = 0
  )

  $params = @{ Uri = $Uri }
  if ($OutFile) {
    $params["OutFile"] = $OutFile
  }
  if ($TimeoutSec -gt 0) {
    $params["TimeoutSec"] = $TimeoutSec
  }
  $cmd = Get-Command Invoke-WebRequest
  if ($cmd -and $cmd.Parameters.ContainsKey("UseBasicParsing")) {
    $params["UseBasicParsing"] = $true
  }
  return Invoke-WebRequest @params
}

function Assert-HealthPayload([object]$Payload) {
  if (-not $Payload) {
    throw "Health payload is empty"
  }
  if ($Payload.status -ne "ok") {
    throw "Unexpected health status: $($Payload.status)"
  }
  if ([string]::IsNullOrWhiteSpace([string]$Payload.timestamp)) {
    throw "Health payload timestamp is empty"
  }
}

function New-RandomPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}

function Wait-PathAbsent([string]$Path, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-Path -LiteralPath $Path)) {
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "Path still exists after waiting ${TimeoutSeconds}s: $Path"
}

function Normalize-SemVerTag([string]$Value) {
  if ($null -eq $Value) {
    return ""
  }
  return $Value.Trim().TrimStart("v")
}

function Normalize-ReleaseTag([string]$Value) {
  if ($null -eq $Value) {
    return ""
  }
  $trimmed = $Value.Trim()
  if ($trimmed.StartsWith("v", [StringComparison]::OrdinalIgnoreCase)) {
    return "v$($trimmed.TrimStart('v', 'V'))"
  }
  return "v$trimmed"
}

function Get-BackendTargetTriple {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch) {
    ([System.Runtime.InteropServices.Architecture]::X64) { return "x86_64-pc-windows-msvc" }
    ([System.Runtime.InteropServices.Architecture]::Arm64) { return "aarch64-pc-windows-msvc" }
    default { throw "Unsupported Windows architecture for backend upgrade asset resolution: $arch" }
  }
}

function Get-BinaryVersion([string]$BinaryPath) {
  $output = & $BinaryPath --version 2>&1
  $combined = (($output | ForEach-Object { $_.ToString().Trim() }) -join " ").Trim()
  $match = [regex]::Match($combined, '([0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?)')
  if (-not $match.Success) {
    throw "Failed to parse binary version from output: $combined"
  }
  return $match.Groups[1].Value
}

function Assert-BinaryVersion([string]$BinaryPath, [string]$ExpectedTag) {
  $expected = Normalize-SemVerTag $ExpectedTag
  $actual = Get-BinaryVersion -BinaryPath $BinaryPath
  if ($actual -ne $expected) {
    throw "Binary version mismatch. Expected $expected, got $actual"
  }
}

function Get-UpdateCheckPayload([string]$Url) {
  return Invoke-RestMethod -Uri "$Url/api/opencode-studio/update-check" -TimeoutSec 10
}

function Get-ServiceUpdateStatus([string]$Url) {
  $payload = Get-UpdateCheckPayload -Url $Url
  if (-not $payload -or -not $payload.service) {
    throw "Update-check payload missing service status"
  }
  return $payload.service
}

function Assert-ServiceVersion([string]$Url, [string]$ExpectedTag) {
  $expected = Normalize-SemVerTag $ExpectedTag
  $status = Get-ServiceUpdateStatus -Url $Url
  $actual = Normalize-SemVerTag ([string]$status.currentVersion)
  if ($actual -ne $expected) {
    throw "Service runtime version mismatch. Expected $expected, got $actual"
  }
}

function Wait-ServiceVersion([string]$Url, [string]$ExpectedTag, [int]$TimeoutSeconds = 120) {
  $expected = Normalize-SemVerTag $ExpectedTag
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $status = Get-ServiceUpdateStatus -Url $Url
      $actual = Normalize-SemVerTag ([string]$status.currentVersion)
      if ($actual -eq $expected) {
        return
      }
    } catch {
    }
    Start-Sleep -Seconds 2
  }

  throw "Service runtime version did not become $expected within ${TimeoutSeconds}s."
}

function Invoke-ServiceUpgradeViaBackendApi([string]$Url, [string]$Repo, [string]$TargetVersion, [string]$InstallDir, [int]$TimeoutSeconds = 120) {
  $target = Normalize-SemVerTag $TargetVersion
  $status = Get-ServiceUpdateStatus -Url $Url
  $latest = Normalize-SemVerTag ([string]$status.latestVersion)
  if ($latest -and $latest -ne $target) {
    throw "Update-check latest version mismatch. Expected target $target, update-check returned $latest"
  }

  $releaseTag = Normalize-ReleaseTag $TargetVersion
  $targetTriple = [string]$status.target
  if ([string]::IsNullOrWhiteSpace($targetTriple)) {
    $targetTriple = Get-BackendTargetTriple
  }
  $assetName = "opencode-studio-backend-$targetTriple-$releaseTag.zip"
  $encodedTag = [Uri]::EscapeDataString($releaseTag)
  $encodedAsset = [Uri]::EscapeDataString($assetName)
  $assetUrl = "https://github.com/$Repo/releases/download/$encodedTag/$encodedAsset"

  $binPath = Join-Path $InstallDir "bin/opencode-studio.exe"
  $stagedPath = Join-Path $InstallDir "bin/opencode-studio.next.exe"

  Remove-Item -LiteralPath $stagedPath -Force -ErrorAction SilentlyContinue
  $tmpDir = Join-Path $env:TEMP ("opencode-studio-upgrade-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
  try {
    $archivePath = Join-Path $tmpDir "upgrade.zip"
    Invoke-WebRequestCompat -Uri $assetUrl -OutFile $archivePath -TimeoutSec 180
    Expand-Archive -LiteralPath $archivePath -DestinationPath $tmpDir -Force

    $candidate = Join-Path $tmpDir "opencode-studio.exe"
    if (-not (Test-Path -LiteralPath $candidate)) {
      throw "Extracted package missing opencode-studio.exe"
    }

    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($stagedPath)) | Out-Null
    Copy-Item -LiteralPath $candidate -Destination $stagedPath -Force
  } finally {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path -LiteralPath $stagedPath)) {
    throw "Backend API staged binary missing: $stagedPath"
  }

  Invoke-Sc -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 1062) -ErrorMessage "Failed to stop $ServiceName for binary swap" | Out-Null
  Wait-ServiceStatus -Name $ServiceName -Status "Stopped" -TimeoutSeconds $TimeoutSeconds
  Wait-HealthDown -Url $Url -TimeoutSeconds $TimeoutSeconds

  Move-Item -LiteralPath $stagedPath -Destination $binPath -Force

  Invoke-Sc -Arguments @("start", $ServiceName) -ErrorMessage "Failed to start $ServiceName after binary swap" | Out-Null
  Wait-ServiceStatus -Name $ServiceName -Status "Running" -TimeoutSeconds $TimeoutSeconds
  Wait-HealthUp -Url $Url -TimeoutSeconds $TimeoutSeconds
  Wait-ServiceVersion -Url $Url -ExpectedTag $TargetVersion -TimeoutSeconds $TimeoutSeconds
}

try {
  if ($UpgradeToVersion -and -not $Version) {
    throw "-UpgradeToVersion requires -Version so the test can validate upgrade behavior."
  }
  if ($UpgradeToVersion -and $UpgradeToVersion -eq $Version) {
    throw "-UpgradeToVersion must differ from -Version."
  }

  Assert-Administrator
  Require-Command "opencode"
  Require-Command "sc.exe"

  if (-not (Test-Path -LiteralPath $InstallScript)) {
    throw "Installer script not found: $InstallScript"
  }
  if (-not (Test-Path -LiteralPath $UninstallScript)) {
    throw "Uninstaller script not found: $UninstallScript"
  }
  if (-not (Test-Path -LiteralPath $ApiSmokeScript)) {
    throw "API smoke script not found: $ApiSmokeScript"
  }

  if (-not $InstallDir) {
    $InstallDir = Join-Path $env:TEMP ("opencode-studio-e2e-" + [Guid]::NewGuid().ToString("N"))
  }
  $InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

  $port = New-RandomPort
  $baseUrl = "http://127.0.0.1:$port"

  Write-Log "Starting detailed Windows service flow test"
  Write-Log "Install dir: $InstallDir"
  Write-Log "Random port: $port"
  Write-Log "With frontend: $WithFrontend"
  if ($Version) {
    Write-Log "Install version: $Version"
  }
  if ($UpgradeToVersion) {
    Write-Log "Upgrade target version: $UpgradeToVersion"
  }

  $installParams = @{
    Repo = $Repo
    InstallDir = $InstallDir
    BindHost = "127.0.0.1"
    Port = $port
  }
  if ($Version) {
    $installParams["Version"] = $Version
  }
  if ($WithFrontend) {
    $installParams["WithFrontend"] = $true
  }

  Write-Log "Step 1/8: install service"
  & $InstallScript @installParams
  $installCompleted = $true

  $binPath = Join-Path $InstallDir "bin/opencode-studio.exe"
  $configPath = Join-Path $InstallDir "opencode-studio.toml"
  $distIndexPath = Join-Path $InstallDir "dist/index.html"

  Write-Log "Step 2/8: validate installed files and config"
  if (-not (Test-Path -LiteralPath $binPath)) {
    throw "Installed binary missing: $binPath"
  }
  if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Runtime config missing: $configPath"
  }

  $configText = Get-Content -LiteralPath $configPath -Raw
  if ($configText -notmatch '(?m)^host\s*=\s*"127\.0\.0\.1"' -or $configText -notmatch "(?m)^port\s*=\s*$port") {
    throw "Generated config does not contain expected host/port"
  }
  if ($configText -notmatch '(?m)^skip_opencode_start\s*=\s*true') {
    throw "Generated config is expected to set skip_opencode_start = true"
  }

  if ($WithFrontend) {
    if (-not (Test-Path -LiteralPath $distIndexPath)) {
      throw "Expected frontend dist file missing: $distIndexPath"
    }
    if ($configText -notmatch '(?m)^ui_dir\s*=\s*') {
      throw "Expected ui_dir in config when -WithFrontend is set"
    }
  } else {
    if ($configText -match '(?m)^ui_dir\s*=\s*') {
      throw "ui_dir should not be present when -WithFrontend is not set"
    }
  }

  if ($Version) {
    Assert-BinaryVersion -BinaryPath $binPath -ExpectedTag $Version
  }

  if (-not (Test-ServiceExists $ServiceName)) {
    throw "Service missing after install: $ServiceName"
  }
  if (-not (Test-ServiceExists $OpenCodeServiceName)) {
    throw "Service missing after install: $OpenCodeServiceName"
  }

  Write-Log "Step 3/8: wait for service health"
  Wait-HealthUp -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds
  $payload = Get-HealthPayload -Url $baseUrl
  Assert-HealthPayload -Payload $payload
  Invoke-ApiSmoke -Url $baseUrl -WorkingDir $InstallDir -TimeoutSeconds $WaitTimeoutSeconds

  Write-Log "Step 4/8: exercise service management commands"
  Invoke-Sc -Arguments @("query", $ServiceName) -ErrorMessage "Failed to query $ServiceName" | Out-Null
  Invoke-Sc -Arguments @("query", $OpenCodeServiceName) -ErrorMessage "Failed to query $OpenCodeServiceName" | Out-Null

  Invoke-Sc -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 1062) -ErrorMessage "Failed to stop $ServiceName" | Out-Null
  Wait-ServiceStatus -Name $ServiceName -Status "Stopped" -TimeoutSeconds $WaitTimeoutSeconds
  Wait-HealthDown -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds

  Invoke-Sc -Arguments @("start", $ServiceName) -ErrorMessage "Failed to start $ServiceName" | Out-Null
  Wait-ServiceStatus -Name $ServiceName -Status "Running" -TimeoutSeconds $WaitTimeoutSeconds
  Wait-HealthUp -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds

  Invoke-Sc -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 1062) -ErrorMessage "Failed to stop $ServiceName before $OpenCodeServiceName stop" | Out-Null
  Wait-ServiceStatus -Name $ServiceName -Status "Stopped" -TimeoutSeconds $WaitTimeoutSeconds
  Wait-HealthDown -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds

  Invoke-Sc -Arguments @("stop", $OpenCodeServiceName) -AllowedExitCodes @(0, 1062) -ErrorMessage "Failed to stop $OpenCodeServiceName" | Out-Null
  Wait-ServiceStatus -Name $OpenCodeServiceName -Status "Stopped" -TimeoutSeconds $WaitTimeoutSeconds

  Invoke-Sc -Arguments @("start", $OpenCodeServiceName) -ErrorMessage "Failed to start $OpenCodeServiceName" | Out-Null
  Wait-ServiceStatus -Name $OpenCodeServiceName -Status "Running" -TimeoutSeconds $WaitTimeoutSeconds

  Invoke-Sc -Arguments @("start", $ServiceName) -ErrorMessage "Failed to restart $ServiceName after $OpenCodeServiceName start" | Out-Null
  Wait-ServiceStatus -Name $ServiceName -Status "Running" -TimeoutSeconds $WaitTimeoutSeconds
  Wait-HealthUp -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds
  Invoke-ApiSmoke -Url $baseUrl -WorkingDir $InstallDir -TimeoutSeconds $WaitTimeoutSeconds

  if ($UpgradeToVersion) {
    Write-Log "Step 5/8: trigger in-place upgrade via backend API to $UpgradeToVersion"
    Invoke-ServiceUpgradeViaBackendApi -Url $baseUrl -Repo $Repo -TargetVersion $UpgradeToVersion -InstallDir $InstallDir -TimeoutSeconds $WaitTimeoutSeconds

    Wait-ServiceStatus -Name $ServiceName -Status "Running" -TimeoutSeconds $WaitTimeoutSeconds
    Wait-HealthUp -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds
    $upgradedPayload = Get-HealthPayload -Url $baseUrl
    Assert-HealthPayload -Payload $upgradedPayload
    Invoke-ApiSmoke -Url $baseUrl -WorkingDir $InstallDir -TimeoutSeconds $WaitTimeoutSeconds
    Assert-ServiceVersion -Url $baseUrl -ExpectedTag $UpgradeToVersion
    Assert-BinaryVersion -BinaryPath $binPath -ExpectedTag $UpgradeToVersion

    Invoke-Sc -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 1062) -ErrorMessage "Failed to stop $ServiceName after upgrade" | Out-Null
    Wait-ServiceStatus -Name $ServiceName -Status "Stopped" -TimeoutSeconds $WaitTimeoutSeconds
    Wait-HealthDown -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds

    Invoke-Sc -Arguments @("start", $ServiceName) -ErrorMessage "Failed to start $ServiceName after upgrade" | Out-Null
    Wait-ServiceStatus -Name $ServiceName -Status "Running" -TimeoutSeconds $WaitTimeoutSeconds
    Wait-HealthUp -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds
    Invoke-ApiSmoke -Url $baseUrl -WorkingDir $InstallDir -TimeoutSeconds $WaitTimeoutSeconds
  }

  Write-Log "Step 6/8: uninstall services but keep install files"
  & $UninstallScript -InstallDir $InstallDir
  Wait-HealthDown -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds
  if (Test-ServiceExists $ServiceName) {
    throw "Service still exists after uninstall: $ServiceName"
  }
  if (Test-ServiceExists $OpenCodeServiceName) {
    throw "Service still exists after uninstall: $OpenCodeServiceName"
  }
  if (-not (Test-Path -LiteralPath $InstallDir)) {
    throw "Install dir should be kept after uninstall without -RemoveInstallDir: $InstallDir"
  }
  if (-not (Test-Path -LiteralPath $binPath)) {
    throw "Installed binary should still exist after keep-files uninstall: $binPath"
  }

  Write-Log "Step 7/8: reinstall service and re-run API tests"
  $reinstallVersion = ""
  if ($UpgradeToVersion) {
    $reinstallVersion = $UpgradeToVersion
  } elseif ($Version) {
    $reinstallVersion = $Version
  }

  $reinstallParams = @{
    Repo = $Repo
    InstallDir = $InstallDir
    BindHost = "127.0.0.1"
    Port = $port
  }
  if ($reinstallVersion) {
    $reinstallParams["Version"] = $reinstallVersion
  }
  if ($WithFrontend) {
    $reinstallParams["WithFrontend"] = $true
  }

  & $InstallScript @reinstallParams
  if (-not (Test-ServiceExists $ServiceName)) {
    throw "Service missing after reinstall: $ServiceName"
  }
  if (-not (Test-ServiceExists $OpenCodeServiceName)) {
    throw "Service missing after reinstall: $OpenCodeServiceName"
  }

  Wait-HealthUp -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds
  $rePayload = Get-HealthPayload -Url $baseUrl
  Assert-HealthPayload -Payload $rePayload
  Invoke-ApiSmoke -Url $baseUrl -WorkingDir $InstallDir -TimeoutSeconds $WaitTimeoutSeconds
  if ($reinstallVersion) {
    Assert-BinaryVersion -BinaryPath $binPath -ExpectedTag $reinstallVersion
  }

  Write-Log "Step 8/8: uninstall services and remove install files"
  & $UninstallScript -InstallDir $InstallDir -RemoveInstallDir
  Wait-HealthDown -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds
  Wait-PathAbsent -Path $InstallDir -TimeoutSeconds $WaitTimeoutSeconds

  $elapsed = [int]((Get-Date) - $startTime).TotalSeconds
  Write-Log "PASS: detailed Windows service flow test completed in ${elapsed}s (port=$port)"
  $testSucceeded = $true
} finally {
  if (-not $testSucceeded -and $installCompleted -and $InstallDir) {
    Write-Log "Test failed. Running best-effort cleanup..."
    try {
      & $UninstallScript -InstallDir $InstallDir -RemoveInstallDir | Out-Null
    } catch {
    }
  }
}

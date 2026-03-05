Param(
  [string]$Repo = "canxin121/opencode-studio",
  [string]$Version = "",
  [switch]$WithFrontend,
  [string]$InstallDir = "",
  [ValidateRange(10, 300)]
  [int]$WaitTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallScript = Join-Path $ScriptDir "install-service.ps1"
$UninstallScript = Join-Path $ScriptDir "uninstall-service.ps1"

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
      $resp = Invoke-WebRequest -Uri "$Url/health" -UseBasicParsing -TimeoutSec 4
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return
      }
    } catch {
    }
    Start-Sleep -Seconds 1
  }

  throw "Health endpoint did not become reachable: $Url/health"
}

function Wait-HealthDown([string]$Url, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri "$Url/health" -UseBasicParsing -TimeoutSec 4 | Out-Null
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

function Wait-OpenCodeRunningState([string]$Url, [bool]$Expected, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $payload = Get-HealthPayload -Url $Url
      Assert-HealthPayload -Payload $payload
      if ([bool]$payload.openCodeRunning -eq $Expected) {
        return
      }
    } catch {
    }
    Start-Sleep -Seconds 1
  }

  throw "openCodeRunning did not become '$Expected' within ${TimeoutSeconds}s."
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

try {
  Assert-Administrator
  Require-Command "opencode"
  Require-Command "sc.exe"

  if (-not (Test-Path -LiteralPath $InstallScript)) {
    throw "Installer script not found: $InstallScript"
  }
  if (-not (Test-Path -LiteralPath $UninstallScript)) {
    throw "Uninstaller script not found: $UninstallScript"
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

  $installParams = @{
    Repo = $Repo
    InstallDir = $InstallDir
    Host = "127.0.0.1"
    Port = $port
  }
  if ($Version) {
    $installParams["Version"] = $Version
  }
  if ($WithFrontend) {
    $installParams["WithFrontend"] = $true
  }

  Write-Log "Step 1/6: install service"
  & $InstallScript @installParams
  $installCompleted = $true

  $binPath = Join-Path $InstallDir "bin/opencode-studio.exe"
  $configPath = Join-Path $InstallDir "opencode-studio.toml"
  $distIndexPath = Join-Path $InstallDir "dist/index.html"

  Write-Log "Step 2/6: validate installed files and config"
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

  if (-not (Test-ServiceExists $ServiceName)) {
    throw "Service missing after install: $ServiceName"
  }
  if (-not (Test-ServiceExists $OpenCodeServiceName)) {
    throw "Service missing after install: $OpenCodeServiceName"
  }

  Write-Log "Step 3/6: wait for service health"
  Wait-HealthUp -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds
  $payload = Get-HealthPayload -Url $baseUrl
  Assert-HealthPayload -Payload $payload

  Write-Log "Step 4/6: exercise service management commands"
  Invoke-Sc -Arguments @("query", $ServiceName) -ErrorMessage "Failed to query $ServiceName" | Out-Null
  Invoke-Sc -Arguments @("query", $OpenCodeServiceName) -ErrorMessage "Failed to query $OpenCodeServiceName" | Out-Null

  Invoke-Sc -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 1062) -ErrorMessage "Failed to stop $ServiceName" | Out-Null
  Wait-ServiceStatus -Name $ServiceName -Status "Stopped" -TimeoutSeconds $WaitTimeoutSeconds
  Wait-HealthDown -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds

  Invoke-Sc -Arguments @("start", $ServiceName) -ErrorMessage "Failed to start $ServiceName" | Out-Null
  Wait-ServiceStatus -Name $ServiceName -Status "Running" -TimeoutSeconds $WaitTimeoutSeconds
  Wait-HealthUp -Url $baseUrl -TimeoutSeconds $WaitTimeoutSeconds

  Invoke-Sc -Arguments @("stop", $OpenCodeServiceName) -AllowedExitCodes @(0, 1062) -ErrorMessage "Failed to stop $OpenCodeServiceName" | Out-Null
  Wait-ServiceStatus -Name $OpenCodeServiceName -Status "Stopped" -TimeoutSeconds $WaitTimeoutSeconds
  Wait-OpenCodeRunningState -Url $baseUrl -Expected $false -TimeoutSeconds $WaitTimeoutSeconds

  Invoke-Sc -Arguments @("start", $OpenCodeServiceName) -ErrorMessage "Failed to start $OpenCodeServiceName" | Out-Null
  Wait-ServiceStatus -Name $OpenCodeServiceName -Status "Running" -TimeoutSeconds $WaitTimeoutSeconds
  Wait-OpenCodeRunningState -Url $baseUrl -Expected $true -TimeoutSeconds $WaitTimeoutSeconds

  Write-Log "Step 5/6: uninstall services but keep install files"
  & $UninstallScript -InstallDir $InstallDir
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

  Write-Log "Step 6/6: uninstall services and remove install files"
  & $UninstallScript -InstallDir $InstallDir -RemoveInstallDir
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

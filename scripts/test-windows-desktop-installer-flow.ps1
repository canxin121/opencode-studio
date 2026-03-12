Param(
  [string]$Repo = "canxin121/opencode-studio",
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [Parameter(Mandatory = $true)]
  [string]$UpgradeToVersion,
  [int]$Port = 3210,
  [ValidateRange(30, 600)]
  [int]$WaitTimeoutSeconds = 240,
  [switch]$KeepFiles,
  [switch]$UiClicks
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$UsageSmokeScript = Join-Path $ScriptDir "studio-usage-smoke.ps1"
$UiClickScript = Join-Path $ScriptDir "studio-ui-click-e2e.mjs"

function Write-Log([string]$Message) {
  Write-Host ("[desktop-e2e {0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing dependency: $Name"
  }
}

function Assert-Administrator {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This test must run in an elevated PowerShell session. (Installer operations require admin rights.)"
  }
}

function Invoke-WebRequestCompat {
  Param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [int]$TimeoutSec = 0
  )

  $params = @{ Uri = $Uri; OutFile = $OutFile }
  if ($TimeoutSec -gt 0) {
    $params["TimeoutSec"] = $TimeoutSec
  }
  $cmd = Get-Command Invoke-WebRequest -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Parameters.ContainsKey("UseBasicParsing")) {
    $params["UseBasicParsing"] = $true
  }
  return Invoke-WebRequest @params
}

function Normalize-ReleaseTag([string]$Value) {
  if ($null -eq $Value) { return "" }
  $t = $Value.Trim()
  if ($t.StartsWith("v")) { return $t }
  return "v$t"
}

function Get-TargetTriple {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch) {
    ([System.Runtime.InteropServices.Architecture]::X64) { return "x86_64-pc-windows-msvc" }
    ([System.Runtime.InteropServices.Architecture]::Arm64) { return "aarch64-pc-windows-msvc" }
    default { throw "Unsupported Windows architecture: $arch" }
  }
}

function Can-BindPort([int]$P) {
  if ($P -le 0) { return $true }
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $P)
    $listener.Start()
    $listener.Stop()
    return $true
  } catch {
    return $false
  }
}

function Wait-PortFree([int]$P, [int]$TimeoutSeconds = 60) {
  if ($P -le 0) { return }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Can-BindPort -P $P) {
      Write-Log "Port released: :$P"
      return
    }
    Start-Sleep -Seconds 1
  }
  try {
    $listeners = Get-NetTCPConnection -LocalPort $P -State Listen -ErrorAction SilentlyContinue
    if ($listeners) {
      $pids = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
      Write-Log ("Port diagnostics :{0} OwningProcess={1}" -f $P, ($pids -join ","))
    }
  } catch {
  }
  throw "Port $P is still not bindable after ${TimeoutSeconds}s."
}

function Pick-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}

function Wait-CdpReady([int]$Port, [int]$TimeoutSeconds = 60) {
  if ($Port -le 0) {
    throw "Invalid CDP port: $Port"
  }
  $url = "http://127.0.0.1:$Port/json/version"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-RestMethod -Uri $url -TimeoutSec 2
      $ws = [string]$resp.webSocketDebuggerUrl
      if ($ws) {
        Write-Log "CDP ready: $url"
        return
      }
      $last = "missing webSocketDebuggerUrl"
    } catch {
      $last = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 250
  }
  throw "CDP endpoint not ready within ${TimeoutSeconds}s: $url (last error: $last)"
}

function Dump-DesktopSupport {
  Param(
    [string]$Header = "Desktop diagnostics"
  )
  Write-Log $Header

  $candidates = @(
    Join-Path $env:APPDATA "cn.cxits.opencode-studio"
    Join-Path $env:LOCALAPPDATA "cn.cxits.opencode-studio"
    Join-Path $env:APPDATA "OpenCode Studio"
    Join-Path $env:LOCALAPPDATA "OpenCode Studio"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  foreach ($dir in $candidates) {
    Write-Log "Support dir: $dir"
    try { Get-ChildItem -LiteralPath $dir -Force | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize } catch { }
    $cfg = Join-Path $dir "opencode-studio.toml"
    if (Test-Path -LiteralPath $cfg) {
      Write-Log "Runtime config (first 200 lines): $cfg"
      try {
        Get-Content -LiteralPath $cfg -TotalCount 200 | ForEach-Object { $_ }
      } catch {
      }
    }
    $logDir = Join-Path $dir "logs"
    $backendLog = Join-Path $logDir "backend.log"
    if (Test-Path -LiteralPath $backendLog) {
      Write-Log "backend.log (last 200 lines): $backendLog"
      try {
        Get-Content -LiteralPath $backendLog -Tail 200 | ForEach-Object { $_ }
      } catch {
      }
    }
  }
}

function Download-DesktopInstaller([string]$RepoName, [string]$Tag, [string]$Target, [string]$OutDir) {
  $tag = Normalize-ReleaseTag $Tag
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

  $msiName = "opencode-studio-desktop-$Target-$tag.msi"
  $exeName = "opencode-studio-desktop-$Target-$tag.exe"

  $msiUrl = "https://github.com/$RepoName/releases/download/$tag/$msiName"
  $exeUrl = "https://github.com/$RepoName/releases/download/$tag/$exeName"

  $msiPath = Join-Path $OutDir $msiName
  $exePath = Join-Path $OutDir $exeName

  Write-Log "Downloading $msiName"
  try {
    Invoke-WebRequestCompat -Uri $msiUrl -OutFile $msiPath -TimeoutSec 180 | Out-Null
    if ((Test-Path -LiteralPath $msiPath) -and ((Get-Item -LiteralPath $msiPath).Length -gt 0)) {
      return @{ Type = "msi"; Path = $msiPath; Tag = $tag }
    }
  } catch {
    Write-Log "MSI download failed (will try EXE): $($_.Exception.Message)"
  }

  Write-Log "Downloading $exeName"
  Invoke-WebRequestCompat -Uri $exeUrl -OutFile $exePath -TimeoutSec 180 | Out-Null
  if (-not (Test-Path -LiteralPath $exePath) -or ((Get-Item -LiteralPath $exePath).Length -le 0)) {
    throw "Failed to download desktop installer (.msi or .exe) for $tag"
  }
  return @{ Type = "exe"; Path = $exePath; Tag = $tag }
}

function Install-Desktop([hashtable]$Installer) {
  if ($Installer.Type -eq "msi") {
    $args = @("/i", "`"$($Installer.Path)`"", "/qn", "/norestart")
    Write-Log "Installing MSI: $($Installer.Path)"
    $p = Start-Process -FilePath "msiexec.exe" -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010 -and $p.ExitCode -ne 1641) {
      throw "msiexec install failed with exit code $($p.ExitCode)"
    }
    return
  }

  if ($Installer.Type -eq "exe") {
    Write-Log "Installing NSIS EXE: $($Installer.Path)"
    $p = Start-Process -FilePath $Installer.Path -ArgumentList @("/S") -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010 -and $p.ExitCode -ne 1641) {
      throw "EXE install failed with exit code $($p.ExitCode)"
    }
    return
  }

  throw "Unsupported installer type: $($Installer.Type)"
}

function Uninstall-Desktop([hashtable]$Installer) {
  if ($Installer.Type -eq "msi") {
    $args = @("/x", "`"$($Installer.Path)`"", "/qn", "/norestart")
    Write-Log "Uninstalling via MSI: $($Installer.Path)"
    $p = Start-Process -FilePath "msiexec.exe" -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 1605 -and $p.ExitCode -ne 3010 -and $p.ExitCode -ne 1641) {
      throw "msiexec uninstall failed with exit code $($p.ExitCode)"
    }
    return
  }

  if ($Installer.Type -eq "exe") {
    # Best-effort: many NSIS installers drop an uninstaller in Program Files.
    $candidateDirs = @(
      Join-Path $env:ProgramFiles "OpenCode Studio"
      Join-Path ${env:ProgramFiles(x86)} "OpenCode Studio"
      Join-Path $env:LOCALAPPDATA "Programs\OpenCode Studio"
      Join-Path $env:LOCALAPPDATA "OpenCode Studio"
    ) | Where-Object { $_ -and (Test-Path $_) }

    $uninstaller = $null
    foreach ($dir in $candidateDirs) {
      $u = Get-ChildItem -Path $dir -Filter "*uninstall*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($u) { $uninstaller = $u.FullName; break }
    }

    if (-not $uninstaller) {
      throw "Unable to locate NSIS uninstaller (installer type was exe)"
    }
    Write-Log "Uninstalling via NSIS uninstaller: $uninstaller"
    $p = Start-Process -FilePath $uninstaller -ArgumentList @("/S") -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010 -and $p.ExitCode -ne 1641) {
      throw "NSIS uninstall failed with exit code $($p.ExitCode)"
    }
    return
  }

  throw "Unsupported installer type: $($Installer.Type)"
}

function Find-AppExe {
  $candidates = @(
    # Per-machine installs (MSI / some NSIS configs)
    Join-Path $env:ProgramFiles "OpenCode Studio\OpenCode Studio.exe"
    Join-Path ${env:ProgramFiles(x86)} "OpenCode Studio\OpenCode Studio.exe"

    # Per-user installs (common for desktop apps)
    Join-Path $env:LOCALAPPDATA "Programs\OpenCode Studio\OpenCode Studio.exe"
    Join-Path $env:LOCALAPPDATA "OpenCode Studio\OpenCode Studio.exe"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if ($candidates.Count -gt 0) {
    return $candidates[0]
  }

  throw "Unable to locate installed OpenCode Studio executable (checked Program Files + LocalAppData)"
}

function Stop-DesktopProcesses {
  Write-Log "Stopping desktop processes (best-effort)"
  foreach ($name in @("OpenCode Studio", "opencode-studio", "opencode")) {
    try {
      Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    } catch {
    }
  }
}

function Get-OpenCodePort([string]$BaseUrl) {
  try {
    $h = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 5
    if ($h -and $h.openCodePort) {
      return [int]$h.openCodePort
    }
  } catch {
  }
  return 0
}

function Run-Desktop-Smoke([string]$AppExe, [string]$BaseUrl, [string]$WorkDir, [int]$TimeoutSeconds, [string]$Label = "desktop") {
  Write-Log "Launching app: $AppExe"
  $debugPort = 0
  $prevWvArgs = $null
  if ($UiClicks) {
    $debugPort = Pick-FreeTcpPort
    $prevWvArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    $extra = "--remote-debugging-port=$debugPort --remote-allow-origins=*"
    if ([string]::IsNullOrWhiteSpace([string]$prevWvArgs)) {
      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $extra
    } else {
      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = ("{0} {1}" -f $prevWvArgs, $extra)
    }
    Write-Log "Enabled WebView2 remote debugging on port $debugPort"
  }

  $proc = $null
  try {
    $proc = Start-Process -FilePath $AppExe -WorkingDirectory $WorkDir -PassThru
  } finally {
    if ($UiClicks) {
      # Restore caller env; launched app already inherited the debug flags.
      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $prevWvArgs
    }
  }

  $ocPort = 0
  try {
    & $UsageSmokeScript -BaseUrl $BaseUrl -Directory $WorkDir -TimeoutSeconds $TimeoutSeconds -RequireUi -MaxAssets 3
    if ($UiClicks) {
      Wait-CdpReady -Port $debugPort -TimeoutSeconds $TimeoutSeconds
      & node $UiClickScript --cdp-url "http://127.0.0.1:$debugPort" --directory $WorkDir --timeout $TimeoutSeconds --label $Label
    }
    $ocPort = Get-OpenCodePort -BaseUrl $BaseUrl
    if ($ocPort -gt 0) {
      Write-Log "Captured openCodePort=$ocPort"
    }
  } finally {
    try {
      $proc.CloseMainWindow() | Out-Null
    } catch {
    }
    Start-Sleep -Seconds 2
    try {
      if ($proc -and -not $proc.HasExited) {
        Write-Log "Force-killing app process (pid=$($proc.Id))"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {
    }
    Stop-DesktopProcesses
  }

  Wait-PortFree -P $Port -TimeoutSeconds $TimeoutSeconds
  if ($ocPort -gt 0) {
    Wait-PortFree -P $ocPort -TimeoutSeconds $TimeoutSeconds
  }
  if ($UiClicks -and $debugPort -gt 0) {
    Wait-PortFree -P $debugPort -TimeoutSeconds $TimeoutSeconds
  }
}

Assert-Administrator
Require-Command "opencode"
if (-not (Test-Path -LiteralPath $UsageSmokeScript)) {
  throw "Usage smoke script not found: $UsageSmokeScript"
}
if ($UiClicks -and -not (Test-Path -LiteralPath $UiClickScript)) {
  throw "UI click script not found: $UiClickScript"
}
if ($UiClicks) {
  Require-Command "node"
}

$target = Get-TargetTriple
$versionTag = Normalize-ReleaseTag $Version
$upgradeTag = Normalize-ReleaseTag $UpgradeToVersion
$baseUrl = "http://127.0.0.1:$Port"

$workDir = Join-Path $env:TEMP ("opencode-studio-desktop-e2e-" + [Guid]::NewGuid().ToString("N"))
$dlDir = Join-Path $workDir "downloads"
New-Item -ItemType Directory -Force -Path $dlDir | Out-Null

Write-Log "Starting Windows desktop installer flow"
Write-Log "Repo: $Repo"
Write-Log "Target: $target"
Write-Log "Install version: $versionTag"
Write-Log "Upgrade to: $upgradeTag"
Write-Log "Base URL: $baseUrl"

try {
  Write-Log "Step 1/6: download installers"
  $oldInstaller = Download-DesktopInstaller -RepoName $Repo -Tag $versionTag -Target $target -OutDir $dlDir
  $newInstaller = Download-DesktopInstaller -RepoName $Repo -Tag $upgradeTag -Target $target -OutDir $dlDir

  Write-Log "Step 2/6: install desktop ($versionTag)"
  Wait-PortFree -P $Port -TimeoutSeconds $WaitTimeoutSeconds
  Install-Desktop -Installer $oldInstaller
  $appExe = Find-AppExe

  Write-Log "Step 3/6: launch + usage smoke ($versionTag)"
  Run-Desktop-Smoke -AppExe $appExe -BaseUrl $baseUrl -WorkDir $workDir -TimeoutSeconds $WaitTimeoutSeconds -Label "desktop-install"

  Write-Log "Step 4/6: upgrade (install newer over existing)"
  Install-Desktop -Installer $newInstaller
  $appExe2 = Find-AppExe
  Run-Desktop-Smoke -AppExe $appExe2 -BaseUrl $baseUrl -WorkDir $workDir -TimeoutSeconds $WaitTimeoutSeconds -Label "desktop-upgrade"

  Write-Log "Step 5/6: uninstall (using latest installer reference)"
  Uninstall-Desktop -Installer $newInstaller
  Stop-DesktopProcesses
  Wait-PortFree -P $Port -TimeoutSeconds $WaitTimeoutSeconds

  Write-Log "Step 6/6: reinstall latest + usage smoke"
  Install-Desktop -Installer $newInstaller
  $appExe3 = Find-AppExe
  Run-Desktop-Smoke -AppExe $appExe3 -BaseUrl $baseUrl -WorkDir $workDir -TimeoutSeconds $WaitTimeoutSeconds -Label "desktop-reinstall"
  Uninstall-Desktop -Installer $newInstaller
  Stop-DesktopProcesses
  Wait-PortFree -P $Port -TimeoutSeconds $WaitTimeoutSeconds

  Write-Log "PASS: Windows desktop installer flow completed"
} catch {
  Dump-DesktopSupport "Failure diagnostics"
  Stop-DesktopProcesses
  try { Wait-PortFree -P $Port -TimeoutSeconds 60 } catch { }
  throw
} finally {
  if (-not $KeepFiles) {
    try { Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  }
}

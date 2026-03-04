Param(
  [string]$ServiceName = "OpenCodeStudio",
  [string]$InstallDir = "",
  [switch]$RemoveInstallDir
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This uninstaller must run in an elevated PowerShell (Run as Administrator)."
  }
}

function Require-Command([string]$Name, [string]$Hint = "") {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    if ($Hint) {
      throw "Missing dependency: $Name. $Hint"
    }
    throw "Missing dependency: $Name"
  }
}

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

function Test-ServiceExists([string]$Name) {
  & sc.exe query $Name *> $null
  return $LASTEXITCODE -eq 0
}

function Stop-ServiceProcess([string]$Name) {
  $svc = Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
  if ($svc -and $svc.ProcessId -gt 0) {
    try {
      Stop-Process -Id $svc.ProcessId -Force -ErrorAction Stop
    } catch {
    }
  }
}

function Wait-ServiceRemoved([string]$Name, [int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-ServiceExists $Name)) {
      return
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Service '$Name' is still present after deletion attempt. It may be marked for deletion; close service viewers and retry, or reboot once."
}

function Resolve-InstallDir([string]$Path) {
  if ($Path) {
    return $Path
  }
  return Join-Path $HOME "opencode-studio"
}

function Assert-SafeInstallDir([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($full)
  if ($full.TrimEnd('\\') -eq $root.TrimEnd('\\')) {
    throw "Refusing to delete drive root: $full"
  }
  if ($full -match '^[A-Za-z]:\\Windows($|\\)') {
    throw "Refusing to delete Windows directory: $full"
  }
  if ($full -match '^[A-Za-z]:\\Users($|\\)$') {
    throw "Refusing to delete Users root directory: $full"
  }
}

Assert-Administrator
Require-Command "sc.exe" "Windows service management requires sc.exe."

$OpenCodeServiceName = "$ServiceName-OpenCode"
if (-not $InstallDir) {
  $InstallDir = Resolve-InstallDir $InstallDir
}

Invoke-ScCommand -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 1060, 1062) -ErrorMessage "Failed to stop service '$ServiceName'"
Stop-ServiceProcess -Name $ServiceName
Invoke-ScCommand -Arguments @("delete", $ServiceName) -AllowedExitCodes @(0, 1060, 1072) -ErrorMessage "Failed to delete service '$ServiceName'"
Invoke-ScCommand -Arguments @("stop", $OpenCodeServiceName) -AllowedExitCodes @(0, 1060, 1062) -ErrorMessage "Failed to stop service '$OpenCodeServiceName'"
Stop-ServiceProcess -Name $OpenCodeServiceName
Invoke-ScCommand -Arguments @("delete", $OpenCodeServiceName) -AllowedExitCodes @(0, 1060, 1072) -ErrorMessage "Failed to delete service '$OpenCodeServiceName'"

Wait-ServiceRemoved -Name $ServiceName
Wait-ServiceRemoved -Name $OpenCodeServiceName

Write-Host "Removed Windows service: $ServiceName"
Write-Host "Removed Windows service: $OpenCodeServiceName"

if ($RemoveInstallDir) {
  Assert-SafeInstallDir -Path $InstallDir
  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
    Write-Host "Removed install directory: $InstallDir"
  } else {
    Write-Host "Install directory not found (already removed): $InstallDir"
  }
} else {
  Write-Host "Install files kept at: $InstallDir"
  Write-Host "To remove files too, rerun with -RemoveInstallDir."
}

Param(
  [string]$ServiceName = "OpenCodeStudio",
  [string]$InstallDir = ""
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

function Find-NssmExe([string]$InstallDir) {
  $cmd = Get-Command "nssm.exe" -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  if (-not $InstallDir) {
    $InstallDir = Join-Path $HOME "opencode-studio"
  }

  $bundled = Join-Path (Join-Path $InstallDir "tools") "nssm.exe"
  if (Test-Path $bundled) {
    return $bundled
  }

  return ""
}

Assert-Administrator
Require-Command "sc.exe" "Windows service management requires sc.exe."

$nssmExe = Find-NssmExe -InstallDir $InstallDir
if ($nssmExe) {
  Invoke-ExeCommand -ExePath $nssmExe -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 2, 3) -ErrorMessage "Failed to stop service '$ServiceName'"
  Invoke-ExeCommand -ExePath $nssmExe -Arguments @("remove", $ServiceName, "confirm") -AllowedExitCodes @(0, 3) -ErrorMessage "Failed to remove service '$ServiceName'"
} else {
  Invoke-ScCommand -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 1060, 1062) -ErrorMessage "Failed to stop service '$ServiceName'"
  Invoke-ScCommand -Arguments @("delete", $ServiceName) -AllowedExitCodes @(0, 1060) -ErrorMessage "Failed to delete service '$ServiceName'"
}

Write-Host "Removed Windows service: $ServiceName"
Write-Host "If you also want to remove installed files, delete the install directory (default: %USERPROFILE%\\opencode-studio)."

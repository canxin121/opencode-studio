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

Assert-Administrator
Require-Command "sc.exe" "Windows service management requires sc.exe."

$OpenCodeServiceName = "$ServiceName-OpenCode"
Invoke-ScCommand -Arguments @("stop", $ServiceName) -AllowedExitCodes @(0, 1060, 1062) -ErrorMessage "Failed to stop service '$ServiceName'"
Invoke-ScCommand -Arguments @("delete", $ServiceName) -AllowedExitCodes @(0, 1060, 1072) -ErrorMessage "Failed to delete service '$ServiceName'"
Invoke-ScCommand -Arguments @("stop", $OpenCodeServiceName) -AllowedExitCodes @(0, 1060, 1062) -ErrorMessage "Failed to stop service '$OpenCodeServiceName'"
Invoke-ScCommand -Arguments @("delete", $OpenCodeServiceName) -AllowedExitCodes @(0, 1060, 1072) -ErrorMessage "Failed to delete service '$OpenCodeServiceName'"

Write-Host "Removed Windows service: $ServiceName"
Write-Host "Removed Windows service: $OpenCodeServiceName"
Write-Host "If you also want to remove installed files, delete the install directory (default: %USERPROFILE%\\opencode-studio)."

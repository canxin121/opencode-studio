Param(
  [string]$ServiceName = "OpenCodeStudio"
)

$ErrorActionPreference = "Stop"

try { & sc.exe stop $ServiceName | Out-Null } catch {}
try { & sc.exe delete $ServiceName | Out-Null } catch {}

Write-Host "Removed Windows service: $ServiceName"
Write-Host "If you also want to remove installed files, delete the install directory (default: %USERPROFILE%\\opencode-studio)."

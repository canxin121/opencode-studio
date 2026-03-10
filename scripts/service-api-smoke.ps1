Param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [string]$Cwd = "",
  [ValidateRange(5, 300)]
  [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) {
  Write-Host ("[api-smoke {0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
}

function Invoke-RetryJson {
  Param(
    [string]$Uri,
    [int]$Timeout = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $delay = 1
  $last = $null
  while ((Get-Date) -lt $deadline) {
    try {
      return Invoke-RestMethod -Uri $Uri -TimeoutSec $Timeout
    } catch {
      $last = $_
    }
    Start-Sleep -Seconds $delay
    if ($delay -lt 4) {
      $delay += 1
    }
  }
  if ($last) {
    throw "Failed to fetch JSON from $Uri within ${TimeoutSeconds}s. Last error: $($last.Exception.Message)"
  }
  throw "Failed to fetch JSON from $Uri within ${TimeoutSeconds}s."
}

function Assert-AuthSessionDisabled([object]$Payload) {
  if (-not $Payload) {
    throw "/auth/session payload empty"
  }
  if ($Payload.authenticated -ne $true) {
    throw "/auth/session authenticated expected true"
  }
  if ($Payload.disabled -ne $true) {
    throw "/auth/session disabled expected true"
  }
}

function Assert-Diagnostics([object]$Payload) {
  if (-not $Payload) {
    throw "diagnostics payload empty"
  }
  if ([string]::IsNullOrWhiteSpace([string]$Payload.timestamp)) {
    throw "diagnostics timestamp missing"
  }
  if (-not $Payload.opencode) {
    throw "diagnostics opencode object missing"
  }
  $cli = $Payload.opencode.version.cli
  if ($null -ne $cli -and [string]::IsNullOrWhiteSpace([string]$cli)) {
    throw "diagnostics opencode.version.cli is empty"
  }
}

function Assert-UpdateCheck([object]$Payload) {
  if (-not $Payload -or -not $Payload.service) {
    throw "update-check payload missing service"
  }
  $svc = $Payload.service
  foreach ($k in @("currentVersion", "latestVersion", "assetUrl", "target")) {
    $v = $svc.$k
    if ($null -ne $v -and [string]::IsNullOrWhiteSpace([string]$v)) {
      throw "update-check service.$k is empty"
    }
  }
  $avail = $svc.available
  if ($null -ne $avail -and -not ($avail -is [bool])) {
    throw "update-check service.available has unexpected type"
  }
}

function Terminal-Smoke([string]$Url, [string]$WorkingDir) {
  if (-not $WorkingDir) {
    $WorkingDir = (Get-Location).Path
  }
  $body = @{ cwd = $WorkingDir; cols = 120; rows = 40 } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Uri "$Url/api/terminal/create" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 20
  $sid = $resp.sessionId
  if (-not $sid) {
    $sid = $resp.session_id
  }
  if (-not $sid) {
    throw "terminal/create missing sessionId"
  }

  Invoke-WebRequest -Uri "$Url/api/terminal/$sid" -UseBasicParsing -TimeoutSec 15 | Out-Null
  Invoke-WebRequest -Uri "$Url/api/terminal/$sid" -Method DELETE -UseBasicParsing -TimeoutSec 15 | Out-Null
  Write-Log "terminal ok (sessionId=$sid)"
}

Write-Log "Checking /auth/session"
$auth = Invoke-RetryJson -Uri "$BaseUrl/auth/session" -Timeout 8
Assert-AuthSessionDisabled -Payload $auth

Write-Log "Checking /api/opencode-studio/diagnostics"
$diag = Invoke-RetryJson -Uri "$BaseUrl/api/opencode-studio/diagnostics" -Timeout 12
Assert-Diagnostics -Payload $diag

Write-Log "Checking /api/opencode-studio/update-check"
$update = Invoke-RetryJson -Uri "$BaseUrl/api/opencode-studio/update-check" -Timeout 12
Assert-UpdateCheck -Payload $update

Write-Log "Checking terminal API"
Terminal-Smoke -Url $BaseUrl -WorkingDir $Cwd

Write-Log "PASS"

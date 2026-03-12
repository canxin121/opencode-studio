Param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [string]$Directory = "",
  [ValidateRange(5, 600)]
  [int]$TimeoutSeconds = 120,
  [switch]$RequireUi,
  [ValidateRange(1, 20)]
  [int]$MaxAssets = 3
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) {
  Write-Host ("[usage-smoke {0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
}

function Invoke-WebRequestCompat {
  Param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [string]$OutFile = "",
    [int]$TimeoutSec = 0,
    [string]$Method = "GET",
    [string]$ContentType = "",
    [string]$Body = ""
  )

  $params = @{ Uri = $Uri; Method = $Method }
  if ($OutFile) {
    $params["OutFile"] = $OutFile
  }
  if ($TimeoutSec -gt 0) {
    $params["TimeoutSec"] = $TimeoutSec
  }
  if ($ContentType) {
    $params["ContentType"] = $ContentType
  }
  if ($Body) {
    $params["Body"] = $Body
  }

  $cmd = Get-Command Invoke-WebRequest -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Parameters.ContainsKey("UseBasicParsing")) {
    $params["UseBasicParsing"] = $true
  }
  return Invoke-WebRequest @params
}

function Wait-HealthUp([string]$Url, [int]$Timeout = 60) {
  $deadline = (Get-Date).AddSeconds($Timeout)
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

function Get-Health([string]$Url) {
  return Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 5
}

function Wait-OpenCodeReady([string]$Url, [int]$Timeout = 60) {
  $deadline = (Get-Date).AddSeconds($Timeout)
  $lastErr = ""
  while ((Get-Date) -lt $deadline) {
    try {
      $h = Get-Health -Url $Url
      if ($h -and $h.status -eq "ok" -and $h.isOpenCodeReady -eq $true) {
        Write-Log ("OpenCode ready (openCodePort={0})" -f ([string]$h.openCodePort))
        return
      }
      $err = [string]$h.lastOpenCodeError
      if ($err -and $err -ne $lastErr) {
        $lastErr = $err
        Write-Log ("Waiting for OpenCode ready... (lastOpenCodeError={0})" -f $err)
      }
    } catch {
    }
    Start-Sleep -Seconds 1
  }
  throw "OpenCode backend did not become ready within ${Timeout}s"
}

function Ui-Smoke([string]$Url, [int]$Max = 3) {
  Write-Log "UI: fetching /"
  $resp = Invoke-WebRequestCompat -Uri "$Url/" -TimeoutSec 20
  $html = [string]$resp.Content
  if (-not $html.Contains("OpenCode Studio")) {
    throw "UI root does not look like OpenCode Studio (missing title text)"
  }
  if ($html -notmatch 'id="app"') {
    throw "UI root missing #app mount"
  }

  $paths = [System.Collections.Generic.List[string]]::new()
  $seen = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($m in [regex]::Matches($html, '[''"](/assets/[^''"]+)[''"]')) {
    $p = [string]$m.Groups[1].Value
    if (-not $p) { continue }
    if ($seen.Add($p)) { $paths.Add($p) | Out-Null }
  }
  if ($paths.Count -eq 0) {
    throw "UI root did not reference /assets/* (Vite bundle missing?)"
  }

  Write-Log "UI: validating first $Max hashed assets"
  $i = 0
  foreach ($p in $paths) {
    $i += 1
    if ($i -gt $Max) { break }
    $asset = Invoke-WebRequestCompat -Uri "$Url$p" -TimeoutSec 20
    if ($asset.StatusCode -ne 200) {
      throw "Asset fetch failed ($($asset.StatusCode)): $p"
    }
    $ct = [string]$asset.Headers["Content-Type"]
    if ($ct -and $ct.ToLowerInvariant().StartsWith("text/html")) {
      throw "Asset returned HTML content-type (unexpected SPA fallback?): $p"
    }
    Write-Log ("UI: OK {0} ({1})" -f $p, $ct)
  }
}

function Session-Smoke([string]$Url, [string]$Dir) {
  if (-not $Dir) {
    $Dir = (Get-Location).Path
  }
  $enc = [Uri]::EscapeDataString($Dir)
  Write-Log "Session: creating (directory=$Dir)"
  $payload = "{}"
  $resp = Invoke-RestMethod -Uri "$Url/api/session?directory=$enc" -Method POST -ContentType "application/json" -Body $payload -TimeoutSec 30
  $sid = [string]$resp.id
  if (-not $sid) { $sid = [string]$resp.sessionId }
  if (-not $sid) { $sid = [string]$resp.session_id }
  if (-not $sid) {
    throw "Session create response missing id"
  }
  Write-Log "Session: created id=$sid"

  $encSid = [Uri]::EscapeDataString($sid)
  $del = Invoke-WebRequestCompat -Uri "$Url/api/session/$encSid?directory=$enc" -Method DELETE -TimeoutSec 30
  if ($del.StatusCode -lt 200 -or $del.StatusCode -ge 300) {
    throw "Failed to delete session id=$sid (HTTP $($del.StatusCode))"
  }
  Write-Log "Session: deleted id=$sid"
}

if (-not $Directory) {
  $Directory = (Get-Location).Path
}

Write-Log "Base URL: $BaseUrl"
Wait-HealthUp -Url $BaseUrl -Timeout $TimeoutSeconds

if ($RequireUi) {
  Ui-Smoke -Url $BaseUrl -Max $MaxAssets
}

Wait-OpenCodeReady -Url $BaseUrl -Timeout $TimeoutSeconds
Session-Smoke -Url $BaseUrl -Dir $Directory

Write-Log "PASS"

# Regenerates data/climbs.json from Cotacol's public climbs API.
#
# The geometry of the 1000 Cotacol climbs practically never changes, so it is
# bundled inside the extension. Re-run this only if Cotacol adds/edits climbs:
#
#   powershell -ExecutionPolicy Bypass -File tools\build-climbs.ps1
#
# Then reload the extension in chrome://extensions or edge://extensions.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "data\climbs.json"

$climbs = Invoke-RestMethod -Uri "https://www.cotacol.cc/api/climbs" -Headers @{ Accept = "application/json" }
if (-not $climbs -or $climbs.Count -lt 900) {
  throw "Unexpected response from /api/climbs (got $($climbs.Count) climbs)"
}

# Keep only what the overlay needs. 'p' stays Google-encoded (precision 5);
# the extension decodes it at load time.
$slim = $climbs | Sort-Object { [int]$_.number } | ForEach-Object {
  [ordered]@{
    id   = [string]$_.id
    n    = [int]$_.number
    name = [string]$_.name
    city = [string]$_.city
    pts  = [int]$_.points
    seg  = [string]$_.stravaSegment
    p    = [string]$_.polyline
  }
}

$payload = [ordered]@{
  source      = "https://www.cotacol.cc/api/climbs"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  count       = @($slim).Count
  climbs      = @($slim)
}

New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$json = $payload | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $(@($slim).Count) climbs to $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"

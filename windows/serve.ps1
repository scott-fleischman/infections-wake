# Zero-install static server for the Infection's Wake Windows build.
# Uses only Windows PowerShell (built into Windows 10) — no Node, no installs.
# Serves the .\game folder over http://localhost:8137/ and opens the browser.
#
# Run by double-clicking Play-InfectionsWake.bat, or directly:
#   powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1

$ErrorActionPreference = 'Stop'
$port = if ($env:PORT) { [int]$env:PORT } else { 8137 }
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'game'))

if (-not (Test-Path $root)) {
  Write-Host ""
  Write-Host "  Could not find the 'game' folder next to serve.ps1."
  Write-Host "  Expected: $root"
  Write-Host "  Keep serve.ps1 and the game folder together."
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}

$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8';
  '.mjs'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json; charset=utf-8'; '.map'='application/json; charset=utf-8';
  '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg';
  '.gif'='image/gif'; '.webp'='image/webp'; '.ico'='image/x-icon';
  '.woff'='font/woff'; '.woff2'='font/woff2'; '.ttf'='font/ttf';
  '.wasm'='application/wasm'; '.webmanifest'='application/manifest+json';
  '.md'='text/markdown; charset=utf-8'; '.txt'='text/plain; charset=utf-8'
}

# TcpListener binds to loopback without administrator rights (unlike HttpListener).
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
try {
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "  Could not start on port $port (it may be in use)."
  Write-Host "  Try a different port:  set PORT=9000 & powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1"
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}

$url = "http://localhost:$port/"
Write-Host ""
Write-Host "  Infection's Wake is running."
Write-Host "  Play in your browser at:  $url"
Write-Host "  Keep this window open while you play. Close it to stop the game."
Write-Host ""
Start-Process $url | Out-Null

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { $client.Close(); continue }

      $target = ($requestLine -split ' ')[1]
      if (-not $target) { $target = '/' }
      $target = ($target -split '\?')[0]                       # drop query string
      $target = [System.Uri]::UnescapeDataString($target)
      if ($target.EndsWith('/')) { $target += 'index.html' }
      $relative = $target.TrimStart('/').Replace('/', '\')
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

      if (($full -eq $root -or $full.StartsWith($root + '\')) -and (Test-Path $full -PathType Leaf)) {
        $body = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
        $head = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
        $head = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      }

      $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
      $stream.Write($headBytes, 0, $headBytes.Length)
      $stream.Write($body, 0, $body.Length)
      $stream.Flush()
    } catch {
      # a dropped/broken connection should never kill the server
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}

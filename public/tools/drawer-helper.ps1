# Restaurant cash drawer helper (runs on the cashier Windows PC)
# Listens on http://127.0.0.1:17777 only (this computer). When the web POS asks, it sends the
# ESC/POS "open drawer" command to the receipt printer over the LAN (port 9100).
# The cash drawer must be plugged into the printer's RJ11 "DK" port.
$Port = 17777

function Test-PrivateIp([string]$ip) {
  if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { return $false }
  $o = $ip.Split('.') | ForEach-Object { [int]$_ }
  if (($o | Where-Object { $_ -gt 255 }).Count -gt 0) { return $false }
  return ($o[0] -eq 10) -or ($o[0] -eq 127) -or ($o[0] -eq 192 -and $o[1] -eq 168) -or ($o[0] -eq 172 -and $o[1] -ge 16 -and $o[1] -le 31)
}

function Open-Drawer([string]$ip, [int]$printerPort, [int]$pin) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $tcp.BeginConnect($ip, $printerPort, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(2500)) { throw 'printer_timeout' }
    $tcp.EndConnect($iar)
    $ns = $tcp.GetStream()
    $m = 0; if ($pin -eq 5) { $m = 1 }
    [byte[]]$bytes = 27, 112, $m, 25, 250   # ESC p m t1 t2
    $ns.Write($bytes, 0, $bytes.Length)
    $ns.Flush()
    Start-Sleep -Milliseconds 150
  } finally { $tcp.Close() }
}

function Send-Response($stream, [int]$code, [string]$json, [string]$origin) {
  $status = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 404 = 'Not Found'; 502 = 'Bad Gateway' }[$code]
  if (-not $origin) { $origin = '*' }
  $body = [Text.Encoding]::UTF8.GetBytes($json)
  $head = "HTTP/1.1 $code $status`r`n" +
    "Content-Type: application/json`r`n" +
    "Access-Control-Allow-Origin: $origin`r`n" +
    "Access-Control-Allow-Methods: GET, OPTIONS`r`n" +
    "Access-Control-Allow-Headers: *`r`n" +
    "Access-Control-Allow-Private-Network: true`r`n" +
    "Vary: Origin`r`n" +
    "Cache-Control: no-store`r`n" +
    "Content-Length: $($body.Length)`r`n" +
    "Connection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

try {
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
  $listener.Start()
} catch {
  exit 0   # already running
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 3000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
    $first = $reader.ReadLine()
    if (-not $first) { continue }
    $origin = ''
    while ($true) {
      $hl = $reader.ReadLine()
      if ($hl -eq $null -or $hl -eq '') { break }
      if ($hl -match '^(?i)origin:\s*(.+)$') { $origin = $matches[1].Trim() }
    }
    $parts = $first.Split(' ')
    $method = $parts[0]; $target = $parts[1]
    $path = $target.Split('?')[0]
    $q = @{}
    if ($target.Contains('?')) {
      foreach ($kv in $target.Split('?')[1].Split('&')) {
        $p = $kv.Split('=', 2)
        if ($p.Length -eq 2) { $q[$p[0]] = [Uri]::UnescapeDataString($p[1]) }
      }
    }
    if ($method -eq 'OPTIONS') { Send-Response $stream 204 '' $origin; continue }
    if ($path -eq '/ping') { Send-Response $stream 200 '{"ok":true,"app":"drawer-helper","v":1}' $origin; continue }
    if ($path -eq '/drawer') {
      $ip = [string]$q['ip']
      if (-not (Test-PrivateIp $ip)) { Send-Response $stream 400 '{"ok":false,"error":"bad_ip"}' $origin; continue }
      $pp = 9100; if ($q['port'] -match '^\d{2,5}$') { $pp = [int]$q['port'] }
      $pin = 2; if ($q['pin'] -eq '5') { $pin = 5 }
      try { Open-Drawer $ip $pp $pin; Send-Response $stream 200 '{"ok":true}' $origin }
      catch { Send-Response $stream 502 '{"ok":false,"error":"printer_unreachable"}' $origin }
      continue
    }
    Send-Response $stream 404 '{"ok":false,"error":"not_found"}' $origin
  } catch {
  } finally {
    $client.Close()
  }
}

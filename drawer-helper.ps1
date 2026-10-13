# Restaurant cash drawer helper (runs on the cashier Windows PC)
# Listens on http://127.0.0.1:17777 only (this computer). When the web POS asks, it sends the
# ESC/POS "open drawer" command to the receipt printer:
#   - USB printer: through the Windows printer (RAW print job)   /drawer?printer=NAME  (empty = default printer)
#   - LAN printer: straight to the printer IP, port 9100          /drawer?ip=192.168.x.x
# The cash drawer must be plugged into the printer's RJ11 "DK" port.
$Port = 17777

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
  static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
  static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool WritePrinter(IntPtr hPrinter, byte[] bytes, int count, out int written);
  public static string Send(string printerName, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printerName, out h, IntPtr.Zero)) return "printer_not_found";
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = "Open cash drawer";
      di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) return "print_failed";
      try {
        StartPagePrinter(h);
        int written;
        bool ok = WritePrinter(h, data, data.Length, out written);
        EndPagePrinter(h);
        if (!ok || written != data.Length) return "print_failed";
      } finally { EndDocPrinter(h); }
      return "";
    } finally { ClosePrinter(h); }
  }
}
'@

function Get-Printers {
  $names = @(); $def = ''
  try {
    foreach ($pr in @(Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop)) {
      $names += [string]$pr.Name
      if ($pr.Default) { $def = [string]$pr.Name }
    }
  } catch {
    try {
      $wn = New-Object -ComObject WScript.Network
      $c = $wn.EnumPrinterConnections()
      for ($i = 1; $i -lt $c.Count(); $i += 2) { $names += [string]$c.Item($i) }
    } catch {}
  }
  return @{ ok = $true; printers = $names; default = $def }
}

function Get-DrawerBytes([int]$pin) {
  $m = 0; if ($pin -eq 5) { $m = 1 }
  [byte[]]$bytes = 27, 112, $m, 25, 250   # ESC p m t1 t2
  return ,$bytes
}

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
    $bytes = Get-DrawerBytes $pin
    $ns.Write($bytes, 0, $bytes.Length)
    $ns.Flush()
    Start-Sleep -Milliseconds 150
  } finally { $tcp.Close() }
}

function Send-Response($stream, [int]$code, [string]$json, [string]$origin) {
  $status = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 404 = 'Not Found'; 500 = 'Error'; 502 = 'Bad Gateway' }[$code]
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
    if ($path -eq '/ping') { Send-Response $stream 200 '{"ok":true,"app":"drawer-helper","v":2}' $origin; continue }
    if ($path -eq '/printers') { Send-Response $stream 200 ((Get-Printers) | ConvertTo-Json -Compress) $origin; continue }
    if ($path -eq '/drawer') {
      $pin = 2; if ($q['pin'] -eq '5') { $pin = 5 }
      if ($q.ContainsKey('ip')) {
        $ip = [string]$q['ip']
        if (-not (Test-PrivateIp $ip)) { Send-Response $stream 400 '{"ok":false,"error":"bad_ip"}' $origin; continue }
        $pp = 9100; if ($q['port'] -match '^\d{2,5}$') { $pp = [int]$q['port'] }
        try { Open-Drawer $ip $pp $pin; Send-Response $stream 200 '{"ok":true}' $origin }
        catch { Send-Response $stream 502 '{"ok":false,"error":"printer_unreachable"}' $origin }
      } else {
        # USB / Windows printer (empty name = default printer)
        $name = [string]$q['printer']
        if (-not $name) { $name = (Get-Printers).default }
        if (-not $name) { Send-Response $stream 400 '{"ok":false,"error":"printer_not_found"}' $origin; continue }
        try { $err = [RawPrinter]::Send($name, (Get-DrawerBytes $pin)) } catch { $err = 'print_failed' }
        if ($err) { Send-Response $stream 502 ('{"ok":false,"error":"' + $err + '"}') $origin }
        else { Send-Response $stream 200 '{"ok":true}' $origin }
      }
      continue
    }
    Send-Response $stream 404 '{"ok":false,"error":"not_found"}' $origin
  } catch {
    try { Send-Response $stream 500 '{"ok":false,"error":"helper_error"}' $origin } catch {}
  } finally {
    $client.Close()
  }
}

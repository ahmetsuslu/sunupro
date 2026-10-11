# Sunu Pro — ara kilidi gözcüsü.
#
# Ara sırasında Sunu Pro kendi kilit ekranını gösterir (projeksiyonda geri sayım sürer). Bu süreç
# kilidin aşılmasını engeller: Sunu Pro, PowerPoint gösterisi ve Windows Hello penceresi dışında bir
# pencere öne gelirse (Başlat, Alt+Tab, Görev Yöneticisi, Görev görünümü, kenar hareketleri...) ya da
# Sunu Pro kapanırsa/öldürülürse gerçek Windows kilidini (LockWorkStation) devreye sokar.
#
# stdin: {"cmd":"verify","message":"..."} | {"cmd":"quit"}
# stdout: {"event":"ready","hello":"Available"} | {"event":"verify","result":"Verified"} | {"event":"locked","reason":"..."}
param([int]$AppPid, [switch]$DryRun)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class SunuGuard {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool LockWorkStation();

  public static ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
  public static volatile bool Eof = false;

  // stdin ayrı iş parçacığında okunur; ana döngü ön plan penceresini izlemeye devam eder.
  // stdin kapanırsa (Sunu Pro kapandı ya da öldürüldü) Eof = true olur.
  public static void StartReader() {
    var t = new Thread(() => {
      var r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
      string l;
      while ((l = r.ReadLine()) != null) Lines.Enqueue(l);
      Eof = true;
    });
    t.IsBackground = true;
    t.Start();
  }

  public static uint ForegroundPid(out string cls) {
    IntPtr h = GetForegroundWindow();
    cls = "";
    if (h == IntPtr.Zero) return 0;
    var sb = new StringBuilder(128);
    GetClassName(h, sb, 128);
    cls = sb.ToString();
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    return pid;
  }
}
"@

$utf8 = New-Object System.Text.UTF8Encoding($false)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true
function Send($obj) { $stdout.WriteLine((ConvertTo-Json -InputObject $obj -Compress)) }

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
[void][Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]

function Lock-Now([string]$reason) {
  if (-not $DryRun) { [void][SunuGuard]::LockWorkStation() }
  Send @{ event = 'locked'; reason = $reason }
}

[SunuGuard]::StartReader()

# Windows Hello (parmak izi / yüz / PIN) kullanılabilir mi?
$hello = 'Unknown'
try {
  $t = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()))
  if ($t.Wait(5000)) { $hello = [string]$t.Result }
} catch { $hello = 'Error' }
Send @{ event = 'ready'; hello = $hello }

$verify = $null
$verifyEnded = [DateTime]::MinValue
$started = Get-Date
$bad = 0
$names = @{}

while ($true) {
  Start-Sleep -Milliseconds 150
  if ([SunuGuard]::Eof) { Lock-Now 'app-closed'; exit 0 }

  $line = $null
  while ([SunuGuard]::Lines.TryDequeue([ref]$line)) {
    try { $req = $line | ConvertFrom-Json } catch { continue }
    if ($req.cmd -eq 'quit') { exit 0 }
    if ($req.cmd -eq 'verify' -and $null -eq $verify) {
      $msg = [string]$req.message
      $verify = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($msg)))
    }
  }
  if ($null -ne $verify -and $verify.IsCompleted) {
    $result = if ($verify.IsFaulted) { 'Error' } else { [string]$verify.Result }
    Send @{ event = 'verify'; result = $result }
    $verify = $null
    $verifyEnded = Get-Date
  }

  # Kilit ekranı yerleşene dek kısa bir bekleme
  if (((Get-Date) - $started).TotalMilliseconds -lt 1200) { continue }

  $cls = ''
  $fpid = [SunuGuard]::ForegroundPid([ref]$cls)
  $allowed = $fpid -eq 0 -or $fpid -eq $AppPid -or $cls -eq 'screenClass'
  if (-not $allowed) {
    if (-not $names.ContainsKey($fpid)) { $names[$fpid] = (Get-Process -Id $fpid -ErrorAction SilentlyContinue).ProcessName }
    $proc = [string]$names[$fpid]
    # Windows Hello penceresi yalnızca doğrulama sürerken (ve kapanırken kısa bir süre) kabul edilir
    $helloWindow = $proc -eq 'CredentialUIBroker' -and ($null -ne $verify -or ((Get-Date) - $verifyEnded).TotalMilliseconds -lt 1500)
    $allowed = $helloWindow
  }
  if ($allowed) { $bad = 0 } else { $bad++ }
  if ($bad -ge 2) { Lock-Now "foreground:$($names[$fpid])/$cls"; exit 0 }
}
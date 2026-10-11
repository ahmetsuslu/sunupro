# Sunu Pro — ara kilidi gözcüsü.
#
# Ara sırasında Sunu Pro kendi kilit ekranını gösterir (projeksiyonda geri sayım sürer). Bu süreç
# kilidin aşılmasını engeller:
#  - Klavye: Windows tuşu, Alt+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc, Alt+F4, Alt+Boşluk engellenir
#    (Alt+Tab basılıyken açık pencerelerin önizlemesi görünmesin).
#  - Sunu Pro, PowerPoint gösterisi ve doğrulama sırasındaki Windows Hello penceresi dışında bir pencere
#    öne gelirse (Görev görünümü, kenar hareketleri, Görev Yöneticisi...) ya da Sunu Pro kapanır/öldürülürse
#    gerçek Windows kilidini (LockWorkStation) devreye sokar.
#  - Kilit Windows Hello (parmak izi / PIN) ile açılır; istek Sunu Pro'nun kilit penceresine bağlanır,
#    böylece parmak izi penceresi öne gelir ve odağı alır.
#
# stdin : {"cmd":"verify","hwnd":123,"message":"..."} | {"cmd":"cancel"} | {"cmd":"quit"}
# stdout: {"event":"ready","hello":"Available"} | {"event":"verify","result":"Verified"}
#         {"event":"blocked","key":"Alt+Tab"} | {"event":"locked","reason":"..."}
param([int]$AppPid, [int64]$AppHwnd = 0, [switch]$DryRun)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
public interface IUserConsentVerifierInterop {
  [return: MarshalAs(UnmanagedType.IInspectable)]
  object RequestVerificationForWindowAsync(IntPtr appWindow, [MarshalAs(UnmanagedType.HString)] string message, [In] ref Guid riid);
}

[ComImport, Guid("00000036-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
public interface IAsyncInfoRaw { uint Id { get; } int Status { get; } int ErrorCode { get; } void Cancel(); void Close(); }

public static class SunuGuard {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool LockWorkStation();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  // Odağı kilit penceresine geri al (Alt tuşu hilesi: arka plandaki sürecin öne getirme izni)
  public static bool Reclaim(IntPtr h) {
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    bool ok = SetForegroundWindow(h);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    return ok;
  }

  // ---- stdin: ayrı iş parçacığında okunur; kapanırsa (Sunu Pro kapandı/öldürüldü) Eof = true ----
  public static ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
  public static volatile bool Eof = false;
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

  // ---- Windows Hello: istek sahip pencereye bağlanır (öne gelir, odağı alır) ----
  public static object RequestVerification(object factory, IntPtr hwnd, string message, Guid iid) {
    return ((IUserConsentVerifierInterop)factory).RequestVerificationForWindowAsync(hwnd, message, ref iid);
  }
  public static void Cancel(object op) {
    try { ((IAsyncInfoRaw)op).Cancel(); } catch { }
  }

  // ---- Klavye kancası (WH_KEYBOARD_LL): sistem kısayollarını engeller ----
  delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr hMod, uint threadId);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hh, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  static HookProc proc;
  static IntPtr hook;
  public static ConcurrentQueue<string> Blocked = new ConcurrentQueue<string>();

  public static void StartKeyboardBlock() {
    var t = new Thread(() => {
      proc = Callback;
      hook = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0);
      MSG m;
      while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
    });
    t.IsBackground = true;
    t.Start();
  }

  static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      var k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
      bool alt = (k.flags & 0x20) != 0;
      bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
      bool down = (int)wParam == 0x100 || (int)wParam == 0x104;
      string name = null;
      if (k.vkCode == 0x5B || k.vkCode == 0x5C) name = "Windows";
      else if (k.vkCode == 0x09 && alt) name = "Alt+Tab";
      else if (k.vkCode == 0x1B && alt) name = "Alt+Esc";
      else if (k.vkCode == 0x1B && ctrl) name = "Ctrl+Esc";
      else if (k.vkCode == 0x73 && alt) name = "Alt+F4";
      else if (k.vkCode == 0x20 && alt) name = "Alt+Space";
      if (name != null) {
        if (down) Blocked.Enqueue(name);
        return (IntPtr)1;
      }
    }
    return CallNextHookEx(hook, nCode, wParam, lParam);
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
$resultType = [Windows.Security.Credentials.UI.UserConsentVerificationResult]
$opIid = $asTask.GetParameters()[0].ParameterType.GetGenericTypeDefinition().MakeGenericType($resultType).GUID
$factory = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal]::GetActivationFactory([Windows.Security.Credentials.UI.UserConsentVerifier])

# Windows Hello isteğini iptal et. Arayüz programatik iptali her zaman dikkate almıyor; pencere öndeyse
# Esc gönderilir (penceredeki "İptal" ile aynı), böylece ekranda sahipsiz bir doğrulama penceresi kalmaz.
function Cancel-Verify {
  if ($null -eq $script:verifyOp) { return }
  [SunuGuard]::Cancel($script:verifyOp)
  $c = ''
  $p = [SunuGuard]::ForegroundPid([ref]$c)
  $name = if ($p -ne 0) { (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName } else { '' }
  $esc = $name -eq 'CredentialUIBroker'
  if ($esc) {
    [SunuGuard]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
    [SunuGuard]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)
  }
  Send @{ event = 'cancel'; foreground = $name; esc = $esc }
}

function Lock-Now([string]$reason) {
  Cancel-Verify
  if (-not $DryRun) { [void][SunuGuard]::LockWorkStation() }
  Send @{ event = 'locked'; reason = $reason }
}

[SunuGuard]::StartReader()
[SunuGuard]::StartKeyboardBlock()

# Windows Hello (parmak izi / yüz / PIN) kullanılabilir mi?
$hello = 'Unknown'
try {
  $t = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()))
  if ($t.Wait(5000)) { $hello = [string]$t.Result }
} catch { $hello = 'Error' }
Send @{ event = 'ready'; hello = $hello }

$verifyOp = $null
$verifyTask = $null
$verifyEnded = [DateTime]::MinValue
$started = Get-Date
$bad = 0
$shellSince = $null
$names = @{}

while ($true) {
  Start-Sleep -Milliseconds 50
  # Önce EOF'u oku, sonra komutları işle: Sunu Pro kilidi açarken "quit" yazıp girişi kapatır; quit
  # kuyruktayken EOF'a bakmak, doğru açılan kilidin ardından Windows'u yanlışlıkla kilitlerdi
  $eof = [SunuGuard]::Eof

  $key = $null
  while ([SunuGuard]::Blocked.TryDequeue([ref]$key)) { Send @{ event = 'blocked'; key = $key } }

  $line = $null
  while ([SunuGuard]::Lines.TryDequeue([ref]$line)) {
    try { $req = $line | ConvertFrom-Json } catch { continue }
    if ($req.cmd -eq 'quit') {
      Cancel-Verify
      exit 0
    }
    if ($req.cmd -eq 'cancel') { Cancel-Verify }
    if ($req.cmd -eq 'verify' -and $null -eq $verifyTask) {
      try {
        $verifyOp = [SunuGuard]::RequestVerification($factory, [IntPtr][int64]$req.hwnd, [string]$req.message, $opIid)
        $verifyTask = $asTask.MakeGenericMethod($resultType).Invoke($null, @($verifyOp))
      } catch {
        Send @{ event = 'verify'; result = 'Error'; detail = $_.Exception.Message }
        $verifyOp = $null
        $verifyTask = $null
      }
    }
  }
  # Komut kuyruğu boşaldı ve giriş kapandı: Sunu Pro "quit" demeden kapandı ya da öldürüldü
  if ($eof -and [SunuGuard]::Lines.IsEmpty) { Lock-Now 'app-closed'; exit 0 }

  if ($null -ne $verifyTask -and $verifyTask.IsCompleted) {
    $result = if ($verifyTask.IsCanceled) { 'Canceled' } elseif ($verifyTask.IsFaulted) { 'Error' } else { [string]$verifyTask.Result }
    Send @{ event = 'verify'; result = $result }
    $verifyTask = $null
    $verifyOp = $null
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
    $allowed = $proc -eq 'CredentialUIBroker' -and ($null -ne $verifyTask -or ((Get-Date) - $verifyEnded).TotalMilliseconds -lt 1500)
  }
  # Görev çubuğu / masaüstü odağı alırsa (Windows bazen kendiliğinden verir) kilitleme, odağı geri al;
  # yarım saniyede geri alınamazsa kilitle
  $shellWindow = $cls -in @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW')
  if (-not $allowed -and $shellWindow -and $AppHwnd -ne 0) {
    if ($null -eq $shellSince) { $shellSince = Get-Date }
    if (((Get-Date) - $shellSince).TotalMilliseconds -lt 500) {
      [void][SunuGuard]::Reclaim([IntPtr]$AppHwnd)
      $bad = 0
      continue
    }
  } elseif ($allowed) { $shellSince = $null }
  if ($allowed) { $bad = 0 } else { $bad++ }
  # 2 ardışık örnek (~100 ms): Görev görünümü gibi yollar neredeyse anında kilitlenir
  if ($bad -ge 2) { Lock-Now "foreground:$($names[$fpid])/$cls"; exit 0 }
}
# Sunu Pro — PowerPoint denetleyicisi (kalıcı süreç).
#
# stdin'den satır satır JSON komut okur, stdout'a satır satır JSON yanıt yazar:
#   istek : {"id":1,"cmd":"open","args":{"path":"C:\\Dersler\\hafta1.pptx"}}
#   yanıt : {"id":1,"ok":true,"result":{...}}   |   {"id":1,"ok":false,"error":"..."}
#   olay  : {"event":"export-progress","data":{"done":3,"total":40}}
#
# PowerPoint'e COM otomasyonu ile erişir; gösteriyi PowerPoint'in kendisi oynatır
# (animasyon, geçiş, video birebir). Kullanıcının açık PowerPoint belgelerine dokunmaz:
# yalnızca kendi açtığı sunuyu kapatır, PowerPoint'i yalnızca kendisi başlattıysa kapatır.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$utf8 = New-Object System.Text.UTF8Encoding($false)
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class SunuWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }

  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFO mi);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

  // PowerPoint gösteri penceresi (SlideShowWindow COM'da HWND vermiyor; sınıf adı "screenClass")
  public static IntPtr FindShowWindow() {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      var sb = new System.Text.StringBuilder(64);
      GetClassName(h, sb, 64);
      if (sb.ToString() == "screenClass" && IsWindowVisible(h)) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        try {
          if (System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToUpperInvariant() == "POWERPNT") { found = h; return false; }
        } catch { }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // Fiziksel piksel koordinatındaki noktayı içeren ekranın sınırları
  public static RECT MonitorRectAt(int x, int y) {
    POINT p; p.X = x; p.Y = y;
    IntPtr h = MonitorFromPoint(p, 2 /* MONITOR_DEFAULTTONEAREST */);
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    GetMonitorInfo(h, ref mi);
    return mi.rcMonitor;
  }

  // Arka plandaki bir sürecin penceresini öne getirmek için Alt tuşu hilesi
  // (Windows, ön planda olmayan süreçlerin odak çalmasını engeller)
  public static bool ForceForeground(IntPtr hWnd) {
    keybd_event(0x12, 0, 0, UIntPtr.Zero);       // Alt basılı
    bool ok = SetForegroundWindow(hWnd);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);       // Alt bırak
    return ok;
  }
}
"@

# Fiziksel piksellerle çalış (farklı ölçekli ekranlarda doğru konum için)
[void][SunuWin32]::SetThreadDpiAwarenessContext([IntPtr](-4))  # PER_MONITOR_AWARE_V2

$script:app = $null
$script:ownsApp = $false
$script:pres = $null
$script:presPath = $null
$script:presCopy = $null
$script:lastVisible = 0
$script:showHwnd = [IntPtr]::Zero

function Send-Line($obj) {
  $stdout.WriteLine((ConvertTo-Json -InputObject $obj -Compress -Depth 8))
}

function Send-Event([string]$name, $data) {
  Send-Line @{ event = $name; data = $data }
}

# PowerPoint meşgulken COM çağrısı reddedilebilir (RPC_E_CALL_REJECTED / RETRYLATER) → kısa aralıklarla tekrar dene
function Invoke-Com([scriptblock]$block) {
  for ($i = 0; $i -lt 20; $i++) {
    try { return & $block }
    catch {
      $hr = $_.Exception.HResult
      if (($hr -eq -2147418111 -or $hr -eq -2147417846) -and $i -lt 19) { Start-Sleep -Milliseconds 100; continue }
      throw
    }
  }
}

# İsteğe bağlı komut argümanı (StrictMode'da olmayan özelliğe erişim hata verir)
function Get-Arg($a, [string]$name, $default = $null) {
  if ($null -eq $a) { return $default }
  $p = $a.PSObject.Properties[$name]
  if ($null -eq $p -or $null -eq $p.Value) { return $default }
  return $p.Value
}

function Get-App {
  if ($null -eq $script:app) {
    $running = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
    try { $script:app = New-Object -ComObject PowerPoint.Application }
    catch { throw "POWERPOINT_MISSING: PowerPoint bulunamadı veya başlatılamadı. $($_.Exception.Message)" }
    $script:ownsApp = -not $running
  }
  return $script:app
}

function Normalize-Text([string]$s) {
  if ($null -eq $s) { return '' }
  # PowerPoint paragrafları CR (13), satır sonlarını VT (11) ile ayırır
  return ($s -replace "`r`n", "`n" -replace "`r", "`n" -replace [char]11, "`n").Trim()
}

function Get-SlideInfo($s) {
  $title = ''
  try { if ($s.Shapes.HasTitle -eq -1) { $title = $s.Shapes.Title.TextFrame.TextRange.Text } } catch {}
  $notes = ''
  try {
    foreach ($sh in $s.NotesPage.Shapes) {
      if ($sh.Type -eq 14 -and $sh.PlaceholderFormat.Type -eq 2) {  # msoPlaceholder + ppPlaceholderBody
        $notes = $sh.TextFrame.TextRange.Text
        break
      }
    }
  } catch {}
  $clicks = 0
  try {
    foreach ($e in $s.TimeLine.MainSequence) {
      if ($e.Timing.TriggerType -eq 1) { $clicks++ }  # msoAnimTriggerOnPageClick
    }
  } catch {}
  return @{
    index  = [int]$s.SlideIndex
    id     = [int]$s.SlideID  # slayt eklenip silinse de değişmez (kişisel notlar buna bağlanır)
    title  = (Normalize-Text $title)
    notes  = (Normalize-Text $notes)
    hidden = ($s.SlideShowTransition.Hidden -eq -1)
    clicks = $clicks
  }
}

function Close-Presentation {
  if ($null -ne $script:pres) {
    try { $w = $script:pres.SlideShowWindow; if ($w) { $w.View.Exit() } } catch {}
    # Biz sunuları hep penceresiz açarız; belge penceresi olan sunu kullanıcınındır → asla kapatma
    $hasWindow = $false
    try { $hasWindow = $script:pres.Windows.Count -gt 0 } catch {}
    if (-not $hasWindow) { try { $script:pres.Close() } catch {} }
    $script:pres = $null
  }
  if ($null -ne $script:presCopy) {
    Remove-Item -LiteralPath (Split-Path $script:presCopy) -Recurse -Force -ErrorAction SilentlyContinue
    $script:presCopy = $null
  }
  $script:showHwnd = [IntPtr]::Zero
}

# Penceresiz açılan sunu, gösterisi bitince PowerPoint tarafından kendiliğinden kapatılır;
# bu durumda nesne geçersizleşir (özellikleri boş döner)
function Test-Presentation {
  if ($null -eq $script:pres) { return $false }
  try { return -not [string]::IsNullOrEmpty([string]$script:pres.FullName) } catch { return $false }
}

function Find-OpenPresentation($app, [string]$path) {
  foreach ($p in $app.Presentations) {
    try { if ([string]::Equals([string]$p.FullName, $path, [StringComparison]::OrdinalIgnoreCase)) { return $p } } catch {}
  }
  return $null
}

function Open-Presentation([string]$path) {
  $app = Get-App
  Close-Presentation
  $target = $path
  # Dosya kullanıcının PowerPoint'inde zaten açıksa Open aynı nesneyi döndürür; onu kapatmak
  # kullanıcının belgesini (kaydedilmemiş değişiklikleriyle) kapatır → kaydedilmiş hâlinin kopyasını aç
  if ($null -ne (Find-OpenPresentation $app $path)) {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ('sunupro-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $target = Join-Path $dir ([IO.Path]::GetFileName($path))
    Copy-Item -LiteralPath $path -Destination $target -Force
    $script:presCopy = $target
  }
  # ReadOnly=msoTrue, Untitled=msoFalse, WithWindow=msoFalse → düzenleme penceresi açılmaz
  $script:pres = Invoke-Com { $app.Presentations.Open($target, -1, 0, 0) }
  $script:presPath = $path
}

function Get-ShowWindow {
  if (-not (Test-Presentation)) { return $null }
  try { return $script:pres.SlideShowWindow } catch { return $null }
}

function Get-ShowState {
  $w = Get-ShowWindow
  if ($null -eq $w) { return @{ running = $false } }
  $v = $w.View
  $st = [int]$v.State
  $slide = 0; $click = 0; $clickCount = 0
  if ($st -ne 5) {  # ppSlideShowDone: gösteri sonu siyah ekranı, slayt yok
    try { $slide = [int]$v.Slide.SlideIndex } catch {}
    try { $click = [int]$v.GetClickIndex() } catch {}
    try { $clickCount = [int]$v.GetClickCount() } catch {}
  }
  return @{
    running    = $true
    slide      = $slide
    click      = $click
    clickCount = $clickCount
    state      = $st   # 1 çalışıyor, 2 duraklatıldı, 3 siyah, 4 beyaz, 5 bitti
    slideCount = [int]$script:pres.Slides.Count
    hwnd       = [int64]$script:showHwnd
  }
}

function Require-Show {
  $w = Get-ShowWindow
  if ($null -eq $w) { throw 'NO_SHOW: Gösteri çalışmıyor.' }
  return $w
}

# Gösteri penceresini, fiziksel piksel koordinatı (x,y) olan noktanın bulunduğu ekrana tam oturt
function Move-ShowToMonitor([int]$x, [int]$y) {
  $r = [SunuWin32]::MonitorRectAt($x, $y)
  $hwnd = $script:showHwnd
  if ($hwnd -eq [IntPtr]::Zero) { throw 'NO_SHOW_WINDOW: Gösteri penceresi bulunamadı.' }
  # SWP_NOZORDER (0x4) | SWP_NOACTIVATE (0x10) | SWP_SHOWWINDOW (0x40)
  [void][SunuWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, $r.Left, $r.Top, $r.Right - $r.Left, $r.Bottom - $r.Top, 0x54)
  $after = New-Object SunuWin32+RECT
  [void][SunuWin32]::GetWindowRect($hwnd, [ref]$after)
  return @{
    monitor = @{ left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom }
    window  = @{ left = $after.Left; top = $after.Top; right = $after.Right; bottom = $after.Bottom }
  }
}

function Invoke-Cmd([string]$cmd, $a) {
  switch ($cmd) {
    'ping' { return @{ pong = $true; pid = $PID } }

    'open' {
      $path = [string](Get-Arg $a 'path' '')
      if (-not (Test-Path -LiteralPath $path)) { throw "NOT_FOUND: Dosya bulunamadı: $path" }
      Open-Presentation $path
      $slides = @()
      $script:lastVisible = 0
      foreach ($s in $script:pres.Slides) {
        $info = Get-SlideInfo $s
        if (-not $info.hidden) { $script:lastVisible = $info.index }
        $slides += $info
      }
      return @{
        path        = $path
        slideCount  = [int]$script:pres.Slides.Count
        widthPt     = [double]$script:pres.PageSetup.SlideWidth
        heightPt    = [double]$script:pres.PageSetup.SlideHeight
        lastVisible = $script:lastVisible
        openedCopy  = ($null -ne $script:presCopy)
        slides      = $slides
      }
    }

    'export' {
      if (-not (Test-Presentation)) { throw 'NO_PRES: Açık sunu yok.' }
      $dir = [string](Get-Arg $a 'dir' '')
      $width = [int](Get-Arg $a 'width' 1920)
      $height = [int](Get-Arg $a 'height' 1080)
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      $total = [int]$script:pres.Slides.Count
      foreach ($s in $script:pres.Slides) {
        $file = Join-Path $dir ('slide-{0:D3}.png' -f [int]$s.SlideIndex)
        Invoke-Com { $s.Export($file, 'PNG', $width, $height) } | Out-Null
        Send-Event 'export-progress' @{ done = [int]$s.SlideIndex; total = $total }
      }
      return @{ dir = $dir; count = $total }
    }

    'start' {
      if (-not (Test-Presentation)) {
        if ($null -eq $script:presPath) { throw 'NO_PRES: Açık sunu yok.' }
        Open-Presentation $script:presPath   # önceki gösteri bitince kapanmıştı → yeniden aç
      }
      $ss = $script:pres.SlideShowSettings
      $ss.ShowType = 1            # ppShowTypeSpeaker (tam ekran)
      $ss.ShowPresenterView = 0   # PowerPoint'in kendi sunucu görünümü kapalı
      $ss.RangeType = 1           # ppShowAll
      $ss.LoopUntilStopped = 0
      $w = Invoke-Com { $ss.Run() }
      $script:showHwnd = [IntPtr]::Zero
      for ($i = 0; $i -lt 40 -and $script:showHwnd -eq [IntPtr]::Zero; $i++) {
        $script:showHwnd = [SunuWin32]::FindShowWindow()
        if ($script:showHwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 50 }
      }
      $placement = $null
      $px = Get-Arg $a 'x'; $py = Get-Arg $a 'y'
      if ($null -ne $px -and $null -ne $py) { $placement = Move-ShowToMonitor ([int]$px) ([int]$py) }
      try { $w.View.PointerType = 3 } catch {}  # ppSlideShowPointerAlwaysHidden — PowerPoint imleci gizli
      $slide = [int](Get-Arg $a 'slide' 1)
      if ($slide -gt 1) { Invoke-Com { $w.View.GotoSlide($slide, -1) } | Out-Null }
      $click = [int](Get-Arg $a 'click' 0)
      if ($click -gt 0) { Invoke-Com { $w.View.GotoClick($click) } | Out-Null }
      $st = Get-ShowState
      $st.placement = $placement
      return $st
    }

    'place' {
      [void](Require-Show)
      return Move-ShowToMonitor ([int](Get-Arg $a 'x' 0)) ([int](Get-Arg $a 'y' 0))
    }

    'state' { return Get-ShowState }

    'next' {
      $w = Require-Show
      $st = Get-ShowState
      # Son görünür slaytın son adımındayken ilerleme: PowerPoint'in "gösteri sonu" siyah ekranına düşme
      if ($st.slide -eq $script:lastVisible -and $st.click -ge $st.clickCount) { $st.atEnd = $true; return $st }
      Invoke-Com { $w.View.Next() } | Out-Null
      return Get-ShowState
    }

    'prev' {
      $w = Require-Show
      Invoke-Com { $w.View.Previous() } | Out-Null
      return Get-ShowState
    }

    'goto' {
      $w = Require-Show
      $slide = [int](Get-Arg $a 'slide' 1)
      $click = [int](Get-Arg $a 'click' 0)
      Invoke-Com { $w.View.GotoSlide($slide, -1) } | Out-Null
      if ($click -gt 0) { Invoke-Com { $w.View.GotoClick($click) } | Out-Null }
      return Get-ShowState
    }

    'screen' {
      # mode: normal | black | white
      $w = Require-Show
      $map = @{ normal = 1; black = 3; white = 4 }
      $mode = [string](Get-Arg $a 'mode' 'normal')
      if (-not $map.ContainsKey($mode)) { throw "BAD_ARG: Geçersiz ekran modu: $mode" }
      $w.View.State = $map[$mode]
      return Get-ShowState
    }

    'hide' {
      # Seyirci ekranı ayrıldığında gösteri birincil ekranı kaplamasın (place ile yeniden görünür)
      if ($script:showHwnd -ne [IntPtr]::Zero) { [void][SunuWin32]::ShowWindow($script:showHwnd, 0) }
      return Get-ShowState
    }

    'fg' { return @{ foreground = [int64][SunuWin32]::GetForegroundWindow() } }

    'focus' {
      $ok = [SunuWin32]::ForceForeground([IntPtr][int64](Get-Arg $a 'hwnd' 0))
      return @{ ok = $ok; foreground = [int64][SunuWin32]::GetForegroundWindow() }
    }

    'stop' {
      $w = Get-ShowWindow
      if ($null -ne $w) { try { $w.View.Exit() } catch {} }
      $script:showHwnd = [IntPtr]::Zero
      return @{ running = $false }
    }

    'close' {
      Close-Presentation
      return @{ closed = $true }
    }

    default { throw "UNKNOWN_CMD: $cmd" }
  }
}

function Exit-Clean {
  Close-Presentation
  if ($script:ownsApp -and $null -ne $script:app) {
    try { if ($script:app.Presentations.Count -eq 0) { $script:app.Quit() } } catch {}
  }
  $script:app = $null
}

Send-Event 'ready' @{ pid = $PID }

try {
  while ($true) {
    $line = $stdin.ReadLine()
    if ($null -eq $line) { break }  # stdin kapandı → uygulama kapanıyor
    if ($line.Trim() -eq '') { continue }
    $req = $null
    try { $req = $line | ConvertFrom-Json }
    catch { Send-Line @{ id = $null; ok = $false; error = 'BAD_JSON: Geçersiz komut.' }; continue }
    if ($req.cmd -eq 'quit') { Send-Line @{ id = $req.id; ok = $true; result = @{} }; break }
    try {
      $result = Invoke-Cmd ([string]$req.cmd) $req.args
      Send-Line @{ id = $req.id; ok = $true; result = $result }
    } catch {
      Send-Line @{ id = $req.id; ok = $false; error = $_.Exception.Message }
    }
  }
} finally {
  Exit-Clean
}

# Uygulama simgesi üretir: build/icon.png (512×512). electron-builder Windows .ico'yu bundan türetir.
# Tasarım: mavi-mor zemin üzerinde sunum tahtası + kırmızı lazer noktası.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'build\icon.png'
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null

$S = 512
$bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Zemin
$bg = RoundRect 16 16 480 480 112
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.PointF(16, 16)), (New-Object System.Drawing.PointF(496, 496)), [System.Drawing.Color]::FromArgb(255, 79, 140, 255), [System.Drawing.Color]::FromArgb(255, 124, 77, 255))
$g.FillPath($grad, $bg)

# Sunum tahtası ayağı
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 250, 251, 255))
$g.FillPath($white, (RoundRect 244 320 24 92 10))
$g.FillPath($white, (RoundRect 176 398 160 22 11))

# Tahta
$g.FillPath($white, (RoundRect 92 112 328 220 26))

# Slayt içeriği (başlık + maddeler)
$ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 91, 110, 230))
$soft = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 196, 206, 250))
$g.FillPath($ink, (RoundRect 128 148 170 24 12))
$g.FillPath($soft, (RoundRect 128 196 220 16 8))
$g.FillPath($soft, (RoundRect 128 228 190 16 8))
$g.FillPath($soft, (RoundRect 128 260 150 16 8))

# Lazer noktası + parıltı
$cx = 352; $cy = 266
foreach ($i in 0..9) {
  $r = 46 - $i * 3.6
  $a = [int](10 + $i * 9)
  $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a, 255, 40, 40))
  $g.FillEllipse($b, $cx - $r, $cy - $r, $r * 2, $r * 2)
}
$red = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 42, 42))
$g.FillEllipse($red, $cx - 15, $cy - 15, 30, 30)
$core = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 255, 255, 255))
$g.FillEllipse($core, $cx - 5.5, $cy - 5.5, 11, 11)

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"Kaydedildi: $out"
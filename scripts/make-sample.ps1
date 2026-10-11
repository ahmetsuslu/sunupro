# Geliştirme için örnek sunu üretir: samples/ornek-sunu.pptx
# İçerik: animasyonlu maddeler, konuşmacı notları, gizli slayt, geçişler ve
# hizalama kontrolü için köşe işaretleri (çizim katmanının slaytla örtüştüğünü doğrulamak için).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'samples\ornek-sunu.pptx'
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null

$running = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$app = New-Object -ComObject PowerPoint.Application
$p = $app.Presentations.Add(0)  # WithWindow=msoFalse

$W = $p.PageSetup.SlideWidth
$H = $p.PageSetup.SlideHeight
$layTitle = $p.SlideMaster.CustomLayouts.Item(1)
$layContent = $p.SlideMaster.CustomLayouts.Item(2)

function Add-Notes($slide, [string]$text) {
  $slide.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = $text
}

function Add-CornerMarkers($slide) {
  $s = 24
  $colors = @(0x3C14DC, 0x2E7D32, 0xC0392B, 0x0097A7)  # BGR
  $pos = @(@(0, 0), @(($W - $s), 0), @(0, ($H - $s)), @(($W - $s), ($H - $s)))
  for ($i = 0; $i -lt 4; $i++) {
    $r = $slide.Shapes.AddShape(1, $pos[$i][0], $pos[$i][1], $s, $s)
    $r.Fill.ForeColor.RGB = $colors[$i]
    $r.Line.Visible = 0
  }
  $c = $slide.Shapes.AddShape(9, ($W / 2 - 6), ($H / 2 - 6), 12, 12)  # merkez noktası
  $c.Fill.ForeColor.RGB = 0x000000
  $c.Line.Visible = 0
}

# 1 — Başlık
$s1 = $p.Slides.AddSlide(1, $layTitle)
$s1.Shapes.Item(1).TextFrame.TextRange.Text = 'Sunu Pro — Örnek Ders'
$s1.Shapes.Item(2).TextFrame.TextRange.Text = 'Çift ekran, işaretçi ve animasyon testi'
Add-CornerMarkers $s1
Add-Notes $s1 "Hoş geldiniz. Bu not yalnızca 1. ekranda görünmeli.`rKöşelerdeki renkli kareler çizim katmanının hizasını kontrol etmek içindir."

# 2 — Animasyonlu maddeler (her madde ayrı tıklama)
$s2 = $p.Slides.AddSlide(2, $layContent)
$s2.Shapes.Item(1).TextFrame.TextRange.Text = 'Animasyonlu Maddeler'
$s2.Shapes.Item(2).TextFrame.TextRange.Text = "Birinci madde`rİkinci madde`rÜçüncü madde"
[void]$s2.TimeLine.MainSequence.AddEffect($s2.Shapes.Item(2), 10, 2, 1)  # Fade, paragraf paragraf, tıklamayla
$s2.SlideShowTransition.EntryEffect = 1793  # ppEffectFade
Add-CornerMarkers $s2
Add-Notes $s2 "Üç tıklama var: her biri bir madde açar.`rİleri tuşu önce maddeleri, sonra sonraki slaytı getirmeli."

# 3 — Gizli slayt
$s3 = $p.Slides.AddSlide(3, $layContent)
$s3.Shapes.Item(1).TextFrame.TextRange.Text = 'Gizli Slayt'
$s3.Shapes.Item(2).TextFrame.TextRange.Text = 'Bu slayt gösteride atlanmalı.'
$s3.SlideShowTransition.Hidden = -1
Add-Notes $s3 'Gizli slayt notu.'

# 4 — Şekil animasyonu + geçiş
$s4 = $p.Slides.AddSlide(4, $layContent)
$s4.Shapes.Item(1).TextFrame.TextRange.Text = 'Şekil Animasyonu'
$s4.Shapes.Item(2).Delete()
$circle = $s4.Shapes.AddShape(9, ($W / 2 - 80), ($H / 2 - 40), 160, 160)
$circle.Fill.ForeColor.RGB = 0xE67E22
[void]$s4.TimeLine.MainSequence.AddEffect($circle, 2, 0, 1)  # Fly in, tıklamayla
$s4.SlideShowTransition.EntryEffect = 3844  # ppEffectPush... (geçiş)
Add-CornerMarkers $s4
Add-Notes $s4 'Daire tıklamayla uçarak gelir. Çizimler bu adımda da korunmalı.'

# 5 — Kapanış
$s5 = $p.Slides.AddSlide(5, $layTitle)
$s5.Shapes.Item(1).TextFrame.TextRange.Text = 'Teşekkürler'
$s5.Shapes.Item(2).TextFrame.TextRange.Text = 'Sorular?'
Add-Notes $s5 'Son slayt. İleri tuşu burada gösteriyi bitirmemeli.'

if (Test-Path $out) { Remove-Item $out -Force }
$p.SaveAs($out)
foreach ($s in $p.Slides) {
  $n = 0; foreach ($e in $s.TimeLine.MainSequence) { if ($e.Timing.TriggerType -eq 1) { $n++ } }
  "slayt $($s.SlideIndex): tıklama=$n gizli=$($s.SlideShowTransition.Hidden)"
}
$p.Close()
if (-not $running) { $app.Quit() }
"Kaydedildi: $out"

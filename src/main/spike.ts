import { app, BrowserWindow, desktopCapturer, screen, type Display } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ppt } from './pptctl'
import { cacheRoot, friendlyError, show } from './show'
import { physicalCenter } from './displays'
import { loadSettings, saveSettings } from './store'

/**
 * Otomatik uçtan uca doğrulama (yalnızca SUNU_SPIKE=<klasör> ortam değişkeniyle çalışır).
 * Örnek sunuyla gerçek PowerPoint + iki ekran üzerinde senaryoları koşar; kontrol sonuçlarını
 * ve ekran görüntülerini klasöre yazar, sonra uygulamayı kapatır.
 */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Koşul sağlanana dek (en fazla timeoutMs) bekler; sabit beklemelerden daha az kırılgan. */
async function waitFor(cond: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (cond()) return true
    await sleep(100)
  }
  return cond()
}

async function captureDisplay(d: Display, file: string): Promise<void> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) }
  })
  const src = sources.find((s) => s.display_id === String(d.id))
  if (src) writeFileSync(file, src.thumbnail.toPNG())
}

/** Gerçek klavye olayı gönderir (kısayol sistemini uçtan uca dener). */
function press(win: BrowserWindow, keyCode: string, modifiers: ('control' | 'shift')[] = []): void {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}

function runPs(outDir: string, name: string, code: string): string {
  const file = join(outDir, name)
  writeFileSync(file, '﻿' + code, 'utf-8')
  return execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', file], {
    encoding: 'utf-8'
  }).trim()
}

export async function runSpike(main: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const checks: { name: string; ok: boolean; detail?: unknown }[] = []
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    checks.push({ name, ok, detail })
  }
  const shot = async (name: string, which: 'audience' | 'presenter'): Promise<void> => {
    const d = which === 'audience' ? show.displays().audience : show.displays().presenter
    await captureDisplay(d, join(outDir, `${name}.png`))
  }
  const sample = join(app.getAppPath(), 'samples', 'ornek-sunu.pptx')
  const savedAudience = loadSettings().audienceDisplayId
  const consoleLog: string[] = []
  main.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') consoleLog.push(`[${e.level}] ${e.message}`)
  })

  try {
    if (main.webContents.isLoading()) await new Promise<void>((r) => main.webContents.once('did-finish-load', () => r()))
    await sleep(800)

    // A — Dosya ön kontrolleri
    const expectErr = async (label: string, path: string, code: string): Promise<void> => {
      try {
        await show.open(path)
        check(label, false, 'hata bekleniyordu')
      } catch (err) {
        const f = friendlyError(err)
        check(label, f.code === code, f)
      }
    }
    writeFileSync(join(outDir, 'bozuk.pptx'), 'bu bir sunu değil')
    await expectErr('olmayan dosya → NOT_FOUND', join(outDir, 'yok.pptx'), 'NOT_FOUND')
    await expectErr('bozuk dosya → CORRUPT', join(outDir, 'bozuk.pptx'), 'CORRUPT')
    const prot = join(outDir, '..', 'parolali.pptx')
    if (existsSync(prot)) await expectErr('parola korumalı → PASSWORD', prot, 'PASSWORD')

    // B — Açma + önbellek
    let t0 = Date.now()
    const info = await show.open(sample)
    check('örnek açıldı', info.slideCount === 5, { ms: Date.now() - t0, lastVisible: info.lastVisible })
    const dir = join(cacheRoot(), info.cacheKey)
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'))
    check('önbellek v2 + küçük resimler', manifest.v === 2 && existsSync(join(dir, 'thumb-005.png')))
    check('dosya açık değil → kopya yok', info.openedCopy === false)

    main.webContents.send('spike:presentation', info)
    await sleep(800)
    await shot('p1-gosteri-oncesi', 'presenter')

    // C — Kısayollarla canlı gösteri
    main.focus()
    press(main, 'F5')
    await waitFor(() => show.state.running)
    check('F5 → canlı gösteri başladı', show.state.running && show.state.mode === 'live', show.state)
    await sleep(1500)
    press(main, 'Right')
    // Geçiş bitip adım sayısı okunana dek bekle (geçiş sırasındaki ileri, geçişi tamamlamaya harcanır)
    await waitFor(() => show.state.slide === 2 && (show.state.clickCount ?? 0) > 0)
    await sleep(500)
    press(main, 'Right')
    await waitFor(() => show.state.click === 1, 3000)
    check('→ → slayt 2, adım 1', show.state.slide === 2 && show.state.click === 1, show.state)

    // 2. ekrana fareyle tıklama PowerPoint'e geçip slaytı ilerletmemeli, odak sunucuda kalmalı
    const before = { slide: show.state.slide, click: show.state.click }
    const c = physicalCenter(show.displays().audience)
    runPs(
      outDir,
      'tikla.ps1',
      `Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class M {
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
}
"@
[void][M]::SetThreadDpiAwarenessContext([IntPtr](-4))
$old = New-Object M+P; [void][M]::GetCursorPos([ref]$old)
[void][M]::SetCursorPos(${c.x}, ${c.y}); Start-Sleep -Milliseconds 150
[M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); [M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150; [void][M]::SetCursorPos($old.X, $old.Y)`
    )
    await sleep(1200)
    const fg = await ppt.call<{ foreground: number }>('fg')
    const mainHwnd = Number(main.getNativeWindowHandle().readBigUInt64LE())
    check('2. ekrana tıklama slaytı ilerletmedi', show.state.slide === before.slide && show.state.click === before.click, { before, after: show.state })
    check('2. ekrana tıklama PowerPoint gösterisini öne getirmedi', fg.foreground !== show.state.hwnd, { fg: fg.foreground, mainHwnd, showHwnd: show.state.hwnd })

    press(main, '1')
    await sleep(300)
    // Sahne üzerinde ~60 Hz gerçek fare hareketi (yay): Stage → MessagePort → katman yolunun tamamı.
    // İz boncuksuz, tek parça ve kuyruğa doğru solan olmalı.
    const st = (await main.webContents.executeJavaScript(
      `(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`
    )) as { x: number; y: number; w: number; h: number }
    for (let i = 0; i <= 30; i++) {
      const a = Math.PI * (0.15 + (0.7 * i) / 30)
      const nx = 0.5 - 0.3 * Math.cos(a)
      const ny = 0.75 - 0.35 * Math.sin(a)
      main.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(st.x + nx * st.w), y: Math.round(st.y + ny * st.h) })
      await sleep(16)
    }
    await sleep(40)
    await shot('a2-lazer-iz', 'audience')
    const dot = (await main.webContents.executeJavaScript(
      `(() => { const s = document.querySelector('.laser-dot').style; return { x: parseFloat(s.left) / 100, y: parseFloat(s.top) / 100 } })()`
    )) as { x: number; y: number }
    const end = { x: 0.5 - 0.3 * Math.cos(Math.PI * 0.85), y: 0.75 - 0.35 * Math.sin(Math.PI * 0.85) }
    check('lazer işaretçiyi geride kalmadan izliyor', Math.hypot(dot.x - end.x, dot.y - end.y) < 0.02, { dot, end })

    // Çizim: gerçek fare sürüklemesiyle kalem ve vurgulayıcı; geri al/yinele, silgi, slayt değişimi
    const inkCount = async (slide: number): Promise<number> =>
      main.webContents.executeJavaScript(`window.__sunuInk.get(${slide}).length`) as Promise<number>
    const drag = async (pts: [number, number][]): Promise<void> => {
      const at = ([nx, ny]: [number, number]): { x: number; y: number } => ({
        x: Math.round(st.x + nx * st.w),
        y: Math.round(st.y + ny * st.h)
      })
      main.webContents.sendInputEvent({ type: 'mouseDown', ...at(pts[0]), button: 'left', clickCount: 1 })
      for (const p of pts.slice(1)) {
        main.webContents.sendInputEvent({ type: 'mouseMove', ...at(p), modifiers: ['leftbuttondown'] })
        await sleep(12)
      }
      main.webContents.sendInputEvent({ type: 'mouseUp', ...at(pts[pts.length - 1]), button: 'left', clickCount: 1 })
      await sleep(150)
    }
    const line = (x0: number, y0: number, x1: number, y1: number, n = 24): [number, number][] =>
      Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n + 0.03 * Math.sin((i / n) * Math.PI * 2)])

    press(main, '3') // kalem
    await sleep(200)
    await drag(line(0.15, 0.62, 0.55, 0.7))
    press(main, '2') // vurgulayıcı
    await sleep(200)
    await drag(line(0.07, 0.45, 0.3, 0.45, 12).map(([x]) => [x, 0.45] as [number, number]))
    await sleep(300)
    check('kalem + vurgulayıcı → slaytta 2 çizim', (await inkCount(2)) === 2, await inkCount(2))
    await shot('i1-cizim-seyirci', 'audience')
    await shot('i1-cizim-sunucu', 'presenter')
    press(main, 'Z', ['control'])
    await sleep(200)
    const afterUndo = await inkCount(2)
    press(main, 'Y', ['control'])
    await sleep(200)
    check('Ctrl+Z → 1, Ctrl+Y → 2', afterUndo === 1 && (await inkCount(2)) === 2, { afterUndo, afterRedo: await inkCount(2) })
    press(main, '4') // silgi: kalem çizgisinin üstünden dikey geç
    await sleep(200)
    await drag(line(0.35, 0.55, 0.35, 0.8, 10).map(([, y]) => [0.35, y] as [number, number]))
    check('silgi → kalem çizgisi silindi', (await inkCount(2)) === 1, await inkCount(2))
    press(main, 'Z', ['control'])
    await sleep(200)
    check('silmeyi geri al → 2', (await inkCount(2)) === 2, await inkCount(2))
    press(main, 'Right', ['control']) // başka slayta geç: çizimler o slaytta kalmalı
    await waitFor(() => show.state.slide === 4, 4000)
    await sleep(500)
    await shot('i2-baska-slayt', 'audience')
    press(main, 'Left', ['control'])
    await waitFor(() => show.state.slide === 2, 4000)
    await sleep(500)
    check('slayt değişip dönünce çizimler yerinde', (await inkCount(2)) === 2 && (await inkCount(4)) === 0)
    await shot('i3-geri-donus', 'audience')
    press(main, 'C')
    await sleep(200)
    const afterClear = await inkCount(2)
    press(main, 'Z', ['control'])
    await sleep(200)
    check('C temizler, Ctrl+Z geri getirir', afterClear === 0 && (await inkCount(2)) === 2, { afterClear })
    press(main, 'B')
    await waitFor(() => show.state.state === 3, 3000)
    await sleep(300)
    await shot('i4-siyah-cizim-gizli', 'audience')
    press(main, 'B')
    await waitFor(() => show.state.state === 1, 3000)
    press(main, 'Delete', ['shift'])
    await sleep(400)
    press(main, 'Return')
    await sleep(300)
    check('Shift+Delete + onay → tüm çizimler silindi', (await inkCount(2)) === 0)
    press(main, '1') // sonraki adımlar bir araç seçili bekliyor (lazer)
    await sleep(200)
    await shot('p2-lazer', 'presenter')
    press(main, 'G')
    await sleep(700)
    await shot('p3-izgara', 'presenter')
    press(main, 'Escape')
    await sleep(400)
    press(main, 'Right', ['control'])
    await waitFor(() => show.state.slide === 4, 4000)
    check('Ctrl+→ → animasyon atlanıp slayt 4 (gizli 3 atlandı)', show.state.slide === 4, show.state)
    press(main, 'B')
    await waitFor(() => show.state.state === 3, 3000)
    check('B → siyah ekran', show.state.state === 3, show.state.state)
    await shot('a3-siyah', 'audience')
    press(main, 'B')
    await waitFor(() => show.state.state === 1, 3000)
    check('B tekrar → normal', show.state.state === 1, show.state.state)
    press(main, 'End')
    await waitFor(() => show.state.slide === 5, 4000)
    await sleep(800)
    press(main, 'Right')
    await sleep(800)
    check('son slaytta ileri → gösteri bitmedi (atEnd)', show.state.running && show.state.slide === 5, show.state)

    // D — Ekranları değiştir (gösteri sürerken)
    await show.swapDisplays()
    await sleep(2500)
    const sw = show.displays()
    check('değiştir → seyirci birincil ekran', sw.audience.id === screen.getPrimaryDisplay().id)
    await shot('d1-degistirilmis-seyirci', 'audience')
    await shot('d2-degistirilmis-sunucu', 'presenter')
    await show.swapDisplays()
    await sleep(2500)
    check('geri değiştir → seyirci 2. ekran', show.displays().audience.id !== screen.getPrimaryDisplay().id)
    await shot('d3-geri', 'audience')

    // E — Esc: önce aracı bırakır, sonra onay sorar; Enter bitirir
    main.focus()
    press(main, 'Escape') // lazeri bırak
    await sleep(300)
    press(main, 'Escape') // bitirme onayı
    await sleep(500)
    await shot('p4-bitir-onayi', 'presenter')
    check('Esc → onay penceresi açık, gösteri sürüyor', show.state.running)
    press(main, 'Return')
    await waitFor(() => !show.state.running, 5000)
    check('Enter → gösteri bitti', !show.state.running)

    // F — Görsel mod
    t0 = Date.now()
    await show.start({ slide: 2, mode: 'image' })
    await sleep(1200)
    check('görsel mod başladı', show.state.running && show.state.mode === 'image', { ms: Date.now() - t0, st: show.state })
    await shot('f1-gorsel-slayt2', 'audience')
    await show.command('next')
    await sleep(600)
    check('görsel modda ileri → slayt 4 (gizli atlandı)', show.state.slide === 4, show.state)
    await shot('f2-gorsel-slayt4', 'audience')
    await show.stop()
    await sleep(500)

    // G — Dosya kullanıcının PowerPoint'inde açıkken
    const copy = join(outDir, 'acik-test.pptx')
    writeFileSync(copy, readFileSync(sample))
    runPs(outDir, 'kullanici-acar.ps1', `$app = New-Object -ComObject PowerPoint.Application\n[void]$app.Presentations.Open('${copy}', 0, 0, -1)`)
    await sleep(1000)
    const info2 = await show.open(copy)
    check('açık dosya → kopya kullanıldı', info2.openedCopy === true)
    await show.start({ slide: 1 })
    await sleep(1500)
    await show.command('next')
    await sleep(500)
    await show.stop()
    await sleep(800)
    await ppt.call('close')
    const still = runPs(
      outDir,
      'kullanici-kontrol.ps1',
      `$app = New-Object -ComObject PowerPoint.Application\n$hit = $null\nforeach ($p in $app.Presentations) { if ($p.FullName -eq '${copy}') { $hit = $p } }\nif ($hit) { 'ACIK windows=' + $hit.Windows.Count; $hit.Close() } else { 'KAPANMIS' }`
    )
    check('kullanıcının belgesi açık kaldı', still.startsWith('ACIK'), still)
  } catch (err) {
    check('beklenmeyen hata', false, String((err as Error)?.stack ?? err))
  } finally {
    saveSettings({ audienceDisplayId: savedAudience })
  }

  const passed = checks.filter((c) => c.ok).length
  writeFileSync(join(outDir, 'sonuc.json'), JSON.stringify({ passed, total: checks.length, checks, consoleLog }, null, 2), 'utf-8')
  app.quit()
}

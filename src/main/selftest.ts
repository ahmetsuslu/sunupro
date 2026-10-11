import { app, BrowserWindow, desktopCapturer, powerMonitor, screen, type Display } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { cpus } from 'os'
import { ppt } from './pptctl'
import { cacheRoot, friendlyError, show } from './show'
import { physicalCenter } from './displays'
import { breakLock } from './lock'
import { loadSettings, saveSettings } from './store'

/**
 * Otomatik uçtan uca doğrulama (yalnızca SUNU_SELFTEST=<klasör> ortam değişkeniyle çalışır; npm run test:e2e).
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

export async function runSelfTest(main: BrowserWindow, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  // Ara kilidi testi gerçek Windows kilidini tetiklemesin (gözcü yalnızca bildirir)
  process.env['SUNU_LOCK_DRYRUN'] = '1'
  const checks: { name: string; ok: boolean; detail?: unknown }[] = []
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    checks.push({ name, ok, detail })
  }
  const js = <T>(code: string): Promise<T> => main.webContents.executeJavaScript(code) as Promise<T>
  const shot = async (name: string, which: 'audience' | 'presenter'): Promise<void> => {
    const d = which === 'audience' ? show.displays().audience : show.displays().presenter
    await captureDisplay(d, join(outDir, `${name}.png`))
  }
  const sample = process.env['SUNU_SAMPLE'] || join(app.getAppPath(), 'samples', 'ornek-sunu.pptx')
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
    // Parola korumalı .pptx'ler ZIP değil şifreli OLE kapsayıcısıdır (D0 CF 11 E0 ile başlar)
    const prot = join(outDir, 'parolali.pptx')
    writeFileSync(prot, Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504)]))
    await expectErr('parola korumalı → PASSWORD', prot, 'PASSWORD')

    // B — Açma + önbellek
    let t0 = Date.now()
    const info = await show.open(sample)
    check('örnek açıldı', info.slideCount === 5, { ms: Date.now() - t0, lastVisible: info.lastVisible })
    const dir = join(cacheRoot(), info.cacheKey)
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'))
    check('önbellek v2 + küçük resimler', manifest.v === 2 && existsSync(join(dir, 'thumb-005.png')))
    check('dosya açık değil → kopya yok', info.openedCopy === false)

    main.webContents.send('selftest:presentation', info)
    await sleep(800)
    await shot('p1-gosteri-oncesi', 'presenter')

    // C — Kısayollarla canlı gösteri
    main.focus()
    press(main, 'F5')
    await waitFor(() => show.state.running)
    check('F5 → canlı gösteri başladı', show.state.running && show.state.mode === 'live', show.state)
    await sleep(1500)
    // Boşta gösteri sırasında işlemci yükü (Sunu Pro'nun tüm Electron süreçleri, tek çekirdeğe göre %)
    app.getAppMetrics() // ölçümü başlat
    await sleep(4000)
    const cpu = app.getAppMetrics().reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0)
    check('gösteri boştayken işlemci yükü düşük (< %25 tek çekirdek)', cpu < 25, {
      cpuTekCekirdek: Math.round(cpu * 10) / 10,
      cekirdek: cpus().length,
      toplamYuzde: Math.round((cpu / cpus().length) * 10) / 10
    })
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

    // Lazer seçildiğini araç çubuğundan doğrula (gerçek fare imleci kıpırdarsa tuş olayı gecikebilir)
    const laserActive = (): Promise<boolean> =>
      js(`[...document.querySelectorAll('.toolbar .btn--active')].some((b) => b.textContent.includes('Lazer'))`)
    for (let i = 0; i < 3 && !(await laserActive()); i++) {
      main.focus()
      press(main, '1')
      await sleep(300)
    }
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

    // Z — Fare tekerleği, Ctrl+tekerlek, iki parmakla yakınlaştırma/kaydırma, lazer rengi/boyutu
    // Dokunma ve tekerlek Chrome DevTools protokolüyle gerçek giriş olayı olarak gönderilir
    const dbg = main.webContents.debugger
    if (!dbg.isAttached()) dbg.attach('1.3')
    const cdp = (method: string, params: Record<string, unknown>): Promise<unknown> => dbg.sendCommand(method, params)
    const at = (nx: number, ny: number): { x: number; y: number } => ({ x: st.x + nx * st.w, y: st.y + ny * st.h })
    const wheel = (nx: number, ny: number, deltaY: number, modifiers = 0): Promise<unknown> =>
      cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...at(nx, ny), deltaX: 0, deltaY, modifiers })
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number }[]): Promise<unknown> =>
      cdp('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 3, radiusY: 3, force: 0.5 }))
      })
    const view = (): Promise<{ s: number; cx: number; cy: number }> => js(`window.__sunuZoom.get()`)
    const pos = (): string => `${show.state.slide}.${show.state.click}`
    const pinch = async (from: number, to: number, steps = 10): Promise<void> => {
      const c = at(0.5, 0.5)
      const pts = (d: number): { x: number; y: number }[] => [
        { x: c.x - d, y: c.y },
        { x: c.x + d, y: c.y }
      ]
      await touch('touchStart', pts(from))
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', pts(from + ((to - from) * i) / steps))
        await sleep(16)
      }
      await touch('touchEnd', [])
      await sleep(250)
    }

    press(main, '0')
    await sleep(200)
    const p0 = pos()
    await wheel(0.5, 0.5, 120)
    await waitFor(() => pos() !== p0, 3000)
    const p1 = pos()
    await sleep(400)
    await wheel(0.5, 0.5, -120)
    await waitFor(() => pos() === p0, 3000)
    check('tekerlek aşağı → ileri, yukarı → geri', p1 !== p0 && pos() === p0, { p0, p1, p2: pos() })

    await wheel(0.3, 0.3, -400, 2) // Ctrl+tekerlek
    await sleep(400)
    const vw = await view()
    check('Ctrl+tekerlek → imlecin olduğu yere yakınlaşır, slayt değişmez', vw.s > 1.5 && vw.cx < 0.5 && pos() === p0, { vw, pos: pos() })
    press(main, 'Escape')
    await sleep(300)
    check('Esc → yakınlaştırma sıfırlandı', (await view()).s === 1)

    await pinch(60, 180)
    const vp = await view()
    check('iki parmakla büyütme (~3x)', vp.s > 2.5 && vp.s < 3.5, vp)
    await js(`!!document.querySelector('.chip--zoom')`).then((b) => check('üst çubukta yakınlaştırma yüzdesi', b === true))
    await sleep(1500) // seyirci ekranında gösteri yakalaması hazırlansın
    await shot('z1-yakinlastirma-seyirci', 'audience')
    await shot('z1-yakinlastirma-sunucu', 'presenter')

    const beforePan = await view()
    const center = at(0.5, 0.5)
    await touch('touchStart', [center])
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', [{ x: center.x - 25 * i, y: center.y }])
      await sleep(16)
    }
    await touch('touchEnd', [])
    await sleep(300)
    const afterPan = await view()
    check('yakınken tek parmak kaydırır, slayt değiştirmez', afterPan.cx > beforePan.cx + 0.03 && pos() === p0, {
      beforePan,
      afterPan,
      pos: pos()
    })

    // Yakınken çizim: sahne ortasındaki nokta slaytta görünümün merkezine kaydedilmeli
    press(main, '3')
    await sleep(200)
    const zv = await view()
    const slideNow = show.state.slide ?? 2
    await drag(line(0.5, 0.5, 0.56, 0.52, 6).map(([x, y]) => [x, y] as [number, number]))
    const first = (await js<number[]>(`window.__sunuInk.get(${slideNow}).slice(-1)[0].points[0]`)) ?? [0, 0]
    check('yakınken çizim doğru slayt konumuna kaydedilir', Math.hypot(first[0] - zv.cx, first[1] - zv.cy) < 0.01, { first, zv })
    await shot('z2-yakinken-cizim-seyirci', 'audience')
    press(main, 'Z', ['control'])
    press(main, '0')
    await sleep(200)

    await pinch(180, 50)
    const vr = await view()
    check('uzaklaştırınca tam boyuta oturur (kaydırma kapanır)', vr.s === 1, vr)
    const pBeforeSwipe = pos()
    await touch('touchStart', [at(0.7, 0.5)])
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [at(0.7 - 0.05 * i, 0.5)])
      await sleep(16)
    }
    await touch('touchEnd', [])
    await waitFor(() => pos() !== pBeforeSwipe, 3000)
    check('tam boyutta parmakla kaydırma yine slayt değiştirir', pos() !== pBeforeSwipe, { pBeforeSwipe, after: pos() })

    // Lazer rengi ve boyutu: araç çubuğundan seçim + R ile sonraki renk
    press(main, '1')
    await sleep(200)
    await js(`document.querySelector('.palette .swatch[title="Yeşil"]').click()`)
    await js(`document.querySelector('.palette .size-btn[title="Büyük"]').click()`)
    await sleep(300)
    const ink1 = await js<{ laserColor: string; laserSize: number }>(`window.api.settings.get().then((s) => s.ink)`)
    check('lazer rengi ve boyutu seçilebiliyor', ink1.laserColor === '#22e05a' && ink1.laserSize === 2, ink1)
    for (let i = 0; i <= 12; i++) {
      main.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(st.x + (0.3 + 0.03 * i) * st.w), y: Math.round(st.y + 0.6 * st.h) })
      await sleep(16)
    }
    await sleep(40)
    await shot('z3-lazer-yesil-buyuk', 'audience')
    const dotColor = await js<string>(`document.querySelector('.laser-dot').style.getPropertyValue('--laser')`)
    check('sunucudaki lazer noktası seçilen renkte', dotColor === '#22e05a', dotColor)
    press(main, 'R')
    await sleep(300)
    const ink2 = await js<{ laserColor: string }>(`window.api.settings.get().then((s) => s.ink)`)
    check('lazer seçiliyken R → sonraki lazer rengi', ink2.laserColor === '#2a8cff', ink2)
    press(main, '0')
    await sleep(200)

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

    // H — Kütüphane, ön hazırlık, kaldığın yerden devam, ara modu, çizim saklama (arayüz üzerinden)
    const clickButton = (text: string): Promise<boolean> =>
      js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b })()`)
    type View = { courses: { id: string; items: { name: string; status: string; session: { slide: number } | null }[] }[] }

    await js(`document.querySelector('button[title="Sunuyu kapat"]')?.click()`)
    await waitFor(() => !show.presentation, 5000)
    await sleep(600)
    check('Kapat → kütüphane ekranı', await js<boolean>(`!!document.querySelector('.library')`))

    const folder = join(outDir, 'ders-klasoru')
    mkdirSync(folder, { recursive: true })
    for (const n of ['Hafta 10', 'Hafta 2', 'Hafta 1']) writeFileSync(join(folder, `${n}.pptx`), readFileSync(sample))
    const v1 = await js<View>(`window.api.library.createCourse('Test Dersi', '#4f8cff')`)
    const courseId = v1.courses[0].id
    const v2 = await js<View>(`window.api.library.addFiles(${JSON.stringify(courseId)}, ${JSON.stringify([sample, folder])})`)
    const names = v2.courses[0].items.map((i) => i.name)
    check('ders + klasör bağlama (doğal sıralama)', names.join('|') === 'ornek-sunu.pptx|Hafta 1.pptx|Hafta 2.pptx|Hafta 10.pptx', names)

    let ready = false
    const tPrep = Date.now()
    for (let i = 0; i < 120 && !ready; i++) {
      const v = await js<View>(`window.api.library.get()`)
      ready = v.courses[0].items.every((it) => it.status === 'ready')
      if (!ready) await sleep(500)
    }
    check('arka planda ön hazırlık → hepsi hazır', ready, { ms: Date.now() - tPrep })

    // Seçili dersi göster, ekran görüntüsü
    await clickButton('Test Dersi')
    await sleep(500)
    await shot('h0-kutuphane', 'presenter')

    const sess = (await js<View>(`window.api.library.get()`)).courses[0].items.find((i) => i.name === 'ornek-sunu.pptx')?.session
    check('örnek sunu için kalınan yer kayıtlı', !!sess && sess.slide >= 1, sess)

    await js(`[...document.querySelectorAll('.file-row')].find((r) => r.textContent.includes('ornek-sunu')).click()`)
    await waitFor(() => show.presentation?.name === 'ornek-sunu.pptx', 15000)
    await sleep(800)
    check('açılışta "kaldığın yerden devam" önerisi', await js<boolean>(`document.body.innerText.includes('üzerinde kalmıştın')`))
    await shot('h1-devam-onerisi', 'presenter')
    await clickButton('Kaldığın yerden devam')
    await waitFor(() => show.state.running, 8000)
    await sleep(800)
    check('devam → kalınan slayttan başladı', show.state.slide === sess?.slide, { state: show.state.slide, sess })

    main.focus()
    const locksAtStart = breakLock.requests
    press(main, 'A')
    await sleep(800)
    check('A → ara modu (sunucuda şerit)', await js<boolean>(`!!document.querySelector('.banner--break')`))

    // Ara kilidi: Windows'un kendi kilidi istenir (kuru çalıştırma: gerçek kilit yerine yalnızca sayılır).
    // Uygulama tam ekran/en üst kilit penceresine geçmez, ek gözcü süreci yoktur.
    await waitFor(() => breakLock.requests > locksAtStart, 3000)
    check('A → Windows kilidi istendi', breakLock.requests === locksAtStart + 1, { requests: breakLock.requests })
    check('uygulama kendi kilit penceresine geçmez (kiosk yok)', !main.isKiosk())
    await sleep(600)
    await shot('h2-ara-seyirci', 'audience')
    // Kilitle düğmesi de Windows kilidini ister
    await clickButton('Kilitle')
    await sleep(300)
    check('ara şeridindeki Kilitle → Windows kilidi', breakLock.requests === locksAtStart + 2, { requests: breakLock.requests })
    powerMonitor.emit('unlock-screen') // kullanıcı Windows kilidini parmak iziyle açtı
    await sleep(500)
    check('kilit açılınca ara ve sunum sürüyor', show.state.running && (await js<boolean>(`!!document.querySelector('.banner--break')`)))
    main.focus()
    press(main, 'A')
    await sleep(400)
    check('A tekrar → derse dönüş', !(await js<boolean>(`!!document.querySelector('.banner--break')`)))

    // Çizim saklama: ayarı aç, çiz, kapat-aç → çizim geri gelmeli
    await js(`window.api.settings.set({ rememberInk: true })`)
    await sleep(300)
    const drawSlide = show.state.slide ?? 1
    press(main, '3')
    await sleep(200)
    await drag(line(0.2, 0.3, 0.6, 0.35))
    await sleep(300)
    const inkBefore = await inkCount(drawSlide)
    await show.stop()
    await sleep(500)
    await js(`document.querySelector('button[title="Sunuyu kapat"]')?.click()`)
    await waitFor(() => !show.presentation, 5000)
    await sleep(800)
    await js(`[...document.querySelectorAll('.file-row')].find((r) => r.textContent.includes('ornek-sunu')).click()`)
    await waitFor(() => show.presentation?.name === 'ornek-sunu.pptx', 15000)
    await sleep(1500)
    // I — Ayarlar: kısayol atama, çakışma taşıma, zorunlu tuş koruması, varsayılana dönüş, güncelleme
    const shortcuts = (): Promise<Record<string, string[]>> => js(`window.api.settings.get().then((s) => s.shortcuts)`)
    const rowButton = (label: string, text: string): Promise<boolean> =>
      js(
        `(() => { const row = [...document.querySelectorAll('.shortcut-row')].find((r) => r.querySelector('.shortcut-row__label').textContent === ${JSON.stringify(label)}); const b = row && [...row.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b })()`
      )
    await js(`document.querySelector('button[title^="Ayarlar"]')?.click()`)
    await sleep(400)
    check('⚙ → ayarlar penceresi', await js<boolean>(`!!document.querySelector('.settings')`))
    await clickButton('Kısayollar')
    await sleep(300)
    await rowButton('Lazer işaretçi', '+ Tuş ekle')
    await sleep(200)
    press(main, 'L')
    await sleep(400)
    const s1 = await shortcuts()
    check('lazere L eklendi', JSON.stringify(s1.toolLaser) === '["1","L"]', s1)
    await rowButton('Lazer işaretçi', '+ Tuş ekle')
    await sleep(200)
    press(main, '2') // vurgulayıcının tuşu → taşıma onayı
    await sleep(400)
    const asked = await js<boolean>(`document.body.innerText.includes('taşınsın mı')`)
    await shot('i5-kisayol-cakisma', 'presenter')
    await clickButton('Taşı')
    await sleep(400)
    const s2 = await shortcuts()
    check('çakışma: onay sorup 2 lazere taşındı', asked && JSON.stringify(s2.toolLaser) === '["1","L","2"]' && JSON.stringify(s2.toolHighlighter) === '[]', s2)
    const escLocked = await js<boolean>(
      `(() => { const row = [...document.querySelectorAll('.shortcut-row')].find((r) => r.textContent.includes('yoksa sunumu bitir')); return row.querySelector('.key-chip button').disabled })()`
    )
    check('zorunlu eylemin tek tuşu kaldırılamıyor (Esc)', escLocked)
    press(main, 'Escape')
    await sleep(300)
    check('Esc → ayarlar kapandı', !(await js<boolean>(`!!document.querySelector('.settings')`)))
    press(main, 'L')
    await sleep(300)
    check('yeni tuş sunumda çalışıyor (L → lazer)', await js<boolean>(`[...document.querySelectorAll('.toolbar .btn--active')].some((b) => b.textContent.includes('Lazer'))`))
    press(main, '0')
    await js(`document.querySelector('button[title^="Ayarlar"]')?.click()`)
    await sleep(300)
    await clickButton('Kısayollar')
    await sleep(200)
    await clickButton('Tümünü varsayılana döndür')
    await sleep(300)
    check('tümünü varsayılana döndür', Object.keys(await shortcuts()).length === 0, await shortcuts())
    await clickButton('Güncelleme')
    await sleep(200)
    await clickButton('Güncellemeleri denetle')
    // Geliştirmede denetim yapılmaz; paketli uygulamada GitHub'a gidilir ve bir sonuç gelir
    const updateTexts = ['Geliştirme sürümünde', 'güncel', 'Denetlenemedi', 'indiriliyor', 'indirildi']
    let updateText = ''
    for (let i = 0; i < 40 && !updateText; i++) {
      const body = await js<string>(`document.querySelector('.settings__status')?.textContent ?? ''`)
      if (updateTexts.some((t) => body.includes(t))) updateText = body
      else await sleep(250)
    }
    check('güncelleme denetimi sonuç verdi', !!updateText, updateText || 'sonuç yok')
    await clickButton('Genel')
    await sleep(400)
    await shot('i6-ayarlar-genel', 'presenter')
    press(main, 'Escape')
    await sleep(200)

    check('çizim saklama: kapatıp açınca çizim yerinde', inkBefore === 1 && (await inkCount(drawSlide)) === 1, {
      inkBefore,
      after: await inkCount(drawSlide)
    })
  } catch (err) {
    check('beklenmeyen hata', false, String((err as Error)?.stack ?? err))
  } finally {
    saveSettings({ audienceDisplayId: savedAudience })
  }

  const passed = checks.filter((c) => c.ok).length
  writeFileSync(join(outDir, 'sonuc.json'), JSON.stringify({ passed, total: checks.length, checks, consoleLog }, null, 2), 'utf-8')
  app.quit()
}

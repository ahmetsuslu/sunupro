import { app, BrowserWindow, desktopCapturer, screen, type Display } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { cpus } from 'os'
import { ppt } from './pptctl'
import { cacheRoot, friendlyError, show } from './show'
import { physicalCenter } from './displays'
import { libraryView } from './library'
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

    // Fare imleci: araç seçili değilken sunucudaki fare seyirci ekranında ok olarak görünür (ucu aynı noktada)
    {
      const r0 = (await js(
        `(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`
      )) as { x: number; y: number; w: number; h: number }
      const pointerState = (): Promise<{ opacity: number; tipX: number; tipY: number; expX: number; expY: number }> =>
        show.overlay!.webContents.executeJavaScript(`(() => {
          const el = document.querySelector('.overlay-pointer'), b = el.getBoundingClientRect(), u = b.height / 22
          const a = ${(show.presentation?.widthPt ?? 16) / (show.presentation?.heightPt ?? 9)}, W = innerWidth, H = innerHeight
          const sw = Math.min(W, H * a), sh = sw / a, sx = (W - sw) / 2, sy = (H - sh) / 2
          return { opacity: Number(getComputedStyle(el).opacity), tipX: b.x + u, tipY: b.y + u, expX: sx + 0.4 * sw, expY: sy + 0.5 * sh }
        })()`)
      for (let i = 0; i <= 6; i++) {
        main.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(r0.x + (0.3 + (0.1 * i) / 6) * r0.w), y: Math.round(r0.y + 0.5 * r0.h) })
        await sleep(20)
      }
      await sleep(350)
      const ptr = await pointerState()
      await shot('a1b-fare-oku', 'audience')
      check(
        'araç yokken fare seyirci ekranında ok olarak görünüyor',
        ptr.opacity > 0.9 && Math.abs(ptr.tipX - ptr.expX) < 6 && Math.abs(ptr.tipY - ptr.expY) < 6,
        ptr
      )
      main.focus()
      press(main, '1')
      await sleep(400)
      check('lazer seçilince seyirci ekranındaki ok kayboluyor', (await pointerState()).opacity < 0.1)
    }

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
    // Sahnede gönderilen fare konumu (tam sayı piksel) → sahneye göre 0..1
    const sent = (nx: number, ny: number): { x: number; y: number; nx: number; ny: number } => {
      const x = Math.round(st.x + nx * st.w)
      const y = Math.round(st.y + ny * st.h)
      return { x, y, nx: (x - st.x) / st.w, ny: (y - st.y) / st.h }
    }
    // Sunucu ekranındaki lazer tuvalinden piksel (RGBA): (nx, ny) çevresinde d piksellik kutudaki en opak nokta.
    // dx: slayt yüksekliğine oranla yatay kaydırma. Sahne slayt oranında; yakınlaştırma yokken çağrılır.
    const laserPx = (nx: number, ny: number, d = 0, dx = 0): Promise<number[]> =>
      js<number[]>(`(() => {
        const c = document.querySelector('.stage__laser')
        const x = Math.round(${nx} * c.width + ${dx} * c.height), y = Math.round(${ny} * c.height)
        const px = c.getContext('2d').getImageData(x - ${d}, y - ${d}, ${2 * d + 1}, ${2 * d + 1}).data
        let best = 0
        for (let i = 0; i < px.length; i += 4) if (px[i + 3] > px[best + 3]) best = i
        return [...px.slice(best, best + 4)]
      })()`)
    const arc = (i: number): { x: number; y: number; nx: number; ny: number } => {
      const a = Math.PI * (0.15 + (0.7 * i) / 30)
      return sent(0.5 - 0.3 * Math.cos(a), 0.75 - 0.35 * Math.sin(a))
    }
    for (let i = 0; i <= 30; i++) {
      const p = arc(i)
      main.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
      await sleep(16)
    }
    await sleep(40)
    // Uç: tam opak nokta tam son konumda (geride kalmıyor); iz: birkaç örnek geride hâlâ boyalı
    const end = arc(30)
    const tail = await laserPx(arc(25).nx, arc(25).ny, 4)
    // Gerçek imleç pencerenin üstündeyse Windows'un ürettiği tek bir fare olayı lazeri kaldırabilir: son konumu yinele
    let head = await laserPx(end.nx, end.ny)
    for (let i = 0; i < 3 && head[3] < 250; i++) {
      main.webContents.sendInputEvent({ type: 'mouseMove', x: end.x, y: end.y })
      await sleep(50)
      head = await laserPx(end.nx, end.ny)
    }
    check('lazer işaretçiyi geride kalmadan izliyor', head[3] >= 250, { head, end })
    check('sunucu ekranında lazer izi animasyonu görünüyor', tail[3] > 20 && tail[0] > tail[1], { tail })
    await shot('a2-lazer-iz', 'audience')
    await shot('a3-lazer-iz-sunucu', 'presenter')

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
      const p = sent(0.3 + 0.03 * i, 0.6)
      main.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
      await sleep(16)
    }
    await sleep(40)
    // Noktanın hareket yönündeki kenarı (beyaz göbek ve iz dışında): seçilen yeşil, tam opak
    const lEnd = sent(0.3 + 0.03 * 12, 0.6)
    const rim = await laserPx(lEnd.nx, lEnd.ny, 0, 0.65 * 0.017)
    check('sunucudaki lazer seçilen renkte', rim[3] >= 250 && rim[1] > 180 && rim[0] < 100 && rim[2] < 140, rim)
    await shot('z3-lazer-yesil-buyuk', 'audience')
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
    type View = {
      courses: { id: string; items: { name: string; status: string; session: { slide: number } | null; presentedAt: number | null }[] }[]
    }

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

    const sample0 = (await js<View>(`window.api.library.get()`)).courses[0].items.find((i) => i.name === 'ornek-sunu.pptx')
    const sess = sample0?.session
    check('örnek sunu için kalınan yer kayıtlı', !!sess && sess.slide >= 1, sess)
    check('son slayta gelinen sunu "sunuldu" işaretlendi', sample0?.presentedAt != null, sample0?.presentedAt)

    // Sunuldu işareti: Shift+✓ üsttekilerle birlikte işaretler, ✓ tek tek kaldırır; "Sıradaki" ilk sunulmamış sunu
    const presentedUi = (): Promise<{ count?: string; next?: string }> =>
      js(`({ count: document.querySelector('.lib-head__count')?.textContent, next: document.querySelector('.file-row--next .file-row__name')?.textContent })`)
    const tick = (name: string, shiftKey: boolean): Promise<unknown> =>
      js(`(() => { const row = [...document.querySelectorAll('.file-row')].find((r) => r.querySelector('.file-row__name').textContent === ${JSON.stringify(name)}); row.querySelector('button[aria-pressed]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: ${shiftKey} })); return true })()`)
    await tick('Hafta 2', true)
    await sleep(300)
    const ui1 = await presentedUi()
    check('Shift+✓ → üsttekilerle birlikte sunuldu, sıradaki Hafta 10', ui1.count === '3 / 4 sunuldu' && ui1.next === 'Hafta 10', ui1)
    await shot('h0b-sunuldu', 'presenter')
    await tick('Hafta 2', false)
    await sleep(300)
    const ui2 = await presentedUi()
    check('✓ → işaret kalktı, sıradaki Hafta 2', ui2.count === '2 / 4 sunuldu' && ui2.next === 'Hafta 2', ui2)

    // Sürükleyerek sıralama: tutamaçtan fareyle en üste, parmakla en alta; sunu açılmamalı
    type Box = { x: number; y: number; top: number; bottom: number }
    const rowBoxes = (): Promise<{ name: string; handle: Box; row: Box }[]> =>
      js(`[...document.querySelectorAll('.file-list .file-row')].map((r) => {
        const b = (el) => { const x = el.getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2, top: x.top, bottom: x.bottom } }
        return { name: r.querySelector('.file-row__name').textContent, handle: b(r.querySelector('.drag-handle')), row: b(r) }
      })`)
    const order = async (): Promise<string> =>
      (await js<View>(`window.api.library.get()`)).courses[0].items.map((i) => i.name.replace('.pptx', '')).join('|')
    const glide = async (move: (y: number) => Promise<unknown>, y0: number, y1: number): Promise<void> => {
      for (let k = 1; k <= 12; k++) {
        await move(y0 + ((y1 - y0) * k) / 12)
        await sleep(25)
      }
    }
    let rb = await rowBoxes()
    const h10 = rb.find((r) => r.name === 'Hafta 10')!
    const mouse = (type: string, x: number, y: number): Promise<unknown> =>
      cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
    await mouse('mousePressed', h10.handle.x, h10.handle.y)
    await glide((y) => mouse('mouseMoved', h10.handle.x, y), h10.handle.y, rb[0].row.top + 8)
    await sleep(150)
    await shot('h0c-surukle', 'presenter')
    await mouse('mouseReleased', h10.handle.x, rb[0].row.top + 8)
    await sleep(500)
    check('fareyle sürükle → Hafta 10 en üstte, sunu açılmadı', (await order()) === 'Hafta 10|ornek-sunu|Hafta 1|Hafta 2' && !show.presentation, await order())
    rb = await rowBoxes()
    const top = rb[0]
    await touch('touchStart', [{ x: top.handle.x, y: top.handle.y }])
    await glide((y) => touch('touchMove', [{ x: top.handle.x, y }]), top.handle.y, rb[rb.length - 1].row.bottom - 8)
    await touch('touchEnd', [])
    await sleep(500)
    check('parmakla sürükle → Hafta 10 yeniden en altta', (await order()) === 'ornek-sunu|Hafta 1|Hafta 2|Hafta 10' && !show.presentation, await order())

    // Klasör izleme: bağlı klasöre yeni sunu eklenince liste yenilemeden kendiliğinden güncellenir
    const rowVisible = (name: string): Promise<boolean> =>
      js(`[...document.querySelectorAll('.file-row__name')].some((n) => n.textContent === ${JSON.stringify(name)})`)
    writeFileSync(join(folder, 'Hafta 11.pptx'), readFileSync(sample))
    let appeared = false
    for (let i = 0; i < 24 && !appeared; i++) {
      await sleep(250)
      appeared = await rowVisible('Hafta 11')
    }
    check('bağlı klasöre eklenen sunu listede kendiliğinden göründü', appeared)

    // Bağlı klasördeki sunuyu X ile listeden çıkar: klasörde durduğu hâlde tarama onu geri eklememeli; "Geri getir" ile döner
    await js(`(() => {
      const row = [...document.querySelectorAll('.file-row')].find((r) => r.querySelector('.file-row__name').textContent === 'Hafta 11')
      row.querySelector('button[title^="Listeden çıkar"]').click()
      return true
    })()`)
    await sleep(400)
    main.webContents.send('library:changed', libraryView()) // klasör taraması (izleyici/odak) yeniden çalışsın
    await sleep(300)
    const removed = !(await rowVisible('Hafta 11')) && !(await order()).includes('Hafta 11')
    const chip = await js<string>(`document.querySelector('.folder-chip')?.textContent ?? ''`)
    check('klasördeki sunu listeden çıkarıldı, taramada geri gelmedi', removed && chip.includes('1 sunu listeden çıkarıldı'), { chip })
    await clickButton('Geri getir')
    await sleep(500)
    check('"Geri getir" ile listeye döndü', (await rowVisible('Hafta 11')) && (await order()).includes('Hafta 11'), await order())

    // Klasörü bağlı olmayan, sunuları tek klasörde olan ders: "Klasörü bağla" önerisi → tek tıkla bağlanır
    const vS = await js<View>(`window.api.library.createCourse('Klasörsüz Ders', '#ff9800')`)
    const loneId = vS.courses[vS.courses.length - 1].id
    await js(`window.api.library.addFiles(${JSON.stringify(loneId)}, ${JSON.stringify([sample])})`)
    main.webContents.send('library:changed', libraryView()) // arayüz dışından eklendi: menüyü yenile
    await sleep(300)
    await clickButton('Klasörsüz Ders')
    await sleep(400)
    const hasSuggest = await js<boolean>(`!!document.querySelector('.folder-chip--suggest')`)
    await clickButton('Klasörü bağla')
    await sleep(500)
    const lone = (await js<{ courses: { id: string; folder: string | null }[] }>(`window.api.library.get()`)).courses.find((c) => c.id === loneId)
    check(
      'klasörsüz derste "Klasörü bağla" önerisi, tek tıkla bağlandı',
      hasSuggest && lone?.folder?.toLowerCase() === dirname(sample).toLowerCase() && !(await js<boolean>(`!!document.querySelector('.folder-chip--suggest')`)),
      { hasSuggest, folder: lone?.folder }
    )
    await js(`window.api.library.deleteCourse(${JSON.stringify(loneId)})`)
    await clickButton('Test Dersi')
    await sleep(400)

    // Ders programı: boş hücreye tıkla → Pazartesi 3.–4. saat, C201, 2. sınıf
    type Tt = { timetable: { slots: { day: number; from: number; to: number; room: string }[]; levels: { id: string; name: string; color: string }[] } }
    await clickButton('Ders programı')
    await sleep(400)
    check('Ders programı ekranı açıldı', await js<boolean>(`!!document.querySelector('.tt-grid')`))
    await js(`document.querySelector('.tt-row[data-day="1"]').querySelectorAll('.tt-cell')[2].click()`)
    await sleep(300)
    await js(`(() => {
      const field = (label) => [...document.querySelectorAll('.slot-dialog .field')].find((f) => f.querySelector('span').textContent === label)
      const setVal = (el, v) => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
      }
      setVal(field('Bitiş').querySelector('select'), '3')
      setVal(field('Derslik').querySelector('input'), 'C201')
      ;[...document.querySelectorAll('.slot-dialog .chip')].find((b) => b.textContent.includes('2. sınıf')).click()
      return true
    })()`)
    await sleep(200)
    await js(`document.querySelector('.slot-dialog button[type=submit]').click()`)
    await sleep(600)
    const tt = await js<View & Tt>(`window.api.library.get()`)
    const lvl2 = tt.timetable.levels.find((l) => l.name === '2. sınıf')
    const slot0 = tt.timetable.slots[0]
    check(
      'programa ders yerleşti (Pzt 3.–4. saat, C201, 2. sınıf)',
      tt.timetable.slots.length === 1 && slot0.day === 1 && slot0.from === 2 && slot0.to === 3 && slot0.room === 'C201' &&
        (tt.courses[0] as { levelId?: string }).levelId === lvl2?.id,
      { slots: tt.timetable.slots, levelId: (tt.courses[0] as { levelId?: string }).levelId, lvl2 }
    )
    const slotColor = await js<string>(`getComputedStyle(document.querySelector('.tt-slot')).getPropertyValue('--c').trim()`)
    check('programdaki ders sınıfının renginde', slotColor === lvl2?.color, { slotColor, level: lvl2?.color })
    await shot('t1-ders-programi', 'presenter')
    // Program ayarları: "Ön lisans" şablonu 4 sınıfı 2'ye indirir, dersin 2. sınıf bağı (kimliği) korunur
    await clickButton('Program ayarları')
    await sleep(300)
    await clickButton('Ön lisans (2 yıl)')
    await sleep(500)
    const tt2 = await js<View & Tt>(`window.api.library.get()`)
    check(
      'sınıf şablonu uygulandı, dersin sınıfı korundu',
      tt2.timetable.levels.map((l) => l.name).join('|') === '1. sınıf|2. sınıf' && (tt2.courses[0] as { levelId?: string }).levelId === lvl2?.id,
      tt2.timetable.levels
    )
    await shot('t1b-program-ayarlari', 'presenter')

    // Bugün: saati Pazartesi 11:00'e sabitle → ders "Şu an", sıradaki sunu Hafta 2; sol menüde Pazartesi · bugün
    const setNow = (expr: string): Promise<unknown> => js(`window.__sunuNow = ${expr}; window.dispatchEvent(new Event('sunu:now')); true`)
    await setNow('new Date(2026, 9, 12, 11, 0).getTime()')
    await clickButton('Ana sayfa')
    await sleep(400)
    const today = await js<{ card?: string; file?: string; side?: string; sub?: string }>(`({
      card: document.querySelector('.today-card--now .today-card__course')?.textContent,
      file: document.querySelector('.today-card--now .today-card__file')?.textContent,
      side: document.querySelector('.lib-side__title--today')?.textContent,
      sub: document.querySelector('.lib-nav__name small')?.textContent
    })`)
    check(
      'Bugün: ders "Şu an", sıradaki sunu Hafta 2; menüde Pazartesi · bugün',
      today.card === 'Test Dersi' && !!today.file?.includes('Hafta 2') && today.side === 'Pazartesi · bugün' && today.sub === '10:30 · C201',
      today
    )
    check(
      'ana sayfada yalnızca günün dersleri (devam kartı ve son açılanlar yok)',
      await js<boolean>(
        `!!document.querySelector('.today') && !document.querySelector('.lib-home .file-list') && !/Kaldığın yerden devam|Son açılanlar/i.test(document.querySelector('.lib-home').innerText)`
      )
    )
    await shot('t2-bugun', 'presenter')

    // Prova: Bugün kartından provaya aç, son slayta git → kaldığın yer ve sunuldu işareti değişmemeli
    const hafta2 = async (): Promise<View['courses'][number]['items'][number] | undefined> =>
      (await js<View>(`window.api.library.get()`)).courses[0].items.find((i) => i.name === 'Hafta 2.pptx')
    const h2Before = await hafta2()
    await js(`[...document.querySelectorAll('.today-card--now button')].find((b) => b.textContent === 'Prova').click()`)
    await waitFor(() => show.presentation?.name === 'Hafta 2.pptx', 15000)
    await sleep(800)
    check(
      'Prova → sunucu ekranında PROVA rozeti, devam önerisi yok',
      show.presentation?.rehearsal === true &&
        (await js<boolean>(`!!document.querySelector('.chip--rehearsal') && !document.body.innerText.includes('üzerinde kalmıştın')`))
    )
    main.focus()
    press(main, 'F5')
    await waitFor(() => show.state.running, 10000)
    await sleep(800)
    const last = show.presentation?.lastVisible
    press(main, 'End')
    await waitFor(() => show.state.slide === last, 5000)
    await sleep(400)
    const rehearsalSlide = show.state.slide
    await shot('t3-prova', 'presenter')
    await show.stop()
    await sleep(400)
    await js(`document.querySelector('button[title="Sunuyu kapat"]')?.click()`)
    await waitFor(() => !show.presentation, 5000)
    await sleep(600)
    const h2After = await hafta2()
    check(
      'provada son slayta gelindi ama sunuldu / kaldığın yer değişmedi',
      rehearsalSlide === last && h2After?.presentedAt == null && JSON.stringify(h2After?.session) === JSON.stringify(h2Before?.session),
      { rehearsalSlide, last, before: h2Before, after: h2After }
    )

    await setNow('new Date(2026, 9, 11, 15, 0).getTime()') // Pazar
    await sleep(300)
    const sunday = await js<{ empty: boolean; next?: string }>(
      `({ empty: !!document.querySelector('.today__empty'), next: document.querySelector('.today__next')?.textContent })`
    )
    check('hafta sonu: bugün ders yok, sıradaki "Yarın 10:30"', sunday.empty && !!sunday.next?.includes('Yarın 10:30'), sunday)
    await setNow('undefined')
    await clickButton('Test Dersi')
    await sleep(400)

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
    press(main, 'A')
    await sleep(800)
    check('A → ara modu (sunucuda şerit)', await js<boolean>(`!!document.querySelector('.banner--break')`))
    await sleep(600)
    await shot('h2-ara-seyirci', 'audience')
    check(
      'arada sunum sürüyor, kilit düğmesi yok',
      show.state.running &&
        !main.isKiosk() &&
        !(await js<boolean>(`[...document.querySelectorAll('.banner--break button')].some((b) => b.textContent.includes('Kilitle'))`))
    )
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
    await clickButton('Test Dersi') // ana sayfada son açılanlar yok: dersten aç
    await sleep(400)
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

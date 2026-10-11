import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  screen,
  session,
  type Display
} from 'electron'
import { createHash } from 'crypto'
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { PptError, ppt } from './pptctl'
import { physicalCenter, pickAudienceDisplay, pickPresenterDisplay } from './displays'
import { connectPorts, createOverlayWindow, fitToDisplay } from './windows'
import { loadSettings, saveSettings } from './store'
import { getSession, saveSession, setPresented } from './sessions'
import { log } from './log'
import {
  ShowScreen,
  type AudienceConfig,
  type DisplayInfo,
  type PresentationInfo,
  type Result,
  type ShowMode,
  type ShowState
} from '../shared/types'

/** Önbellek biçimi değişince artır → eski önbellekler yeniden üretilir */
const CACHE_VERSION = 2
/** Önizleme görsellerinin genişliği (px). Yükseklik slayt oranından hesaplanır. */
const PREVIEW_WIDTH = 1920
const THUMB_WIDTH = 384
const POLL_MS = 500

const PPT_EXT = /\.(pptx|pptm|ppsx|ppsm|potx|potm|ppt|pps|pot)$/i
const OOXML_EXT = /\.(pptx|pptm|ppsx|ppsm|potx|potm)$/i

export function cacheRoot(): string {
  return join(app.getPath('userData'), 'cache')
}

const pad3 = (n: number): string => String(n).padStart(3, '0')

/** Kullanıcıya doğrudan gösterilecek hata */
export class UserError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export function friendlyError(err: unknown): { code: string; message: string } {
  if (err instanceof UserError) return { code: err.code, message: err.message }
  if (err instanceof PptError) {
    switch (err.code) {
      case 'POWERPOINT_MISSING':
        return {
          code: err.code,
          message: 'PowerPoint bulunamadı. Sunu Pro gösterileri bilgisayarınızda kurulu Microsoft PowerPoint ile oynatır.'
        }
      case 'NOT_FOUND':
        return { code: err.code, message: err.message }
      case 'TIMEOUT':
        return {
          code: err.code,
          message: "PowerPoint yanıt vermedi. PowerPoint'te açık bir uyarı penceresi olabilir; kapatıp tekrar deneyin."
        }
      case 'PPTCTL_EXIT':
        return { code: err.code, message: 'PowerPoint bağlantısı koptu. Lütfen tekrar deneyin.' }
      default:
        return { code: err.code, message: `PowerPoint işlemi tamamlayamadı: ${err.message}` }
    }
  }
  return { code: 'UNKNOWN', message: String((err as Error)?.message ?? err) }
}

async function toResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    log('[hata]', err)
    return { ok: false, ...friendlyError(err) }
  }
}

/** PowerPoint'e vermeden önce: var mı, uzantı doğru mu, parola korumalı/bozuk mu (PowerPoint bu durumlarda iletişim kutusu açıp takılabilir) */
function preflight(path: string): void {
  if (!existsSync(path)) throw new UserError('NOT_FOUND', `Dosya bulunamadı: ${path}`)
  if (!PPT_EXT.test(path)) throw new UserError('BAD_TYPE', 'Bu bir PowerPoint dosyası değil (.pptx, .ppt, .ppsx…).')
  if (OOXML_EXT.test(path)) {
    const buf = Buffer.alloc(4)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buf, 0, 4, 0)
    } finally {
      closeSync(fd)
    }
    const sig = buf.toString('hex')
    // Parola korumalı OOXML dosyaları ZIP değil, şifreli OLE kapsayıcısıdır
    if (sig === 'd0cf11e0')
      throw new UserError(
        'PASSWORD',
        "Bu sunu parola korumalı. PowerPoint'te parolayı kaldırıp (Dosya → Bilgi → Sunuyu Koru) tekrar deneyin."
      )
    if (sig !== '504b0304') throw new UserError('CORRUPT', 'Dosya bozuk ya da geçerli bir PowerPoint dosyası değil.')
  }
}

/** Dosya içeriği değişmedikçe aynı kalan önbellek anahtarı (yol + boyut + değiştirilme zamanı). */
function cacheKeyFor(path: string): string {
  const st = statSync(path)
  return createHash('sha1').update(`${path.toLowerCase()}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16)
}

type OpenResult = Omit<PresentationInfo, 'name' | 'cacheKey' | 'session' | 'rehearsal'>

/** Dosyanın slayt görselleri güncel biçimde önbellekte mi (sunu açılmadan, dosya bilgisinden) */
export function isPrepared(path: string): boolean {
  try {
    const manifest = join(cacheRoot(), cacheKeyFor(path), 'manifest.json')
    return JSON.parse(readFileSync(manifest, 'utf-8')).v === CACHE_VERSION
  } catch {
    return false
  }
}

/**
 * Sunum oturumu: PowerPoint gösterisi (canlı mod) ya da önizleme görselleri (görsel mod) +
 * seyirci ekranındaki katman penceresi. Durum ana pencereye ve katmana 'show:state' ile yayınlanır.
 */
class ShowController {
  presentation: PresentationInfo | null = null
  overlay: BrowserWindow | null = null
  audience: Display | null = null
  mode: ShowMode = 'live'
  windowed = false
  detached = false
  state: ShowState = { running: false }
  mirrorSource: 'window' | 'screen' | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private sleepBlocker: number | null = null
  /** Görsel modda gösteri durumunu biz tutarız */
  private img = { slide: 1, screen: ShowScreen.Running as ShowScreen }
  /** Arka plan hazırlama kuyruğu, PowerPoint'i kullanmadan önce durdurulur / sunu kapanınca sürer */
  hooks: { beforeOpen: () => Promise<void>; afterClose: () => void } = {
    beforeOpen: async () => undefined,
    afterClose: () => undefined
  }

  constructor(private getMain: () => BrowserWindow | null) {}

  private broadcast(channel: string, payload?: unknown): void {
    this.getMain()?.webContents.send(channel, payload)
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.webContents.send(channel, payload)
  }

  private setState(st: ShowState, force = false): ShowState {
    const prev = this.state
    const next: ShowState = st.running
      ? { ...st, mode: this.mode, windowed: this.windowed, detached: this.detached }
      : { running: false }
    this.state = next
    const keys: (keyof ShowState)[] = ['running', 'slide', 'click', 'clickCount', 'state', 'detached', 'atEnd']
    if (force || keys.some((k) => prev[k] !== next[k])) this.broadcast('show:state', next)
    // Kaldığın yerden devam: her konum değişimi kaydedilir (ara verip kapatınca kaybolmasın).
    // Provada (evde çalışırken) ne kaldığın yer ne de sunuldu işareti değişir.
    if (next.running && next.slide && this.presentation && !this.presentation.rehearsal) {
      saveSession(this.presentation.path, {
        slide: next.slide,
        click: next.click ?? 0,
        slideCount: this.presentation.slideCount
      })
      // Son görünür slayta gelindiyse sunu kütüphanede "sunuldu" olarak işaretlenir
      if (next.slide >= this.presentation.lastVisible) setPresented([this.presentation.path], true)
    }
    return next
  }

  // ---------- Dosya hazırlama ----------

  async open(path: string, opts: { rehearsal?: boolean } = {}): Promise<PresentationInfo> {
    preflight(path)
    if (this.state.running) await this.stop()
    await this.hooks.beforeOpen()
    const info = await ppt.call<OpenResult>('open', { path }, 120_000)
    const cacheKey = cacheKeyFor(path)
    await this.ensureCache(cacheKey, info)
    this.presentation = {
      ...info,
      slides: info.slides ?? [],
      name: basename(path),
      cacheKey,
      openedCopy: !!info.openedCopy,
      session: getSession(path),
      rehearsal: !!opts.rehearsal
    }
    return this.presentation
  }

  /** Sunucu ekranı kapandı: sunuyu PowerPoint'ten bırak, arka plan hazırlığı sürsün. */
  async close(): Promise<void> {
    if (this.state.running) await this.stop()
    this.presentation = null
    await ppt.call('close').catch(() => undefined)
    this.hooks.afterClose()
  }

  /**
   * Arka planda ön hazırlık: slayt görsellerini üretip sunuyu kapatır. Yalnızca sunucu ekranında
   * açık bir sunu yokken çağrılmalı (PowerPoint denetleyicisi tek sunu tutar).
   */
  async prepare(path: string): Promise<void> {
    if (this.presentation) throw new UserError('BUSY', 'Açık bir sunu var.')
    preflight(path)
    if (isPrepared(path)) return
    try {
      const info = await ppt.call<OpenResult>('open', { path }, 120_000)
      await this.ensureCache(cacheKeyFor(path), info)
    } finally {
      await ppt.call('close').catch(() => undefined)
    }
  }

  /** Slayt görselleri + küçük resimler önbellekte yoksa (veya biçim eskiyse) üretir. */
  private async ensureCache(key: string, info: OpenResult): Promise<void> {
    const dir = join(cacheRoot(), key)
    const manifestPath = join(dir, 'manifest.json')
    try {
      if (JSON.parse(readFileSync(manifestPath, 'utf-8')).v === CACHE_VERSION) return
    } catch {
      /* yok ya da okunamadı → üret */
    }
    // PowerPoint bazı kullanıcı klasörlerine (ör. AppData\Roaming) yazamıyor; geçici klasöre
    // dışa aktarıp önbelleğe taşı
    const tmp = mkdtempSync(join(tmpdir(), 'sunupro-'))
    try {
      const height = Math.round((PREVIEW_WIDTH * info.heightPt) / info.widthPt)
      await ppt.call('export', { dir: tmp, width: PREVIEW_WIDTH, height }, 10 * 60_000)
      for (let i = 1; i <= info.slideCount; i++) {
        const img = nativeImage.createFromPath(join(tmp, `slide-${pad3(i)}.png`))
        if (!img.isEmpty())
          writeFileSync(join(tmp, `thumb-${pad3(i)}.png`), img.resize({ width: THUMB_WIDTH, quality: 'good' }).toPNG())
      }
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(cacheRoot(), { recursive: true })
      cpSync(tmp, dir, { recursive: true })
      writeFileSync(manifestPath, JSON.stringify({ v: CACHE_VERSION, ...info, exportedAt: Date.now() }, null, 2), 'utf-8')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---------- Ekranlar ----------

  displays(): { audience: Display; presenter: Display; single: boolean } {
    const audience = pickAudienceDisplay(loadSettings().audienceDisplayId)
    const presenter = pickPresenterDisplay(audience)
    return { audience, presenter, single: audience.id === presenter.id }
  }

  listDisplays(): DisplayInfo[] {
    const primary = screen.getPrimaryDisplay()
    const { audience, single } = this.displays()
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: d.label || `Ekran ${i + 1}`,
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      scaleFactor: d.scaleFactor,
      primary: d.id === primary.id,
      audience: !single && d.id === audience.id
    }))
  }

  /** Seyirci ve sunucu ekranlarını yer değiştirir. */
  async swapDisplays(): Promise<void> {
    const { presenter, single } = this.displays()
    if (single) return
    saveSettings({ audienceDisplayId: presenter.id })
    await this.applyDisplays()
  }

  /** Ana pencereyi sunucu ekranına taşır (zaten oradaysa dokunmaz). */
  placeMainWindow(presenter: Display): void {
    const main = this.getMain()
    if (!main) return
    if (screen.getDisplayMatching(main.getBounds()).id === presenter.id) return
    main.unmaximize()
    main.setBounds(presenter.workArea)
    main.maximize()
  }

  /** Ekran ayarı değiştiğinde veya ekran takılıp çıkarıldığında her şeyi yeniden yerleştirir. */
  async applyDisplays(): Promise<void> {
    this.getMain()?.webContents.send('displays:changed', this.listDisplays())
    const { audience, presenter, single } = this.displays()
    this.placeMainWindow(presenter)
    if (!this.state.running || this.windowed) return

    if (single) {
      // Seyirci ekranı ayrıldı: gösteri birincil ekranı kaplamasın, geri takılınca devam
      this.detached = true
      this.overlay?.hide()
      if (this.mode === 'live') await ppt.call('hide').catch(() => undefined)
    } else {
      this.detached = false
      this.audience = audience
      if (this.mode === 'live') await ppt.call('place', physicalCenter(audience)).catch(() => undefined)
      this.showOverlay()
    }
    this.getMain()?.focus()
    this.setState(this.state, true)
  }

  // ---------- Gösteri ----------

  private visibleSlides(): number[] {
    return (this.presentation?.slides ?? []).filter((s) => !s.hidden).map((s) => s.index)
  }

  private imageState(atEnd = false): ShowState {
    return {
      running: true,
      slide: this.img.slide,
      click: 0,
      clickCount: 0,
      state: this.img.screen,
      slideCount: this.presentation?.slideCount ?? 0,
      atEnd
    }
  }

  /** mode verilirse bu gösteri için ayardaki sunum modunun yerine geçer (ör. canlı mod açılamadıysa görsel). */
  async start(opts: { slide?: number; click?: number; mode?: ShowMode }): Promise<ShowState> {
    const main = this.getMain()
    const pres = this.presentation
    if (!pres || !main) throw new UserError('NO_PRES', 'Önce bir sunu açın.')
    if (this.state.running) await this.stop()

    const { audience, presenter, single } = this.displays()
    this.audience = audience
    this.detached = false
    // Tek ekranda PowerPoint gösterisi sunucu ekranını kaplar → seyirci görünümü pencerede (test modu)
    this.windowed = single
    this.mode = single ? 'image' : (opts.mode ?? loadSettings().showMode)
    const slide = Math.min(Math.max(1, opts.slide ?? 1), pres.slideCount)
    this.placeMainWindow(presenter)

    await this.createOverlay(audience)
    let st: ShowState
    if (this.mode === 'live') {
      try {
        st = await ppt.call<ShowState>('start', { ...physicalCenter(audience), slide, click: opts.click ?? 0 })
      } catch (err) {
        this.cleanupShow()
        throw err
      }
      this.startPolling()
    } else {
      const visible = this.visibleSlides()
      this.img = { slide: visible.find((n) => n >= slide) ?? visible[visible.length - 1] ?? slide, screen: ShowScreen.Running }
      st = this.imageState()
    }
    this.showOverlay()
    // Gösteri (ve aralar) boyunca ekran kararmasın / bilgisayar uyumasın
    if (this.sleepBlocker == null) this.sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
    // Klavye/tıklayıcı odağı sunucu penceresinde kalmalı
    main.focus()
    return this.setState(st, true)
  }

  async command(cmd: 'next' | 'prev' | 'goto' | 'screen' | 'state', args: Record<string, unknown> = {}): Promise<ShowState> {
    if (!this.state.running) return this.state
    if (this.mode === 'image') return this.setState(this.imageCommand(cmd, args))
    try {
      const st = await ppt.call<ShowState>(cmd, args)
      if (!st.running) {
        this.cleanupShow()
        return this.setState({ running: false })
      }
      return this.setState(st)
    } catch (err) {
      console.error('[show] komut başarısız:', cmd, err)
      return this.state
    }
  }

  private imageCommand(cmd: string, args: Record<string, unknown>): ShowState {
    const visible = this.visibleSlides()
    const cur = this.img.slide
    switch (cmd) {
      case 'next': {
        const n = visible.find((i) => i > cur)
        if (n == null) return this.imageState(true)
        this.img.slide = n
        break
      }
      case 'prev': {
        const p = [...visible].reverse().find((i) => i < cur)
        if (p != null) this.img.slide = p
        break
      }
      case 'goto': {
        const n = Number(args.slide)
        if (n >= 1 && n <= (this.presentation?.slideCount ?? 0)) this.img.slide = n
        break
      }
      case 'screen': {
        const map: Record<string, ShowScreen> = { normal: ShowScreen.Running, black: ShowScreen.Black, white: ShowScreen.White }
        this.img.screen = map[String(args.mode)] ?? ShowScreen.Running
        break
      }
    }
    // Gezinme siyah/beyaz ekranı kapatır (PowerPoint'teki gibi)
    if (cmd !== 'screen' && cmd !== 'state') this.img.screen = ShowScreen.Running
    return this.imageState()
  }

  async stop(): Promise<ShowState> {
    if (this.state.running && this.mode === 'live') {
      try {
        await ppt.call('stop')
      } catch {
        /* gösteri zaten kapanmış olabilir */
      }
    }
    this.cleanupShow()
    return this.setState({ running: false })
  }

  private async createOverlay(audience: Display): Promise<void> {
    const main = this.getMain()!
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy()
    const overlay = createOverlayWindow(audience, { windowed: this.windowed })
    this.overlay = overlay
    overlay.on('closed', () => {
      if (this.overlay !== overlay) return // biz kapattık (cleanupShow önce referansı bırakır)
      this.overlay = null
      // Test penceresi kullanıcı tarafından kapatılırsa gösteri biter
      if (this.state.running) this.stop()
    })
    await new Promise<void>((r) => overlay.webContents.once('did-finish-load', () => r()))
    const pres = this.presentation!
    const config: AudienceConfig = {
      mode: this.mode,
      windowed: this.windowed,
      aspect: pres.widthPt / pres.heightPt,
      cacheKey: pres.cacheKey
    }
    overlay.webContents.send('audience:config', config)
    connectPorts(main, overlay)
  }

  private showOverlay(): void {
    const overlay = this.overlay
    if (!overlay || overlay.isDestroyed() || !this.audience) return
    if (this.windowed) {
      overlay.show()
      return
    }
    overlay.showInactive()
    fitToDisplay(overlay, this.audience)
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.moveTop()
  }

  private cleanupShow(): void {
    this.stopPolling()
    if (this.sleepBlocker != null) powerSaveBlocker.stop(this.sleepBlocker)
    this.sleepBlocker = null
    const overlay = this.overlay
    this.overlay = null
    if (overlay && !overlay.isDestroyed()) overlay.destroy()
    this.mirrorSource = null
    this.detached = false
  }

  // Zamanlamalı geçişler / otomatik animasyonlar komut olmadan da konumu değiştirebilir
  private startPolling(): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => {
      ppt
        .call<ShowState>('state')
        .then((st) => {
          if (!st.running) {
            this.cleanupShow()
            this.setState({ running: false })
          } else this.setState(st)
        })
        .catch(() => {
          /* geçici hata — sonraki turda tekrar */
        })
    }, POLL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  /**
   * Sunucu ekranındaki canlı yansıma için kaynak: önce PowerPoint gösteri penceresi;
   * bulunamazsa seyirci ekranının tamamı (katman yakalamadan hariç tutulur).
   */
  async resolveMirrorSource(): Promise<Electron.DesktopCapturerSource | null> {
    const hwnd = this.state.hwnd
    if (hwnd) {
      const windows = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
      const src = windows.find((s) => s.id.startsWith(`window:${hwnd}:`))
      if (src) {
        this.mirrorSource = 'window'
        return src
      }
    }
    if (this.audience) {
      const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      const src = screens.find((s) => s.display_id === String(this.audience!.id))
      if (src) {
        this.overlay?.setContentProtection(true)
        this.mirrorSource = 'screen'
        return src
      }
    }
    return null
  }
}

export let show: ShowController

export function registerShow(getMain: () => BrowserWindow | null): void {
  show = new ShowController(getMain)

  ppt.on('event', (name: string, data: unknown) => {
    if (name === 'export-progress') getMain()?.webContents.send('show:export-progress', data)
  })

  // Ekran takılıp çıkarılınca olaylar art arda gelir → kısa gecikmeyle bir kez uygula
  let displayTimer: NodeJS.Timeout | null = null
  const onDisplays = (): void => {
    if (displayTimer) clearTimeout(displayTimer)
    displayTimer = setTimeout(() => show.applyDisplays(), 400)
  }
  screen.on('display-added', onDisplays)
  screen.on('display-removed', onDisplays)
  screen.on('display-metrics-changed', onDisplays)

  // Canlı yansıma: renderer getDisplayMedia çağırınca kaynağı biz seçeriz (seçim penceresi yok)
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    show
      .resolveMirrorSource()
      .then((src) => callback(src ? { video: src } : {}))
      .catch(() => callback({}))
  })

  ipcMain.handle('show:pick-file', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Sunu seç',
      properties: ['openFile'],
      filters: [{ name: 'PowerPoint', extensions: ['pptx', 'ppt', 'pptm', 'ppsx', 'pps', 'ppsm'] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('show:open', (_e, path: string, opts?: { rehearsal?: boolean }) => toResult(() => show.open(path, opts)))
  ipcMain.handle('show:start', (_e, opts) => toResult(() => show.start(opts ?? {})))
  ipcMain.handle('show:cmd', (_e, cmd, args) => show.command(cmd, args))
  ipcMain.handle('show:stop', () => show.stop())
  ipcMain.handle('show:close', () => show.close())
  ipcMain.handle('show:get-state', () => show.state)
  ipcMain.handle('displays:list', () => show.listDisplays())
  ipcMain.handle('displays:swap', async () => {
    await show.swapDisplays()
    return show.listDisplays()
  })
}

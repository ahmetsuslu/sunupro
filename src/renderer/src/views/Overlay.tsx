import React, { useEffect, useRef, useState } from 'react'
import { ShowScreen, type AudienceConfig, type InkMap, type ShowState, type ZoomViewState } from '@shared/types'
import { containRect, type Rect } from '../lib/geometry'
import { onOverlayMessage } from '../lib/overlay-port'
import { InkRenderer } from '../lib/ink-render'
import { LaserRenderer } from '../lib/laser-render'
import { formatCountdown } from '../lib/time'
import { slideUrl } from '../lib/slides'
import { IDENTITY, isZoomed, zoomRect } from '../lib/zoom'

/**
 * Seyirci ekranındaki yakınlaştırma görünümü. Sunucudan gelen görünüm canlı modda ancak gösterinin
 * yakalaması hazır olunca uygulanır (yoksa çizimler büyür ama slayt büyümez); görsel modda hemen.
 * Saniyede onlarca güncelleme olabildiği için React durumu yerine aboneliklerle dağıtılır.
 */
class ViewHub {
  requested: ZoomViewState = IDENTITY
  mirrorReady = false
  needsMirror = false
  private listeners = new Set<(v: ZoomViewState) => void>()

  effective(): ZoomViewState {
    return this.needsMirror && !this.mirrorReady ? IDENTITY : this.requested
  }
  subscribe(cb: (v: ZoomViewState) => void): () => void {
    this.listeners.add(cb)
    cb(this.effective())
    return () => this.listeners.delete(cb)
  }
  emit(): void {
    const v = this.effective()
    for (const cb of this.listeners) cb(v)
  }
}

/** Pencerede slaytın kapladığı (letterbox'lı) dikdörtgen */
function useSlideRect(aspect: number): Rect {
  const calc = (): Rect => containRect(window.innerWidth, window.innerHeight, aspect)
  const [rect, setRect] = useState(calc)
  useEffect(() => {
    const onResize = (): void => setRect(calc())
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [aspect])
  return rect
}

/**
 * Seyirci ekranı penceresi.
 * - Canlı mod: şeffaf; PowerPoint gösterisinin üstünde yalnızca lazer/çizimler görünür. Yakınlaştırmada
 *   gösteri penceresinin canlı yakalaması büyütülerek gösterilir (animasyon durumu korunur).
 * - Görsel mod: slayt görselini kendisi gösterir (siyah/beyaz ekran dahil).
 * Slayt, PowerPoint gibi ekrana ortalanarak sığdırılır; işaretçi koordinatları slayta göre 0..1 gelir.
 */
export default function Overlay(): React.JSX.Element {
  const [config, setConfig] = useState<AudienceConfig | null>(null)
  const [state, setState] = useState<ShowState>({ running: false })
  const [hub] = useState(() => new ViewHub())

  useEffect(() => window.api.audience.onConfig(setConfig), [])
  useEffect(() => {
    window.api.show.getState().then(setState)
    return window.api.show.onState(setState)
  }, [])
  useEffect(
    () =>
      onOverlayMessage((m) => {
        if (m.t !== 'view') return
        hub.requested = { s: m.s, cx: m.cx, cy: m.cy }
        hub.emit()
      }),
    [hub]
  )

  const image = config?.mode === 'image'
  const liveMirror = !!config && config.mode === 'live' && !config.windowed
  useEffect(() => {
    hub.needsMirror = liveMirror
    hub.emit()
  }, [hub, liveMirror])
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('overlay-root', !image)
    root.classList.toggle('audience-root', image)
    root.classList.toggle('audience-windowed', !!config?.windowed)
  }, [image, config?.windowed])

  const slide = state.slide ?? 1
  const aspect = config?.aspect ?? 16 / 9
  const rect = useSlideRect(aspect)
  // Siyah/beyaz ekranda çizimler ve lazer de gizlenir
  const blank = state.state === ShowScreen.Black || state.state === ShowScreen.White
  return (
    <div className="audience">
      {/* Slayt çerçevesi: yakınlaştırılan içerik slaytın kendi alanında kırpılır (sunucu ekranıyla aynı) */}
      <div className="audience__frame" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
        {image && config && state.running && <ZoomedImage hub={hub} rect={rect} src={slideUrl(config.cacheKey, slide)} />}
        {liveMirror && state.running && <ZoomMirror hub={hub} rect={rect} aspect={aspect} />}
      </div>
      {image && config && state.running && (
        <>
          {/* Sonraki slaytı önceden yükle: geçiş anında beyaz kare olmasın */}
          <img className="audience__preload" src={slideUrl(config.cacheKey, Math.min(slide + 1, state.slideCount ?? slide))} alt="" />
          {state.state === ShowScreen.Black && <div className="audience__screen audience__screen--black" />}
          {state.state === ShowScreen.White && <div className="audience__screen audience__screen--white" />}
        </>
      )}
      <InkLayer aspect={aspect} slide={slide} hidden={blank} hub={hub} />
      <LaserLayer aspect={aspect} hidden={blank} hub={hub} />
      <PointerLayer aspect={aspect} hidden={blank} hub={hub} />
      <BreakScreen />
    </div>
  )
}

/** Görsel mod: slayt görseli, yakınlaştırmaya göre büyütülüp kaydırılır. */
function ZoomedImage({ hub, rect, src }: { hub: ViewHub; rect: Rect; src: string }): React.JSX.Element {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(
    () =>
      hub.subscribe((v) => {
        const el = ref.current
        if (!el) return
        const z = zoomRect({ x: 0, y: 0, width: rect.width, height: rect.height }, v)
        el.style.transform = isZoomed(v) ? `translate(${z.x}px, ${z.y}px) scale(${v.s})` : ''
      }),
    [hub, rect.width, rect.height]
  )
  return <img ref={ref} className="audience__slide" src={src} alt="" draggable={false} />
}

/**
 * Canlı mod yakınlaştırması: PowerPoint gösteri penceresinin canlı yakalaması (katman hariç) büyütülüp
 * gösterinin üstüne konur. Yakalama ilk yakınlaştırmada başlar, gösteri boyunca açık kalır.
 */
function ZoomMirror({ hub, rect, aspect }: { hub: ViewHub; rect: Rect; aspect: number }): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    const video = videoRef.current!

    const place = (v: ZoomViewState): void => {
      const fw = video.videoWidth
      const fh = video.videoHeight
      if (!isZoomed(v) || !fw) {
        video.style.opacity = '0'
        return
      }
      // Karedeki slayt bölgesi, yakınlaştırılmış slayt dikdörtgenine (çerçeveye göre) oturtulur
      const z = zoomRect({ x: 0, y: 0, width: rect.width, height: rect.height }, v)
      const s = containRect(fw, fh, aspect)
      const k = z.width / s.width
      video.style.width = `${fw}px`
      video.style.height = `${fh}px`
      video.style.transform = `translate(${z.x - s.x * k}px, ${z.y - s.y * k}px) scale(${k})`
      video.style.opacity = '1'
    }

    const start = (): void => {
      if (startedRef.current) return
      startedRef.current = true
      navigator.mediaDevices
        .getDisplayMedia({ video: { frameRate: 30 }, audio: false })
        .then((st) => {
          if (cancelled) return st.getTracks().forEach((t) => t.stop())
          stream = st
          video.srcObject = st
          video.requestVideoFrameCallback(() => {
            hub.mirrorReady = true
            hub.emit()
          })
        })
        .catch((err) => {
          startedRef.current = false
          console.warn('Yakınlaştırma için gösteri yakalanamadı:', err)
        })
    }

    // Yakınlaştırma bitince yakalama birkaç saniye sonra kapatılır (gereksiz yük olmasın); bir sonraki
    // yakınlaştırmada yeniden başlar (yaklaşık 0,5 sn sonra projeksiyona yansır)
    let idleTimer: number | undefined
    const stop = (): void => {
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      video.srcObject = null
      startedRef.current = false
      if (hub.mirrorReady) {
        hub.mirrorReady = false
        hub.emit()
      }
    }

    const offView = hub.subscribe(place)
    // Yakalamayı istenen görünüme göre başlat (etkin görünüm yakalama hazır olana dek 1'de kalır)
    const offReq = (() => {
      const check = (): void => {
        if (isZoomed(hub.requested)) {
          window.clearTimeout(idleTimer)
          idleTimer = undefined
          start()
        } else if (startedRef.current && idleTimer === undefined) {
          idleTimer = window.setTimeout(() => {
            idleTimer = undefined
            if (!isZoomed(hub.requested)) stop()
          }, 4000)
        }
      }
      check()
      return onOverlayMessage((m) => m.t === 'view' && check())
    })()
    return () => {
      cancelled = true
      window.clearTimeout(idleTimer)
      offView()
      offReq()
      stop()
    }
  }, [hub, rect.width, rect.height, aspect])

  return <video ref={videoRef} className="audience__mirror" autoPlay muted style={{ opacity: 0 }} />
}

/** Ara modu: gösterinin üstünü kaplayan geri sayım ekranı. */
function BreakScreen(): React.JSX.Element | null {
  const [until, setUntil] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(
    () =>
      onOverlayMessage((m) => {
        if (m.t === 'break') setUntil(m.until)
      }),
    []
  )
  useEffect(() => {
    if (!until) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [until])

  if (!until) return null
  const left = until - now
  return (
    <div className="break-screen">
      <div className="break-screen__title">{left > 0 ? 'Ara' : 'Ara bitti'}</div>
      <div className="break-screen__count">{left > 0 ? formatCountdown(left) : 'Derse dönüyoruz'}</div>
      {left > 0 && (
        <div className="break-screen__back">
          Derse dönüş: {new Date(until).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  )
}

/** Lazer: parıltılı nokta + solan iz (sunucu ekranıyla aynı çizici). */
function LaserLayer({ aspect, hidden, hub }: { aspect: number; hidden: boolean; hub: ViewHub }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<LaserRenderer | null>(null)

  useEffect(() => {
    const r = new LaserRenderer(canvasRef.current!, aspect)
    rendererRef.current = r
    r.resize()
    const onResize = (): void => r.resize()
    window.addEventListener('resize', onResize)
    const offMsg = onOverlayMessage((m) => {
      if (m.t === 'laser') r.move({ x: m.x, y: m.y }, m.color, m.size)
      else if (m.t === 'laser-off') r.move(null)
    })
    const offView = hub.subscribe((v) => r.setView(v))
    return () => {
      offMsg()
      offView()
      window.removeEventListener('resize', onResize)
      r.dispose()
      rendererRef.current = null
    }
  }, [hub])

  useEffect(() => rendererRef.current?.setAspect(aspect), [aspect])

  return <canvas ref={canvasRef} className="overlay-canvas" style={{ visibility: hidden ? 'hidden' : 'visible' }} />
}

/** Fare durunca ok bu süre sonra kaybolur (PowerPoint gibi) */
const POINTER_IDLE_MS = 3000

/**
 * Sunucudaki fare imleci (araç seçili değilken): seyirci ekranında ok. Konum slayta göre gelir,
 * yakınlaştırma görünümüne göre yerleşir; ok boyutu ekrana göre sabittir. React durumu kullanılmaz.
 */
function PointerLayer({ aspect, hidden, hub }: { aspect: number; hidden: boolean; hub: ViewHub }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const aspectRef = useRef(aspect)
  aspectRef.current = aspect

  useEffect(() => {
    const el = ref.current!
    let pos: { x: number; y: number } | null = null
    let view = hub.effective()
    let idle: number | undefined
    const place = (): void => {
      if (!pos) {
        el.style.opacity = '0'
        return
      }
      const base = containRect(window.innerWidth, window.innerHeight, aspectRef.current)
      const r = zoomRect(base, view)
      const x = r.x + pos.x * r.width
      const y = r.y + pos.y * r.height
      // Slaytın dışına (yakınlaştırmada kırpılan bölge) taşmasın
      const inside = x >= base.x && x <= base.x + base.width && y >= base.y && y <= base.y + base.height
      // Okun ucu svg'de (1, 1) birimde (viewBox 22 birim yüksek): uç tam konuma gelsin
      const h = Math.max(22, base.height * 0.034)
      el.style.height = `${h}px`
      el.style.transform = `translate(${x - h / 22}px, ${y - h / 22}px)`
      el.style.opacity = inside ? '1' : '0'
    }
    const offMsg = onOverlayMessage((m) => {
      if (m.t === 'pointer') {
        pos = { x: m.x, y: m.y }
        window.clearTimeout(idle)
        idle = window.setTimeout(() => {
          pos = null
          place()
        }, POINTER_IDLE_MS)
      } else if (m.t === 'pointer-off') {
        pos = null
        window.clearTimeout(idle)
      } else return
      place()
    })
    const offView = hub.subscribe((v) => {
      view = v
      place()
    })
    window.addEventListener('resize', place)
    return () => {
      offMsg()
      offView()
      window.removeEventListener('resize', place)
      window.clearTimeout(idle)
    }
  }, [hub])

  return (
    <div ref={ref} className="overlay-pointer" style={{ visibility: hidden ? 'hidden' : 'visible', opacity: 0 }}>
      <svg viewBox="-1 -1 15 22" aria-hidden="true">
        <path d="M0 0 L0 17 L4.4 12.8 L7.4 19.6 L10.3 18.4 L7.4 11.8 L13 11.8 Z" />
      </svg>
    </div>
  )
}

/**
 * Kalem/vurgulayıcı çizimlerinin seyirci ekranındaki kopyası. Tüm slaytların çizimlerini tutar,
 * gösterilen slaytınkileri çizer; sunucuda çizilmekte olan çizgiyi anlık izler.
 */
function InkLayer({ aspect, slide, hidden, hub }: { aspect: number; slide: number; hidden: boolean; hub: ViewHub }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<InkRenderer | null>(null)
  const inkRef = useRef<InkMap>({})
  const slideRef = useRef(slide)
  slideRef.current = slide

  useEffect(() => {
    const r = new InkRenderer(canvasRef.current!, aspect)
    rendererRef.current = r
    r.resize()
    const onResize = (): void => r.resize()
    window.addEventListener('resize', onResize)
    r.setStrokes(inkRef.current[slideRef.current] ?? [])
    const offView = hub.subscribe((v) => r.setView(v))

    const off = onOverlayMessage((m) => {
      switch (m.t) {
        case 'ink-all':
          inkRef.current = m.ink
          r.clearLive()
          r.setStrokes(m.ink[slideRef.current] ?? [])
          break
        case 'ink-slide':
          inkRef.current = { ...inkRef.current, [m.slide]: m.strokes }
          if (m.slide === slideRef.current) r.setStrokes(m.strokes)
          else for (const s of m.strokes) r.cancelLive(s.id)
          break
        case 'live-begin':
          if (m.slide === slideRef.current) r.beginLive(m.stroke)
          break
        case 'live-pts':
          r.appendLive(m.id, m.points)
          break
        case 'live-cancel':
          r.cancelLive(m.id)
          break
      }
    })
    return () => {
      off()
      offView()
      window.removeEventListener('resize', onResize)
      r.dispose()
      rendererRef.current = null
    }
  }, [aspect, hub])

  useEffect(() => {
    rendererRef.current?.clearLive()
    rendererRef.current?.setStrokes(inkRef.current[slide] ?? [])
  }, [slide])

  useEffect(() => rendererRef.current?.setHidden(hidden), [hidden, aspect])

  return <canvas ref={canvasRef} className="overlay-canvas" />
}

import React, { useEffect, useRef, useState } from 'react'
import type { InkPoint, InkPrefs, InkStroke, OverlayMsg, PresentationInfo, ShowState, ZoomViewState } from '@shared/types'
import { containRect, type Rect } from '../lib/geometry'
import { slideUrl } from '../lib/slides'
import { ERASER_RADIUS, HL_SIZES, LASER_SIZES, PEN_SIZES, isDrawingTool, type Tool } from '../lib/tools'
import { InkRenderer, hitsStroke } from '../lib/ink-render'
import { LaserRenderer } from '../lib/laser-render'
import type { InkStore } from '../lib/ink-store'
import { MAX_ZOOM, SNAP_ZOOM, clampView, isZoomed, toSlide, zoomAt, type ZoomView } from '../lib/zoom'

type Point = { x: number; y: number }

type Props = {
  presentation: PresentationInfo
  state: ShowState
  /** Gösteri çalışmıyorken gösterilen slayt */
  slide: number
  tool: Tool
  ink: InkStore
  inkPrefs: InkPrefs
  /** Yakınlaştırma durumu (iki parmak / Ctrl+tekerlek); seyirci ekranına Presenter aktarır */
  zoom: ZoomView
  /** Siyah/beyaz ekranda çizimler gizlenir */
  hideInk: boolean
  /** Lazer konumu (slayta göre) katmana gönderilir; React durumu kullanılmaz (gecikme yaratır) */
  onLaser: (pos: Point | null) => void
  /** Çizilmekte olan çizgiyi katmana anlık iletir */
  onOverlay: (msg: OverlayMsg) => void
  onSwipe: (dir: 'next' | 'prev') => void
}

const SWIPE_MIN_PX = 60
/** Kalem ekrana değdikten sonra bu süre boyunca parmak dokunuşları yok sayılır (avuç) */
const PALM_REJECT_MS = 800

type Drawing = { pointerId: number; pointerType: string; slide: number; stroke: InkStroke }
type Erasing = { pointerId: number; pointerType: string; slide: number; group: string }
type Gesture =
  | { kind: 'pinch'; startDist: number; startMid: { u: number; w: number }; startView: ZoomViewState }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }

/**
 * Geçerli slayt (sunucu ekranı). Canlı modda PowerPoint gösterisinin canlı yansıması,
 * aksi halde önizleme görseli. Üstünde çizim katmanı; fare, parmak ve kalem girdisi slayta göre
 * normalize edilip katmana aktarılır.
 *
 * Yakınlaştırma: iki parmakla büyüt/küçült + kaydır, Ctrl+tekerlekle imlecin olduğu yere yakınlaş.
 * Yakınlaştırılmışken tek parmak (araç yokken) görüntüyü kaydırır, slayt değiştirmez; tam boyuta
 * dönünce kaydırma kapanır ve parmakla slayt değiştirme yeniden çalışır.
 */
export default function Stage(props: Props): React.JSX.Element {
  const { presentation, state, slide, tool, ink, inkPrefs, zoom, hideInk, onLaser, onOverlay, onSwipe } = props
  const aspect = presentation.widthPt / presentation.heightPt
  const areaRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inkCanvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<InkRenderer | null>(null)
  const laserCanvasRef = useRef<HTMLCanvasElement>(null)
  const laserRef = useRef<LaserRenderer | null>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const drawingRef = useRef<Drawing | null>(null)
  const erasingRef = useRef<Erasing | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  /** Aktif parmaklar (istemci koordinatı) */
  const touchesRef = useRef(new Map<number, { x: number; y: number }>())
  /** İki parmak hareketinden sonra tüm parmaklar kalkana dek tek parmak işlemi yapılmaz */
  const gestureLockRef = useRef(false)
  const lastPenRef = useRef(0)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [frame, setFrame] = useState({ w: 0, h: 0 })
  const [stream, setStream] = useState<MediaStream | null>(null)

  const shown = state.running && state.slide ? state.slide : slide

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Çizim katmanı (sahne slayt oranında olduğu için slayt tüm tuvali kaplar)
  useEffect(() => {
    const canvas = inkCanvasRef.current!
    const r = new InkRenderer(canvas, aspect)
    rendererRef.current = r
    r.setView(zoom.get())
    const ro = new ResizeObserver(() => r.resize())
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      r.dispose()
      rendererRef.current = null
    }
  }, [aspect, zoom])

  // Lazer katmanı (iz animasyonu; yakınlaştırmayla birlikte büyür)
  useEffect(() => {
    const canvas = laserCanvasRef.current!
    const r = new LaserRenderer(canvas, aspect)
    laserRef.current = r
    r.setView(zoom.get())
    r.resize()
    const ro = new ResizeObserver(() => r.resize())
    ro.observe(canvas)
    const offView = zoom.subscribe((v) => r.setView(v))
    return () => {
      ro.disconnect()
      offView()
      r.dispose()
      laserRef.current = null
    }
  }, [aspect, zoom])

  useEffect(() => {
    const r = rendererRef.current
    r?.setStrokes(ink.get(shown))
    return ink.subscribe((changed) => {
      if (changed === null || changed === shown) rendererRef.current?.setStrokes(ink.get(shown))
    })
  }, [ink, shown, aspect])

  useEffect(() => rendererRef.current?.setHidden(hideInk), [hideInk, aspect])

  // Canlı yansıma: main süreç PowerPoint gösteri penceresini kaynak olarak seçer
  const live = state.running && state.mode === 'live' && !!state.hwnd
  useEffect(() => {
    if (!live) return
    let cancelled = false
    let s: MediaStream | null = null
    navigator.mediaDevices
      .getDisplayMedia({ video: { frameRate: 30 }, audio: false })
      .then((st) => {
        if (cancelled) return st.getTracks().forEach((t) => t.stop())
        s = st
        setStream(st)
      })
      .catch((err) => console.warn('Canlı yansıma alınamadı:', err))
    return () => {
      cancelled = true
      s?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [live, state.hwnd])

  useEffect(() => {
    const v = videoRef.current
    if (v && v.srcObject !== stream) v.srcObject = stream
  }, [stream])

  const stage: Rect = containRect(area.w || 1, area.h || 1, aspect)
  // Yakalanan kare tüm ekranı içerir (letterbox dahil); slayt bölgesi sahneyi tam dolduracak şekilde ölçekle
  let videoStyle: React.CSSProperties = { display: 'none' }
  if (stream && frame.w > 0) {
    const s = containRect(frame.w, frame.h, aspect)
    const k = stage.width / s.width
    videoStyle = { left: -s.x * k, top: -s.y * k, width: frame.w * k, height: frame.h * k }
  }

  // ---------- Yakınlaştırma görünümü (React dışında, doğrudan DOM) ----------
  const applyView = (v: ZoomViewState): void => {
    const el = contentRef.current
    const st = stageRef.current
    if (el && st) {
      const W = st.clientWidth
      const H = st.clientHeight
      el.style.transform = isZoomed(v)
        ? `translate(${W / 2 - v.cx * W * v.s}px, ${H / 2 - v.cy * H * v.s}px) scale(${v.s})`
        : ''
    }
    rendererRef.current?.setView(v)
  }
  useEffect(() => {
    applyView(zoom.get())
    return zoom.subscribe(applyView)
  }, [zoom, stage.width, stage.height]) // boyut değişince dönüşüm yeniden hesaplanır

  // Slayt değişince (ya da gösteri başlayıp bitince) tam boyuta dön
  useEffect(() => zoom.reset(), [shown, state.running, zoom])

  // Ctrl+tekerlek (ve dokunmatik yüzey kıstırma): imlecin olduğu yere yakınlaş. Düz tekerlek üst
  // bileşene geçer (slayt değiştirme). Sayfa yakınlaştırmasını engellemek için pasif olmayan dinleyici.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const r = el.getBoundingClientRect()
      const v = zoom.get()
      const next = zoomAt(v, v.s * Math.exp(-e.deltaY * 0.0025), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
      if (next.s < 1.02) zoom.reset()
      else zoom.set(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom])

  // ---------- Lazer ----------
  /** u, w: sahne üzerindeki konum (0..1). Burada ve seyirci katmanında aynı iz animasyonuyla çizilir. */
  const laser = (pos: { u: number; w: number } | null): void => {
    const p = pos ? toSlide(pos.u, pos.w, zoom.get()) : null
    laserRef.current?.move(p, inkPrefs.laserColor, LASER_SIZES[inkPrefs.laserSize] ?? LASER_SIZES[1])
    onLaser(p)
  }
  useEffect(() => {
    if (tool !== 'laser') laser(null)
    if (tool !== 'eraser') ring(null)
  }, [tool]) // laser/ring her çizimde yeniden oluşur; yalnızca araç değişince çalışsın

  // ---------- Silgi göstergesi ----------
  const ring = (e: { clientX: number; clientY: number } | null): void => {
    const el = ringRef.current
    const st = stageRef.current
    if (!el || !st) return
    if (!e) {
      el.style.display = 'none'
      return
    }
    const r = st.getBoundingClientRect()
    const d = ERASER_RADIUS * r.height * 2
    el.style.display = 'block'
    el.style.width = el.style.height = `${d}px`
    el.style.left = `${e.clientX - r.left - d / 2}px`
    el.style.top = `${e.clientY - r.top - d / 2}px`
  }

  // ---------- Girdi ----------
  /** İstemci koordinatı → sahne üzerindeki konum (0..1) */
  const stagePos = (x: number, y: number): { u: number; w: number } => {
    const r = stageRef.current!.getBoundingClientRect()
    return { u: (x - r.left) / r.width, w: (y - r.top) / r.height }
  }

  /** Kalem (stylus) araç seçili olmasa da çizer; kalemin silgi ucu her zaman siler. */
  const toolFor = (e: React.PointerEvent): Tool => {
    if (e.pointerType === 'pen') {
      if (e.button === 5 || (e.buttons & 32) !== 0) return 'eraser'
      if (tool === 'none') return 'pen'
    }
    return tool
  }

  /** Olaydaki tüm örnekler (coalesced), slayt koordinatına çevrilmiş */
  const pointsOf = (e: React.PointerEvent): InkPoint[] => {
    const native = e.nativeEvent
    const list = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const v = zoom.get()
    return (list.length ? list : [native]).map((ev) => {
      const { u, w } = stagePos(ev.clientX, ev.clientY)
      const p = toSlide(u, w, v)
      const pressure = ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5
      return [p.x, p.y, pressure]
    })
  }

  const eraseAt = (er: Erasing, clientX: number, clientY: number): void => {
    const st = stageRef.current!.getBoundingClientRect()
    const rect = rendererRef.current?.slideRectCss() ?? { x: 0, y: 0, width: st.width, height: st.height }
    const radius = ERASER_RADIUS * st.height
    const ids = ink
      .get(er.slide)
      .filter((s) => hitsStroke(s, clientX - st.left, clientY - st.top, radius, rect))
      .map((s) => s.id)
    if (ids.length) ink.remove(er.slide, ids, er.group)
  }

  /** İkinci parmak değince: tek parmakla başlamış işi bırak, iki parmak hareketine geç */
  const startPinch = (): void => {
    const d = drawingRef.current
    if (d && d.pointerType === 'touch') {
      drawingRef.current = null
      rendererRef.current?.cancelLive(d.stroke.id)
      onOverlay({ t: 'live-cancel', id: d.stroke.id })
    }
    if (erasingRef.current?.pointerType === 'touch') erasingRef.current = null
    if (tool === 'laser') laser(null)
    swipeRef.current = null
    const [a, b] = [...touchesRef.current.values()]
    const mid = stagePos((a.x + b.x) / 2, (a.y + b.y) / 2)
    gestureRef.current = {
      kind: 'pinch',
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startMid: mid,
      startView: zoom.get()
    }
    gestureLockRef.current = true
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.pointerType === 'pen') lastPenRef.current = performance.now()
    else if (e.pointerType === 'touch' && performance.now() - lastPenRef.current < PALM_REJECT_MS) return
    const target = e.currentTarget as HTMLElement

    if (e.pointerType === 'touch') {
      target.setPointerCapture(e.pointerId) // parmak sahneden çıksa da hareket izlenir
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touchesRef.current.size === 2) return startPinch()
      if (touchesRef.current.size > 2 || gestureLockRef.current) return
    }
    if (drawingRef.current || erasingRef.current || gestureRef.current) return // başka bir işlem sürüyor

    const t = toolFor(e)
    const pos = stagePos(e.clientX, e.clientY)

    if (t === 'laser') {
      laser(pos)
    } else if (isDrawingTool(t)) {
      target.setPointerCapture(e.pointerId)
      const pen = t === 'pen'
      const stroke: InkStroke = {
        id: crypto.randomUUID(),
        seq: ink.seq(),
        kind: t,
        color: pen ? inkPrefs.penColor : inkPrefs.hlColor,
        size: pen ? PEN_SIZES[inkPrefs.penSize] ?? PEN_SIZES[1] : HL_SIZES[inkPrefs.hlSize] ?? HL_SIZES[1],
        simulate: e.pointerType !== 'pen',
        points: pointsOf(e)
      }
      drawingRef.current = { pointerId: e.pointerId, pointerType: e.pointerType, slide: shown, stroke }
      rendererRef.current?.beginLive(stroke)
      onOverlay({ t: 'live-begin', slide: shown, stroke })
    } else if (t === 'eraser') {
      target.setPointerCapture(e.pointerId)
      const er: Erasing = { pointerId: e.pointerId, pointerType: e.pointerType, slide: shown, group: crypto.randomUUID() }
      erasingRef.current = er
      ring(e)
      eraseAt(er, e.clientX, e.clientY)
    } else if (t === 'none') {
      if (isZoomed(zoom.get()) && e.pointerType !== 'pen') {
        // Yakınlaştırılmışken sürükleme görüntüyü kaydırır (slayt değiştirmez)
        target.setPointerCapture(e.pointerId)
        gestureRef.current = { kind: 'pan', pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
      } else if (e.pointerType !== 'mouse') {
        swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (e.pointerType === 'pen') lastPenRef.current = performance.now()
    if (e.pointerType === 'touch' && touchesRef.current.has(e.pointerId)) {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    const g = gestureRef.current
    if (g?.kind === 'pinch') {
      if (touchesRef.current.size < 2) return
      const [a, b] = [...touchesRef.current.values()]
      const mid = stagePos((a.x + b.x) / 2, (a.y + b.y) / 2)
      const s = Math.min(MAX_ZOOM, Math.max(1, (g.startView.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.startDist))
      // Başlangıçta parmakların ortasındaki slayt noktası, parmakların şimdiki ortasında kalır (büyüt + kaydır)
      const p = toSlide(g.startMid.u, g.startMid.w, g.startView)
      zoom.set(clampView({ s, cx: p.x - (mid.u - 0.5) / s, cy: p.y - (mid.w - 0.5) / s }))
      return
    }
    if (g?.kind === 'pan' && g.pointerId === e.pointerId) {
      const st = stageRef.current!
      const v = zoom.get()
      zoom.set({
        ...v,
        cx: v.cx - (e.clientX - g.lastX) / (st.clientWidth * v.s),
        cy: v.cy - (e.clientY - g.lastY) / (st.clientHeight * v.s)
      })
      g.lastX = e.clientX
      g.lastY = e.clientY
      return
    }

    const d = drawingRef.current
    if (d && d.pointerId === e.pointerId) {
      const pts = pointsOf(e)
      d.stroke.points.push(...pts)
      rendererRef.current?.appendLive(d.stroke.id, pts)
      onOverlay({ t: 'live-pts', id: d.stroke.id, points: pts })
      return
    }
    const er = erasingRef.current
    if (er && er.pointerId === e.pointerId) {
      ring(e)
      const list = e.nativeEvent.getCoalescedEvents?.() ?? []
      for (const ev of list.length ? list : [e.nativeEvent]) eraseAt(er, ev.clientX, ev.clientY)
      return
    }
    if (gestureLockRef.current) return
    const t = toolFor(e)
    if (t === 'eraser') ring(e)
    else if (t === 'laser') laser(stagePos(e.clientX, e.clientY))
  }

  const finish = (e: React.PointerEvent, cancelled: boolean): void => {
    if (e.pointerType === 'touch') touchesRef.current.delete(e.pointerId)
    const g = gestureRef.current
    if (g?.kind === 'pinch' && touchesRef.current.size < 2) {
      gestureRef.current = null
      // Neredeyse tam boyuta dönüldüyse tam boyuta otur: kaydırma kapanır, parmakla slayt değişir
      if (zoom.get().s < SNAP_ZOOM) zoom.reset()
    }
    if (touchesRef.current.size === 0) gestureLockRef.current = false
    if (g?.kind === 'pan' && g.pointerId === e.pointerId) {
      gestureRef.current = null
      return
    }

    const d = drawingRef.current
    if (d && d.pointerId === e.pointerId) {
      drawingRef.current = null
      if (cancelled) {
        rendererRef.current?.cancelLive(d.stroke.id)
        onOverlay({ t: 'live-cancel', id: d.stroke.id })
      } else ink.add(d.slide, d.stroke) // depo değişimi hem bu katmanı hem seyirci katmanını günceller
      return
    }
    const er = erasingRef.current
    if (er && er.pointerId === e.pointerId) {
      erasingRef.current = null
      if (e.pointerType !== 'mouse') ring(null)
      return
    }
    if (toolFor(e) === 'laser' && e.pointerType !== 'mouse') laser(null)
    const sw = swipeRef.current
    swipeRef.current = null
    if (cancelled || tool !== 'none' || !sw || sw.id !== e.pointerId || isZoomed(zoom.get())) return
    const dx = e.clientX - sw.x
    const dy = e.clientY - sw.y
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 'next' : 'prev')
  }

  return (
    <div className="stage-area" ref={areaRef}>
      <div
        ref={stageRef}
        className={`stage stage--tool-${tool}`}
        style={{ left: stage.x, top: stage.y, width: stage.width, height: stage.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onPointerLeave={(e) => {
          if (tool === 'laser' && e.pointerType === 'mouse') laser(null)
          if (!erasingRef.current && e.pointerType === 'mouse') ring(null)
        }}
      >
        {/* Yakınlaştırmada görüntü bu kap ile büyür; çizimler ayrı tuvalde net çizilir */}
        <div ref={contentRef} className="stage__content">
          <img className="stage__img" src={slideUrl(presentation.cacheKey, shown)} alt="" draggable={false} />
          <video
            ref={videoRef}
            className="stage__video"
            style={videoStyle}
            autoPlay
            muted
            onLoadedMetadata={(e) => setFrame({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            onResize={(e) => setFrame({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          />
        </div>
        <canvas ref={inkCanvasRef} className="stage__ink" />
        <canvas ref={laserCanvasRef} className="stage__ink stage__laser" />
        <div ref={ringRef} className="eraser-ring" style={{ display: 'none' }} />
      </div>
    </div>
  )
}

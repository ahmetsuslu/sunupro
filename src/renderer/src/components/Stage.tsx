import React, { useEffect, useRef, useState } from 'react'
import type { InkPoint, InkPrefs, InkStroke, OverlayMsg, PresentationInfo, ShowState } from '@shared/types'
import { containRect, type Rect } from '../lib/geometry'
import { slideUrl } from '../lib/slides'
import { ERASER_RADIUS, HL_SIZES, PEN_SIZES, isDrawingTool, type Tool } from '../lib/tools'
import { InkRenderer, hitsStroke } from '../lib/ink-render'
import type { InkStore } from '../lib/ink-store'

type Point = { x: number; y: number }

type Props = {
  presentation: PresentationInfo
  state: ShowState
  /** Gösteri çalışmıyorken gösterilen slayt */
  slide: number
  tool: Tool
  ink: InkStore
  inkPrefs: InkPrefs
  /** Siyah/beyaz ekranda çizimler gizlenir */
  hideInk: boolean
  /** Lazer konumu katmana gönderilir; React durumu kullanılmaz (her harekette yeniden çizim gecikme yaratır) */
  onLaser: (pos: Point | null) => void
  /** Çizilmekte olan çizgiyi katmana anlık iletir */
  onOverlay: (msg: OverlayMsg) => void
  onSwipe: (dir: 'next' | 'prev') => void
}

const SWIPE_MIN_PX = 60
/** Kalem ekrana değdikten sonra bu süre boyunca parmak dokunuşları yok sayılır (avuç) */
const PALM_REJECT_MS = 800

type Drawing = { pointerId: number; slide: number; stroke: InkStroke; rect: DOMRect }
type Erasing = { pointerId: number; slide: number; group: string }

/**
 * Geçerli slayt (sunucu ekranı). Canlı modda PowerPoint gösterisinin canlı yansıması,
 * aksi halde önizleme görseli. Üstünde çizim katmanı; fare, parmak ve kalem girdisi
 * slayta göre normalize edilip katmana aktarılır.
 */
export default function Stage(props: Props): React.JSX.Element {
  const { presentation, state, slide, tool, ink, inkPrefs, hideInk, onLaser, onOverlay, onSwipe } = props
  const aspect = presentation.widthPt / presentation.heightPt
  const areaRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inkCanvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<InkRenderer | null>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const drawingRef = useRef<Drawing | null>(null)
  const erasingRef = useRef<Erasing | null>(null)
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
    const ro = new ResizeObserver(() => r.resize())
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      r.dispose()
      rendererRef.current = null
    }
  }, [aspect])

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

  // ---------- Lazer ----------
  const laser = (pos: Point | null): void => {
    const dot = dotRef.current
    if (dot) {
      dot.style.display = pos ? 'block' : 'none'
      if (pos) {
        dot.style.left = `${pos.x * 100}%`
        dot.style.top = `${pos.y * 100}%`
      }
    }
    onLaser(pos)
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
  const norm = (rect: DOMRect, x: number, y: number): Point => ({
    x: (x - rect.left) / rect.width,
    y: (y - rect.top) / rect.height
  })

  /** Kalem (stylus) araç seçili olmasa da çizer; kalemin silgi ucu her zaman siler. */
  const toolFor = (e: React.PointerEvent): Tool => {
    if (e.pointerType === 'pen') {
      if (e.button === 5 || (e.buttons & 32) !== 0) return 'eraser'
      if (tool === 'none') return 'pen'
    }
    return tool
  }

  const pointsOf = (e: React.PointerEvent, rect: DOMRect): InkPoint[] => {
    const native = e.nativeEvent
    const list = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    return (list.length ? list : [native]).map((ev) => {
      const p = norm(rect, ev.clientX, ev.clientY)
      const pressure = ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5
      return [p.x, p.y, pressure]
    })
  }

  const eraseAt = (er: Erasing, clientX: number, clientY: number): void => {
    const st = stageRef.current!.getBoundingClientRect()
    const rect: Rect = { x: 0, y: 0, width: st.width, height: st.height }
    const px = clientX - st.left
    const py = clientY - st.top
    const radius = ERASER_RADIUS * st.height
    const ids = ink
      .get(er.slide)
      .filter((s) => hitsStroke(s, px, py, radius, rect))
      .map((s) => s.id)
    if (ids.length) ink.remove(er.slide, ids, er.group)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.pointerType === 'pen') lastPenRef.current = performance.now()
    else if (e.pointerType === 'touch' && performance.now() - lastPenRef.current < PALM_REJECT_MS) return
    if (drawingRef.current || erasingRef.current) return // başka bir parmak/kalem zaten çiziyor

    const t = toolFor(e)
    const target = e.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()

    if (t === 'laser') {
      laser(norm(rect, e.clientX, e.clientY))
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
        points: pointsOf(e, rect)
      }
      drawingRef.current = { pointerId: e.pointerId, slide: shown, stroke, rect }
      rendererRef.current?.beginLive(stroke)
      onOverlay({ t: 'live-begin', slide: shown, stroke })
    } else if (t === 'eraser') {
      target.setPointerCapture(e.pointerId)
      const er: Erasing = { pointerId: e.pointerId, slide: shown, group: crypto.randomUUID() }
      erasingRef.current = er
      ring(e)
      eraseAt(er, e.clientX, e.clientY)
    } else if (t === 'none' && e.pointerType !== 'mouse') {
      swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (e.pointerType === 'pen') lastPenRef.current = performance.now()
    const d = drawingRef.current
    if (d && d.pointerId === e.pointerId) {
      const pts = pointsOf(e, d.rect)
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
    const t = toolFor(e)
    if (t === 'eraser') ring(e)
    else if (t === 'laser') laser(norm((e.currentTarget as HTMLElement).getBoundingClientRect(), e.clientX, e.clientY))
  }

  const finish = (e: React.PointerEvent, cancelled: boolean): void => {
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
    if (cancelled || tool !== 'none' || !sw || sw.id !== e.pointerId) return
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
          if (tool === 'laser') laser(null)
          if (!erasingRef.current && e.pointerType === 'mouse') ring(null)
        }}
      >
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
        <canvas ref={inkCanvasRef} className="stage__ink" />
        <div ref={ringRef} className="eraser-ring" style={{ display: 'none' }} />
        <div ref={dotRef} className="laser-dot" style={{ display: 'none' }} />
      </div>
    </div>
  )
}

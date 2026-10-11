import React, { useEffect, useRef, useState } from 'react'
import { ShowScreen, type AudienceConfig, type InkMap, type ShowState } from '@shared/types'
import { containRect } from '../lib/geometry'
import { onOverlayMessage } from '../lib/overlay-port'
import { InkRenderer } from '../lib/ink-render'
import { formatCountdown } from '../lib/time'
import { slideUrl } from '../lib/slides'
import { fillStroke, type StrokePoint } from '../lib/stroke'

const TRAIL_MS = 600

type TrailPoint = { x: number; y: number; t: number }

/**
 * Seyirci ekranı penceresi.
 * - Canlı mod: tamamen şeffaf; PowerPoint gösterisinin üstünde yalnızca lazer/çizimler görünür.
 * - Görsel mod: slayt görselini kendisi gösterir (siyah/beyaz ekran dahil).
 * Slayt, PowerPoint gibi ekrana ortalanarak sığdırılır; işaretçi koordinatları slayta göre 0..1 gelir.
 */
export default function Overlay(): React.JSX.Element {
  const [config, setConfig] = useState<AudienceConfig | null>(null)
  const [state, setState] = useState<ShowState>({ running: false })

  useEffect(() => window.api.audience.onConfig(setConfig), [])
  useEffect(() => {
    window.api.show.getState().then(setState)
    return window.api.show.onState(setState)
  }, [])

  const image = config?.mode === 'image'
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('overlay-root', !image)
    root.classList.toggle('audience-root', image)
    root.classList.toggle('audience-windowed', !!config?.windowed)
  }, [image, config?.windowed])

  const slide = state.slide ?? 1
  const aspect = config?.aspect ?? 16 / 9
  // Siyah/beyaz ekranda çizimler ve lazer de gizlenir
  const blank = state.state === ShowScreen.Black || state.state === ShowScreen.White
  return (
    <div className="audience">
      {image && config && state.running && (
        <>
          <img className="audience__slide" src={slideUrl(config.cacheKey, slide)} alt="" draggable={false} />
          {/* Sonraki slaytı önceden yükle: geçiş anında beyaz kare olmasın */}
          <img className="audience__preload" src={slideUrl(config.cacheKey, Math.min(slide + 1, state.slideCount ?? slide))} alt="" />
          {state.state === ShowScreen.Black && <div className="audience__screen audience__screen--black" />}
          {state.state === ShowScreen.White && <div className="audience__screen audience__screen--white" />}
        </>
      )}
      <InkLayer aspect={aspect} slide={slide} hidden={blank} />
      <LaserLayer aspect={aspect} hidden={blank} />
      <BreakScreen />
    </div>
  )
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

/** Lazer: parıltılı nokta + solan iz. Yalnızca hareket varken çizer (boşta CPU harcamaz). */
function LaserLayer({ aspect, hidden }: { aspect: number; hidden: boolean }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const aspectRef = useRef(aspect)
  aspectRef.current = aspect

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let laser: { x: number; y: number } | null = null
    const trail: TrailPoint[] = []
    let raf = 0

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(window.innerWidth * dpr)
      canvas.height = Math.round(window.innerHeight * dpr)
      schedule()
    }

    const draw = (): void => {
      raf = 0
      const now = performance.now()
      const r = containRect(canvas.width, canvas.height, aspectRef.current)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift()

      const px = (p: { x: number; y: number }): [number, number] => [r.x + p.x * r.width, r.y + p.y * r.height]
      const radius = Math.max(6, r.height * 0.011)

      // İz: kuyruğa doğru incelen tek parça şekil (basınç = noktanın tazeliği), uca doğru opaklaşan dolgu
      if (trail.length > 1) {
        const pts: StrokePoint[] = trail.map((p) => [...px(p), Math.max(0, 1 - (now - p.t) / TRAIL_MS)])
        if (laser) pts.push([...px(laser), 1])
        const [hx, hy] = pts[pts.length - 1]
        let reach = 1
        for (const [x, y] of pts) reach = Math.max(reach, Math.hypot(x - hx, y - hy))
        const fade = ctx.createRadialGradient(hx, hy, 0, hx, hy, reach)
        fade.addColorStop(0, 'rgba(255, 40, 40, 0.6)')
        fade.addColorStop(1, 'rgba(255, 40, 40, 0.05)')
        ctx.fillStyle = fade
        fillStroke(ctx, pts, {
          size: radius * 1.5,
          thinning: 0.95,
          smoothing: 0.6,
          streamline: 0.35,
          simulatePressure: false,
          last: true
        })
      }

      if (laser) {
        const [x, y] = px(laser)
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3)
        glow.addColorStop(0, 'rgba(255, 60, 60, 0.9)')
        glow.addColorStop(0.35, 'rgba(255, 30, 30, 0.45)')
        glow.addColorStop(1, 'rgba(255, 0, 0, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(x, y, radius * 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ff2a2a'
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.beginPath()
        ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2)
        ctx.fill()
      }
      if (laser || trail.length) raf = requestAnimationFrame(draw)
    }
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)

    const off = onOverlayMessage((m) => {
      if (m.t === 'laser') {
        laser = { x: m.x, y: m.y }
        trail.push({ ...laser, t: performance.now() })
      } else if (m.t === 'laser-off') laser = null
      else return
      schedule()
    })

    return () => {
      off()
      window.removeEventListener('resize', resize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={canvasRef} className="overlay-canvas" style={{ visibility: hidden ? 'hidden' : 'visible' }} />
}

/**
 * Kalem/vurgulayıcı çizimlerinin seyirci ekranındaki kopyası. Tüm slaytların çizimlerini tutar,
 * gösterilen slaytınkileri çizer; sunucuda çizilmekte olan çizgiyi anlık izler.
 */
function InkLayer({ aspect, slide, hidden }: { aspect: number; slide: number; hidden: boolean }): React.JSX.Element {
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
      window.removeEventListener('resize', onResize)
      r.dispose()
      rendererRef.current = null
    }
  }, [aspect])

  useEffect(() => {
    rendererRef.current?.clearLive()
    rendererRef.current?.setStrokes(inkRef.current[slide] ?? [])
  }, [slide])

  useEffect(() => rendererRef.current?.setHidden(hidden), [hidden, aspect])

  return <canvas ref={canvasRef} className="overlay-canvas" />
}

import type { ZoomViewState } from '@shared/types'
import { containRect } from './geometry'
import { fillStroke, type StrokePoint } from './stroke'
import { withAlpha } from './tools'
import { IDENTITY, zoomRect } from './zoom'

const TRAIL_MS = 600

type Point = { x: number; y: number }
type TrailPoint = Point & { t: number }

/**
 * Lazer: parıltılı nokta + solan iz (seçilen renk ve boyutta). Konumlar slayta göre 0..1; slayt tuvale
 * ortalanarak sığdırılır, yakınlaştırma görünümü uygulanır. Sunucu ekranı ve seyirci katmanı aynı
 * çiziciyi kullanır, lazer iki ekranda aynı görünür. Yalnızca lazer ya da solan iz varken çizer.
 */
export class LaserRenderer {
  private ctx: CanvasRenderingContext2D
  private pos: Point | null = null
  private color = '#ff2a2a'
  /** Nokta yarıçapı, slayt yüksekliğine oranla */
  private size = 0.011
  private view: ZoomViewState = IDENTITY
  private trail: TrailPoint[] = []
  private raf = 0

  constructor(
    private canvas: HTMLCanvasElement,
    private aspect: number
  ) {
    this.ctx = canvas.getContext('2d')!
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width === w && this.canvas.height === h) return
    this.canvas.width = w
    this.canvas.height = h
    this.schedule()
  }

  setAspect(aspect: number): void {
    this.aspect = aspect
    this.schedule()
  }

  setView(v: ZoomViewState): void {
    this.view = v
    this.schedule()
  }

  /** Lazer konumu (slayta göre); null: lazer kalkar, iz solarak kaybolur */
  move(pos: Point | null, color?: string, size?: number): void {
    this.pos = pos
    if (pos) {
      if (color) this.color = color
      if (size) this.size = size
      this.trail.push({ ...pos, t: performance.now() })
    }
    this.schedule()
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.draw)
  }

  private draw = (): void => {
    this.raf = 0
    const { ctx, canvas, trail, pos, color } = this
    const now = performance.now()
    const base = containRect(canvas.width, canvas.height, this.aspect)
    const r = zoomRect(base, this.view)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift()

    ctx.save()
    ctx.beginPath()
    ctx.rect(base.x, base.y, base.width, base.height)
    ctx.clip()
    const px = (p: Point): [number, number] => [r.x + p.x * r.width, r.y + p.y * r.height]
    const radius = Math.max(4, r.height * this.size)

    // İz: kuyruğa doğru incelen tek parça şekil (basınç = noktanın tazeliği), uca doğru opaklaşan dolgu
    if (trail.length > 1) {
      const pts: StrokePoint[] = trail.map((p) => [...px(p), Math.max(0, 1 - (now - p.t) / TRAIL_MS)])
      if (pos) pts.push([...px(pos), 1])
      const [hx, hy] = pts[pts.length - 1]
      let reach = 1
      for (const [x, y] of pts) reach = Math.max(reach, Math.hypot(x - hx, y - hy))
      const fade = ctx.createRadialGradient(hx, hy, 0, hx, hy, reach)
      fade.addColorStop(0, withAlpha(color, 0.6))
      fade.addColorStop(1, withAlpha(color, 0.05))
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

    if (pos) {
      const [x, y] = px(pos)
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3)
      glow.addColorStop(0, withAlpha(color, 0.9))
      glow.addColorStop(0.35, withAlpha(color, 0.45))
      glow.addColorStop(1, withAlpha(color, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, radius * 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.beginPath()
      ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    if (pos || trail.length) this.schedule()
  }
}

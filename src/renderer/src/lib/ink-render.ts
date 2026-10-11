import type { StrokeOptions } from 'perfect-freehand'
import type { InkPoint, InkStroke } from '@shared/types'
import { containRect, type Rect } from './geometry'
import { fillStroke } from './stroke'
import { HIGHLIGHTER_ALPHA } from './tools'

function strokeOptions(s: InkStroke, slideHeight: number, finished: boolean): StrokeOptions {
  const size = Math.max(1, s.size * slideHeight)
  if (s.kind === 'highlighter') {
    // Sabit genişlik, düz uçlar: fosforlu kalem görünümü
    return {
      size,
      thinning: 0,
      smoothing: 0.7,
      streamline: 0.5,
      simulatePressure: false,
      start: { cap: false },
      end: { cap: false },
      last: finished
    }
  }
  return { size, thinning: 0.55, smoothing: 0.6, streamline: 0.45, simulatePressure: s.simulate, last: finished }
}

/** Bir çizgiyi verilen slayt dikdörtgenine (piksel) çizer. */
export function drawInkStroke(ctx: CanvasRenderingContext2D, s: InkStroke, r: Rect, finished = true): void {
  const pts = s.points.map(([x, y, p]): [number, number, number] => [r.x + x * r.width, r.y + y * r.height, p])
  ctx.save()
  ctx.fillStyle = s.color
  ctx.globalAlpha = s.kind === 'highlighter' ? HIGHLIGHTER_ALPHA : 1
  fillStroke(ctx, pts, strokeOptions(s, r.height, finished))
  ctx.restore()
}

/** Silgi isabeti: (px, py) noktası, yarıçap r (piksel) içinde çizgiye değiyor mu? */
export function hitsStroke(s: InkStroke, px: number, py: number, radius: number, rect: Rect): boolean {
  const reach = (s.size * rect.height) / 2 + radius
  const reach2 = reach * reach
  const pt = (p: InkPoint): [number, number] => [rect.x + p[0] * rect.width, rect.y + p[1] * rect.height]
  if (s.points.length === 1) {
    const [x, y] = pt(s.points[0])
    return (x - px) ** 2 + (y - py) ** 2 <= reach2
  }
  for (let i = 1; i < s.points.length; i++) {
    const [ax, ay] = pt(s.points[i - 1])
    const [bx, by] = pt(s.points[i])
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    const cx = ax + t * dx - px
    const cy = ay + t * dy - py
    if (cx * cx + cy * cy <= reach2) return true
  }
  return false
}

/**
 * Bir canvas'a çizim katmanı çizer: bitmiş çizgiler ekran dışı bir tuvalde önbelleğe alınır
 * (yalnızca liste değişince yeniden çizilir), çizilmekte olan çizgiler her karede üstüne eklenir.
 * Slayt, PowerPoint gibi canvas'a ortalanarak sığdırılır (aspect).
 */
export class InkRenderer {
  private ctx: CanvasRenderingContext2D
  private cache = document.createElement('canvas')
  private strokes: InkStroke[] = []
  private live = new Map<string, InkStroke>()
  private cacheDirty = true
  private raf = 0
  private hidden = false

  constructor(
    private canvas: HTMLCanvasElement,
    private aspect: number
  ) {
    this.ctx = canvas.getContext('2d')!
  }

  setAspect(aspect: number): void {
    this.aspect = aspect
    this.cacheDirty = true
    this.schedule()
  }

  /** Görüntü alanı boyutu değişti: tuvalleri cihaz pikseline göre yeniden boyutlandır */
  resize(): void {
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width === w && this.canvas.height === h) return
    this.canvas.width = this.cache.width = w
    this.canvas.height = this.cache.height = h
    this.cacheDirty = true
    this.schedule()
  }

  /** Slayt dikdörtgeni (CSS pikseli) — isabet testi için */
  slideRectCss(): Rect {
    return containRect(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1, this.aspect)
  }

  setStrokes(strokes: InkStroke[]): void {
    this.strokes = strokes
    for (const s of strokes) this.live.delete(s.id)
    this.cacheDirty = true
    this.schedule()
  }

  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return
    this.hidden = hidden
    this.schedule()
  }

  beginLive(stroke: InkStroke): void {
    this.live.set(stroke.id, { ...stroke, points: [...stroke.points] })
    this.schedule()
  }

  appendLive(id: string, points: InkPoint[]): void {
    const s = this.live.get(id)
    if (!s) return
    s.points.push(...points)
    this.schedule()
  }

  cancelLive(id: string): void {
    if (this.live.delete(id)) this.schedule()
  }

  clearLive(): void {
    this.live.clear()
    this.schedule()
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.draw())
  }

  private draw(): void {
    this.raf = 0
    const { width, height } = this.canvas
    const r = containRect(width, height, this.aspect)
    if (this.cacheDirty) {
      const c = this.cache.getContext('2d')!
      c.clearRect(0, 0, width, height)
      for (const s of this.strokes) drawInkStroke(c, s, r)
      this.cacheDirty = false
    }
    this.ctx.clearRect(0, 0, width, height)
    if (this.hidden) return
    this.ctx.drawImage(this.cache, 0, 0)
    for (const s of this.live.values()) drawInkStroke(this.ctx, s, r, false)
  }
}

import type { ZoomViewState } from '@shared/types'
import type { Rect } from './geometry'

export const MAX_ZOOM = 4
/** Bunun altına inen yakınlaştırma bırakılınca tam boyuta (1) oturur */
export const SNAP_ZOOM = 1.08

export const IDENTITY: ZoomViewState = { s: 1, cx: 0.5, cy: 0.5 }

export const isZoomed = (v: ZoomViewState): boolean => v.s > 1.001

/** Ölçeği sınırla, görünen bölgeyi slaytın içinde tut. */
export function clampView(v: ZoomViewState): ZoomViewState {
  const s = Math.min(MAX_ZOOM, Math.max(1, v.s))
  const half = 0.5 / s
  return {
    s,
    cx: Math.min(1 - half, Math.max(half, v.cx)),
    cy: Math.min(1 - half, Math.max(half, v.cy))
  }
}

/** Slaytın (s = 1 iken r dikdörtgenini kaplayan) yakınlaştırılmış hâlinin ekrandaki dikdörtgeni. */
export function zoomRect(r: Rect, v: ZoomViewState): Rect {
  return {
    x: r.x + r.width / 2 - v.cx * r.width * v.s,
    y: r.y + r.height / 2 - v.cy * r.height * v.s,
    width: r.width * v.s,
    height: r.height * v.s
  }
}

/** Sahne üzerindeki konum (0..1) → slayt koordinatı (0..1). */
export function toSlide(u: number, w: number, v: ZoomViewState): { x: number; y: number } {
  return { x: v.cx + (u - 0.5) / v.s, y: v.cy + (w - 0.5) / v.s }
}

/** Slayt koordinatı → sahne üzerindeki konum (0..1). */
export function toStage(x: number, y: number, v: ZoomViewState): { u: number; w: number } {
  return { u: 0.5 + (x - v.cx) * v.s, w: 0.5 + (y - v.cy) * v.s }
}

/**
 * (u, w) sahne noktası yerinde kalacak şekilde ölçeği değiştirir (iki parmak ortası / imleç).
 * Slayttaki aynı nokta yakınlaştırmadan sonra da parmakların / imlecin altında kalır.
 */
export function zoomAt(v: ZoomViewState, s: number, u: number, w: number): ZoomViewState {
  const p = toSlide(u, w, v)
  const ns = Math.min(MAX_ZOOM, Math.max(1, s))
  return clampView({ s: ns, cx: p.x - (u - 0.5) / ns, cy: p.y - (w - 0.5) / ns })
}

/**
 * Yakınlaştırma durumu: sunucu ekranı hareketleri buraya yazar; sahne, çizim katmanı ve seyirci
 * ekranı abone olur. Saniyede onlarca güncelleme olabildiği için React durumu yerine burada tutulur.
 */
export class ZoomView {
  private v: ZoomViewState = IDENTITY
  private listeners = new Set<(v: ZoomViewState) => void>()

  get(): ZoomViewState {
    return this.v
  }

  set(next: ZoomViewState): void {
    const c = clampView(next)
    if (c.s === this.v.s && c.cx === this.v.cx && c.cy === this.v.cy) return
    this.v = c.s <= 1.0001 ? IDENTITY : c
    for (const cb of this.listeners) cb(this.v)
  }

  reset(): void {
    this.set(IDENTITY)
  }

  subscribe(cb: (v: ZoomViewState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

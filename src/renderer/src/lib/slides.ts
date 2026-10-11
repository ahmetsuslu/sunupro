import type { PresentationInfo } from '@shared/types'

const pad3 = (n: number): string => String(n).padStart(3, '0')

export const slideUrl = (key: string, n: number): string => `sunu://cache/${key}/slide-${pad3(n)}.png`
export const thumbUrl = (key: string, n: number): string => `sunu://cache/${key}/thumb-${pad3(n)}.png`

/** Gizli olmayan slaytlar arasında gezinme yardımcıları */
export function visibleSlides(p: PresentationInfo): number[] {
  const v = p.slides.filter((s) => !s.hidden).map((s) => s.index)
  return v.length ? v : p.slides.map((s) => s.index)
}

export function nextVisible(p: PresentationInfo, from: number): number | null {
  return visibleSlides(p).find((i) => i > from) ?? null
}

export function prevVisible(p: PresentationInfo, from: number): number | null {
  return [...visibleSlides(p)].reverse().find((i) => i < from) ?? null
}

export function firstVisible(p: PresentationInfo): number {
  return visibleSlides(p)[0] ?? 1
}

export function lastVisible(p: PresentationInfo): number {
  const v = visibleSlides(p)
  return v[v.length - 1] ?? p.slideCount
}

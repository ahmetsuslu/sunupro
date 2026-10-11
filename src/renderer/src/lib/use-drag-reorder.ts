import type React from 'react'
import { useEffect, useRef, useState } from 'react'

/** Liste kenarına bu kadar yaklaşınca liste kendiliğinden kayar (px) */
const EDGE = 56
const SCROLL_STEP = 14

type Drag = { from: number; to: number; dy: number; shift: number }
type Session = {
  pointerId: number
  startY: number
  startScroll: number
  /** Satır merkezleri (kaydırılabilir içerik koordinatında) */
  centers: number[]
  scroller: HTMLElement | null
  lastY: number
  raf: number
}

/**
 * Tutamaçtan tutup sürükleyerek liste sıralama (fare, parmak, kalem). Sürüklenen satır imleci izler,
 * aradaki satırlar yer açar; bırakınca onMove(from, to) çağrılır. Liste kenarında kendiliğinden kayar.
 * Tutamaç klavyede ↑ / ↓ ile de taşır.
 */
export function useDragReorder(
  count: number,
  onMove: (from: number, to: number) => void
): {
  dragging: number | null
  handleProps: (index: number) => React.HTMLAttributes<HTMLElement>
  rowStyle: (index: number) => React.CSSProperties | undefined
} {
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const setDrag = (d: Drag | null): void => {
    dragRef.current = d
    setDragState(d)
  }
  const session = useRef<Session | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  useEffect(() => () => cancelAnimationFrame(session.current?.raf ?? 0), [])

  const update = (): void => {
    const s = session.current
    const d = dragRef.current
    if (!s || !d) return
    const scroll = s.scroller?.scrollTop ?? 0
    const dy = s.lastY - s.startY + (scroll - s.startScroll)
    const c = s.centers[d.from] + dy
    let to = d.from
    for (let j = 0; j < d.from; j++) {
      if (c < s.centers[j]) {
        to = j
        break
      }
    }
    if (to === d.from) {
      for (let j = s.centers.length - 1; j > d.from; j--) {
        if (c > s.centers[j]) {
          to = j
          break
        }
      }
    }
    setDrag({ ...d, dy, to })
  }

  // Parmak kenarda beklerken de liste kaysın
  const tick = (): void => {
    const s = session.current
    if (!s) return
    const box = s.scroller?.getBoundingClientRect()
    if (s.scroller && box) {
      const step = s.lastY < box.top + EDGE ? -SCROLL_STEP : s.lastY > box.bottom - EDGE ? SCROLL_STEP : 0
      if (step) {
        s.scroller.scrollTop += step
        update()
      }
    }
    s.raf = requestAnimationFrame(tick)
  }

  const finish = (commit: boolean): void => {
    const s = session.current
    if (!s) return
    cancelAnimationFrame(s.raf)
    session.current = null
    const d = dragRef.current
    setDrag(null)
    if (d && commit && d.to !== d.from) onMoveRef.current(d.from, d.to)
  }

  const handleProps = (index: number): React.HTMLAttributes<HTMLElement> => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>): void => {
      if (session.current || (e.pointerType === 'mouse' && e.button !== 0)) return
      e.preventDefault()
      e.stopPropagation()
      const row = e.currentTarget.closest('[data-reorder-row]')
      const list = row?.parentElement
      if (!row || !list) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const scroller = list.closest<HTMLElement>('[data-reorder-scroll]')
      const scroll = scroller?.scrollTop ?? 0
      const rows = [...list.querySelectorAll(':scope > [data-reorder-row]')].map((r) => r.getBoundingClientRect())
      const r = rows[index]
      // Komşu satıra olan adım (satır yüksekliği + boşluk): diğer satırlar bu kadar kayarak yer açar
      const next = rows[index + 1] ?? rows[index - 1]
      const shift = next ? Math.abs(next.top - r.top) : r.height
      session.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startScroll: scroll,
        centers: rows.map((x) => x.top + x.height / 2 + scroll),
        scroller,
        lastY: e.clientY,
        raf: 0
      }
      setDrag({ from: index, to: index, dy: 0, shift })
      session.current.raf = requestAnimationFrame(tick)
    },
    onPointerMove: (e: React.PointerEvent): void => {
      const s = session.current
      if (!s || s.pointerId !== e.pointerId) return
      s.lastY = e.clientY
      update()
    },
    onPointerUp: (e: React.PointerEvent): void => {
      if (session.current?.pointerId === e.pointerId) finish(true)
    },
    onPointerCancel: (): void => finish(false),
    // Sürükleme bitince satıra tıklanmış sayılmasın (sunu açılmasın)
    onClick: (e: React.MouseEvent): void => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent): void => {
      const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1
      if (to < 0 || to >= count) return
      e.preventDefault()
      e.stopPropagation()
      onMoveRef.current(index, to)
    }
  })

  /** Satırın sürükleme sırasındaki konumu */
  const rowStyle = (index: number): React.CSSProperties | undefined => {
    if (!drag) return undefined
    const { from, to, dy, shift } = drag
    if (index === from) return { transform: `translateY(${dy}px)`, zIndex: 2, position: 'relative' }
    if (from < to && index > from && index <= to) return { transform: `translateY(${-shift}px)` }
    if (from > to && index >= to && index < from) return { transform: `translateY(${shift}px)` }
    return undefined
  }

  return { dragging: drag?.from ?? null, handleProps, rowStyle }
}

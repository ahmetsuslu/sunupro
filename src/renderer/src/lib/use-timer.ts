import { useCallback, useEffect, useRef, useState } from 'react'

export type Timer = {
  elapsedSec: number
  paused: boolean
  toggle: () => void
  pause: () => void
  resume: () => void
  reset: () => void
}

/** Gösteri süresi: gösteri başlayınca işlemeye başlar; duraklatılabilir ve sıfırlanabilir. */
export function useTimer(running: boolean): Timer {
  const acc = useRef(0) // duraklatmalara kadar biriken süre (ms)
  const since = useRef<number | null>(null) // son başlama anı
  const [paused, setPaused] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    if (running && since.current == null && !paused) since.current = Date.now()
    if (!running && since.current != null) {
      acc.current += Date.now() - since.current
      since.current = null
    }
  }, [running, paused])

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const toggle = useCallback(() => {
    if (since.current != null) {
      acc.current += Date.now() - since.current
      since.current = null
      setPaused(true)
    } else {
      since.current = Date.now()
      setPaused(false)
    }
  }, [])

  const pause = useCallback(() => {
    if (since.current != null) toggle()
  }, [toggle])

  const resume = useCallback(() => {
    if (since.current == null) toggle()
  }, [toggle])

  const reset = useCallback(() => {
    acc.current = 0
    since.current = since.current != null ? Date.now() : null
    tick((n) => n + 1)
  }, [])

  const ms = acc.current + (since.current != null ? Date.now() - since.current : 0)
  return { elapsedSec: Math.floor(ms / 1000), paused, toggle, pause, resume, reset }
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

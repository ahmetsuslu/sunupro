import { useEffect, useMemo, useRef } from 'react'
import { ACTION_BY_ID, bindingsFor, buildKeymap, comboFromEvent, formatCombo, type ActionId } from '@shared/shortcuts'
import { useSettings } from './settings'

export type ActionHandlers = Partial<Record<ActionId, () => void>>

/**
 * Klavye olaylarını ayarlardaki tuş atamalarına göre eylemlere yönlendirir.
 * İşleyicisi verilmeyen eylemler yok sayılır (tuş tarayıcıya geçer).
 */
export function useShortcuts(handlers: ActionHandlers, enabled = true): void {
  const settings = useSettings()
  const keymap = useMemo(() => buildKeymap(settings?.shortcuts ?? {}), [settings?.shortcuts])
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const id = keymap.get(combo)
      const handler = id ? ref.current[id] : undefined
      if (!id || !handler) return
      e.preventDefault()
      if (e.repeat && !ACTION_BY_ID[id].repeat) return
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keymap, enabled])
}

/** Düğmelerde gösterilecek tuş ipucu: eylemin ilk atanmış tuşu (yoksa boş). */
export function useKeyHint(): (id: ActionId) => string {
  const settings = useSettings()
  return (id) => {
    const first = bindingsFor(id, settings?.shortcuts ?? {})[0]
    return first ? formatCombo(first) : ''
  }
}

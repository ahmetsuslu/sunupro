import { useSyncExternalStore } from 'react'
import type { Settings } from '@shared/types'

/** Ayarların renderer tarafındaki kopyası: main'den yüklenir, değişiklikler anında yansır. */
let current: Settings | null = null
const subscribers = new Set<() => void>()
const emit = (): void => subscribers.forEach((f) => f())

window.api.settings.get().then((s) => {
  current = s
  emit()
})
window.api.settings.onChange((s) => {
  current = s
  emit()
})

export function useSettings(): Settings | null {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => current
  )
}

export function updateSettings(patch: Partial<Settings>): void {
  if (current) {
    current = { ...current, ...patch }
    emit()
  }
  window.api.settings.set(patch)
}

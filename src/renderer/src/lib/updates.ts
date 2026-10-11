import { useSyncExternalStore } from 'react'

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'downloading'; version: string; progress: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string }
  /** Geliştirme ortamında (paketlenmemiş) denetim yapılmaz */
  | { kind: 'dev' }

/** Güncelleme durumu: main'den gelen olaylarla güncellenir, banner ve ayarlar aynı kaynağı izler. */
let state: UpdateState = { kind: 'idle' }
const subscribers = new Set<() => void>()
const set = (next: UpdateState): void => {
  state = next
  subscribers.forEach((f) => f())
}

window.api.updates.onAvailable((version) => set({ kind: 'downloading', version, progress: 0 }))
window.api.updates.onProgress((progress) =>
  set(state.kind === 'downloading' ? { ...state, progress } : { kind: 'downloading', version: '', progress })
)
window.api.updates.onDownloaded((version) => set({ kind: 'ready', version }))
window.api.updates.onNone(() => set({ kind: 'none' }))
window.api.updates.onError((message) => {
  // Sessiz açılış denetimindeki ağ hatalarını kullanıcıya gösterme; yalnızca elle denetimde
  if (state.kind === 'checking') set({ kind: 'error', message })
})

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => state
  )
}

export async function checkForUpdates(): Promise<void> {
  if (state.kind === 'downloading' || state.kind === 'ready') return
  set({ kind: 'checking' })
  if (!(await window.api.updates.check())) set({ kind: 'dev' })
}

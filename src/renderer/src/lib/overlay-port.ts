import type { OverlayMsg } from '@shared/types'

/**
 * Sunucu ⇄ katman MessagePort'u. Her gösteri başlangıcında katman penceresi yeniden
 * oluşturulduğu için port da yenilenir. Dinleyici modül yüklenirken kurulur (React
 * bileşenleri bağlanmadan gelen port kaçmasın); abonelere mevcut ve sonraki portlar iletilir.
 */
let current: MessagePort | null = null
const portSubscribers = new Set<(port: MessagePort) => void>()
const messageSubscribers = new Set<(msg: OverlayMsg) => void>()

window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.data === 'overlay:port' && ev.ports[0]) {
    current?.close()
    current = ev.ports[0]
    current.onmessage = (m: MessageEvent<OverlayMsg>) => {
      for (const cb of messageSubscribers) cb(m.data)
    }
    current.start()
    for (const cb of portSubscribers) cb(current)
  }
})

/** Sunucu tarafı: her yeni portta çağrılır (ör. tüm çizimleri yeniden göndermek için). */
export function onOverlayPort(cb: (port: MessagePort) => void): () => void {
  portSubscribers.add(cb)
  if (current) cb(current)
  return () => portSubscribers.delete(cb)
}

/** Katman tarafı: porttan gelen mesajlar (lazer, çizim). */
export function onOverlayMessage(cb: (msg: OverlayMsg) => void): () => void {
  messageSubscribers.add(cb)
  return () => messageSubscribers.delete(cb)
}

export function post(port: MessagePort | null, msg: OverlayMsg): void {
  port?.postMessage(msg)
}

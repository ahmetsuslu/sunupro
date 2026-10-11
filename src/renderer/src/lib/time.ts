/** "az önce", "5 dk önce", "2 saat önce", "dün", "3 gün önce", tarih */
export function timeAgo(ts: number, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000))
  if (sec < 60) return 'az önce'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} dk önce`
  const hours = Math.round(min / 60)
  const d = new Date(ts)
  const today = new Date(now)
  const yesterday = new Date(now - 86_400_000)
  if (d.toDateString() === today.toDateString()) return `${hours} saat önce`
  if (d.toDateString() === yesterday.toDateString()) return 'dün'
  const days = Math.floor((today.setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days < 7) return `${days} gün önce`
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: days > 300 ? 'numeric' : undefined })
}

/** Geri sayım: 09:05 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

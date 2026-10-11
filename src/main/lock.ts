import { BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { spawn } from 'child_process'
import { log } from './log'

/**
 * Ara kilidi: Windows'un kendi kilidi (parmak izi / PIN ile açılır).
 *
 * Uygulama içi kilit (kendi içeriğini gösterirken Windows'u koruma) denendi ama tam güvenli olamıyor:
 * görev çubuğu her zaman en üstteki bir sistem penceresi, sabitlenmiş programların önizlemesi odak
 * değişmeden açılıyor; dokunmatik kenar hareketleri ve bildirim paneli de benzer açıklar bırakıyor.
 * Bu yüzden ara başlayınca Windows kilitlenir; kilit açılınca sunum ve ara geri sayımı kaldığı yerden
 * sürer. Ek süreç, klavye kancası ya da sürekli denetim yoktur.
 */
export const breakLock = {
  /** Kilit istekleri (test için) */
  requests: 0
}

export function lockWindows(reason: string): void {
  breakLock.requests++
  log('[kilit] Windows kilitleniyor:', reason)
  // Uçtan uca test gerçek Windows kilidini tetiklemesin
  if (process.env['SUNU_LOCK_DRYRUN']) return
  spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true, detached: true }).unref()
}

export function registerLock(getMain: () => BrowserWindow | null): void {
  ipcMain.handle('lock:windows', (_e, reason?: string) => lockWindows(reason ?? 'break'))
  // Kilit açılınca sunucu ekranı öne gelsin (klavye/tıklayıcı hemen çalışsın)
  powerMonitor.on('unlock-screen', () => getMain()?.focus())
}

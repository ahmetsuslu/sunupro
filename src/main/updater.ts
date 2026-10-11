import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import { loadSettings } from './store'
import { log } from './log'

const { autoUpdater } = electronUpdater

/**
 * GitHub Releases üzerinden otomatik güncelleme (MarkFlow ile aynı yaklaşım): açılışta sessizce
 * denetler, yeni sürümü arka planda indirir; "Yeniden Başlat" ile ya da uygulama kapanırken kurar.
 */
export function registerUpdater(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableWebInstaller = true // yalnızca tam NSIS kurulum dosyası yayınlanıyor
  autoUpdater.logger = {
    info: (m: unknown) => log('[updater]', m),
    warn: (m: unknown) => log('[updater:warn]', m),
    error: (m: unknown) => log('[updater:error]', m),
    debug: () => undefined
  }

  const send = (channel: string, payload?: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }

  autoUpdater.on('update-available', (info) => send('update:available', info.version))
  autoUpdater.on('update-not-available', () => send('update:none'))
  autoUpdater.on('download-progress', (p) => send('update:progress', Math.round(p.percent)))
  autoUpdater.on('update-downloaded', (info) => {
    log('[updater] indirildi', info.version)
    send('update:downloaded', info.version)
  })
  autoUpdater.on('error', (err) => send('update:error', String(err?.message ?? err)))

  // Elle denetim (ayarlardan). Sonucu olaylar bildirir; dönüş yalnızca denetimin başlatılıp
  // başlatılmadığını söyler (paketlenmemiş geliştirme ortamında başlatılmaz).
  ipcMain.handle('update:check', (): boolean => {
    if (!app.isPackaged) return false
    autoUpdater.checkForUpdates().catch(() => {
      /* hata olayı zaten arayüze gönderiliyor */
    })
    return true
  })

  ipcMain.handle('update:install', (): void => {
    autoUpdater.quitAndInstall()
  })

  // Paketli uygulamada, ayar açıksa: arayüz hazır olduktan sonra sessizce denetle
  // (erken tetiklenirse bildirimler arayüze ulaşmadan kaçabilir)
  const win = getWindow()
  const startCheck = (): void => {
    if (app.isPackaged && loadSettings().autoUpdate) {
      autoUpdater.checkForUpdates().catch(() => {
        /* ağ yoksa vb. yoksay */
      })
    }
  }
  if (win) {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', startCheck)
    else startCheck()
  }
}

import { app, BrowserWindow, ipcMain, net, protocol } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { ppt } from './pptctl'
import { cacheRoot, registerShow, show } from './show'
import { loadSettings, saveSettings } from './store'
import { createMainWindow } from './windows'
import { runSpike } from './spike'
import { flushLibrary, registerLibrary } from './library'
import { flushSessions } from './sessions'
import type { Settings } from '../shared/types'

let mainWindow: BrowserWindow | null = null

// Otomatik doğrulama kullanıcının gerçek kütüphane/ayar verisine dokunmasın
if (process.env['SUNU_SPIKE']) app.setPath('userData', join(process.env['SUNU_SPIKE'], 'userdata'))

// Önbellekteki slayt görselleri: sunu://cache/<anahtar>/slide-001.png | thumb-001.png
protocol.registerSchemesAsPrivileged([
  { scheme: 'sunu', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (): Settings => loadSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>): Settings => {
    const prev = loadSettings()
    const next = saveSettings(patch)
    mainWindow?.webContents.send('settings:changed', next)
    if (patch.audienceDisplayId !== undefined && patch.audienceDisplayId !== prev.audienceDisplayId) {
      show.applyDisplays()
    }
    return next
  })
}

app.whenReady().then(() => {
  protocol.handle('sunu', (request) => {
    const url = new URL(request.url)
    const m = /^\/([0-9a-f]{16})\/((?:slide|thumb)-\d{3}\.png)$/.exec(url.pathname)
    if (url.host !== 'cache' || !m) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(join(cacheRoot(), m[1], m[2])).toString())
  })

  ipcMain.handle('app:version', () => app.getVersion())
  registerSettingsIpc()
  registerShow(() => mainWindow)
  registerLibrary(() => mainWindow)

  mainWindow = createMainWindow(show.displays().presenter)
  // Ana pencere kapanınca (katman açık olsa bile) uygulama kapanır
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })

  // PowerPoint denetleyicisini arka planda ısıt (ilk sunu açılışı hızlı olsun)
  ppt.start().catch((err) => console.error('[pptctl] başlatılamadı:', err))

  const spikeOut = process.env['SUNU_SPIKE']
  if (spikeOut) runSpike(mainWindow, spikeOut)
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  flushSessions()
  flushLibrary()
  show
    .stop()
    .catch(() => undefined)
    .then(() => ppt.dispose())
    .finally(() => app.quit())
})

app.on('window-all-closed', () => {
  app.quit()
})

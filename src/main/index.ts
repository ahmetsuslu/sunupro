import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron'
import { existsSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { ppt } from './pptctl'
import { cacheRoot, registerShow, show } from './show'
import { loadSettings, saveSettings } from './store'
import { createMainWindow } from './windows'
import { runSelfTest } from './selftest'
import { flushLibrary, registerLibrary } from './library'
import { flushSessions } from './sessions'
import { registerUpdater } from './updater'
import { log, logDir } from './log'
import { registerLock } from './lock'
import type { Settings } from '../shared/types'

let mainWindow: BrowserWindow | null = null

// Otomatik doğrulama kullanıcının gerçek kütüphane/ayar verisine dokunmasın
if (process.env['SUNU_SELFTEST']) app.setPath('userData', join(process.env['SUNU_SELFTEST'], 'userdata'))

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

/** Önbellek boyutu ve temizleme (açık sununun görselleri korunur) */
function registerCacheIpc(): void {
  const dirSize = (dir: string): number => {
    let total = 0
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      total += entry.isDirectory() ? dirSize(p) : statSync(p).size
    }
    return total
  }
  ipcMain.handle('cache:info', () => {
    if (!existsSync(cacheRoot())) return { bytes: 0, presentations: 0 }
    return { bytes: dirSize(cacheRoot()), presentations: readdirSync(cacheRoot()).length }
  })
  ipcMain.handle('cache:clear', () => {
    if (!existsSync(cacheRoot())) return
    const keep = show.presentation?.cacheKey
    for (const name of readdirSync(cacheRoot())) {
      if (name !== keep) rmSync(join(cacheRoot(), name), { recursive: true, force: true })
    }
    log('Önbellek temizlendi')
  })
}

process.on('uncaughtException', (err) => log('[uncaught]', err))

app.whenReady().then(() => {
  protocol.handle('sunu', (request) => {
    const url = new URL(request.url)
    const m = /^\/([0-9a-f]{16})\/((?:slide|thumb)-\d{3}\.png)$/.exec(url.pathname)
    if (url.host !== 'cache' || !m) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(join(cacheRoot(), m[1], m[2])).toString())
  })

  log(`Sunu Pro ${app.getVersion()} başladı`)
  // Electron'un varsayılan menüsü gizli olsa da kısayolları çalışır: Ctrl+R ders sırasında arayüzü
  // yeniden yükleyip bellekteki çizimleri siler, Ctrl+−/= sayfayı büyütür → kurulu sürümde kapat
  if (app.isPackaged) Menu.setApplicationMenu(null)
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^https:\/\//i.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('shell:open-logs', () => shell.openPath(logDir()))
  registerSettingsIpc()
  registerCacheIpc()
  registerShow(() => mainWindow)
  registerLibrary(() => mainWindow)

  registerLock(() => mainWindow)

  mainWindow = createMainWindow(show.displays().presenter)
  // Ana pencere kapanınca (katman açık olsa bile) uygulama kapanır
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })
  registerUpdater(() => mainWindow)

  // PowerPoint denetleyicisini arka planda ısıt (ilk sunu açılışı hızlı olsun)
  ppt.start().catch((err) => log('[pptctl] başlatılamadı:', err))

  const selfTestOut = process.env['SUNU_SELFTEST']
  if (selfTestOut) runSelfTest(mainWindow, selfTestOut)
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

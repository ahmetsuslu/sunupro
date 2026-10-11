import { BrowserWindow, MessageChannelMain, nativeTheme, shell, type Display } from 'electron'
import { join } from 'path'

const preload = join(__dirname, '../preload/index.js')

function loadRoute(win: BrowserWindow, route: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
  }
}

/** Ana pencere: kütüphane + sunucu görünümü (1. ekran). */
export function createMainWindow(display: Display): BrowserWindow {
  const { x, y, width, height } = display.workArea
  const win = new BrowserWindow({
    x: x + Math.round(width * 0.1),
    y: y + Math.round(height * 0.1),
    width: Math.round(width * 0.8),
    height: Math.round(height * 0.8),
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f5f6f8',
    title: 'Sunu Pro',
    webPreferences: { preload, sandbox: false, contextIsolation: true, nodeIntegration: false }
  })
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRoute(win, '/')
  return win
}

/**
 * Seyirci ekranı penceresi.
 * - Normal: tam ekran, şeffaf; PowerPoint gösterisinin üstünde durur (görsel modda slaytı kendisi
 *   çizer), odak almaz → klavye/tıklayıcı hep sunucu penceresinde kalır.
 * - windowed (tek ekranlı test modu): taşınabilir, boyutlandırılabilir sıradan pencere.
 */
export function createOverlayWindow(display: Display, opts: { windowed: boolean }): BrowserWindow {
  const webPreferences = { preload, sandbox: false, contextIsolation: true, nodeIntegration: false }
  let win: BrowserWindow
  if (opts.windowed) {
    const w = Math.round(display.workArea.width * 0.45)
    const h = Math.round((w * 9) / 16)
    win = new BrowserWindow({
      x: display.workArea.x + display.workArea.width - w - 24,
      y: display.workArea.y + 24,
      width: w,
      height: h,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      title: 'Sunu Pro — Seyirci görünümü (test modu)',
      webPreferences
    })
  } else {
    win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      webPreferences
    })
    win.setAlwaysOnTop(true, 'screen-saver')
  }
  loadRoute(win, '/overlay')
  return win
}

/** Farklı ölçekli ekranlarda pencere boyutu ilk yerleşimde kayabildiği için sınırları yeniden uygula. */
export function fitToDisplay(win: BrowserWindow, display: Display): void {
  win.setBounds(display.bounds)
  win.setBounds(display.bounds)
}

/** Sunucu ⇄ katman arasında doğrudan MessagePort kanalı kurar (işaretçi akışı main'e uğramaz). */
export function connectPorts(presenter: BrowserWindow, overlay: BrowserWindow): void {
  const { port1, port2 } = new MessageChannelMain()
  presenter.webContents.postMessage('overlay:port', null, [port1])
  overlay.webContents.postMessage('overlay:port', null, [port2])
}

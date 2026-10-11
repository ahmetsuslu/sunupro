import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AudienceConfig, DisplayInfo, PresentationInfo, Result, Settings, ShowMode, ShowState } from '../shared/types'

type ShowCmd = 'next' | 'prev' | 'goto' | 'screen' | 'state'

let lastAudienceConfig: AudienceConfig | null = null
ipcRenderer.on('audience:config', (_e, config: AudienceConfig) => {
  lastAudienceConfig = config
})

const api = {
  show: {
    pickFile: (): Promise<string | null> => ipcRenderer.invoke('show:pick-file'),
    open: (path: string): Promise<Result<PresentationInfo>> => ipcRenderer.invoke('show:open', path),
    start: (opts?: { slide?: number; click?: number; mode?: ShowMode }): Promise<Result<ShowState>> =>
      ipcRenderer.invoke('show:start', opts),
    cmd: (cmd: ShowCmd, args?: Record<string, unknown>): Promise<ShowState> => ipcRenderer.invoke('show:cmd', cmd, args),
    stop: (): Promise<ShowState> => ipcRenderer.invoke('show:stop'),
    getState: (): Promise<ShowState> => ipcRenderer.invoke('show:get-state'),
    onState: (cb: (state: ShowState) => void): (() => void) => sub('show:state', cb),
    onExportProgress: (cb: (p: { done: number; total: number }) => void): (() => void) =>
      sub('show:export-progress', cb)
  },
  displays: {
    list: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('displays:list'),
    swap: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('displays:swap'),
    onChange: (cb: (list: DisplayInfo[]) => void): (() => void) => sub('displays:changed', cb)
  },
  // Seyirci penceresi (katman) yapılandırması — React aboneliği mesajdan sonra kurulabilir,
  // bu yüzden son yapılandırma saklanıp geç abonelere de iletilir
  audience: {
    onConfig: (cb: (config: AudienceConfig) => void): (() => void) => {
      if (lastAudienceConfig) cb(lastAudienceConfig)
      return sub('audience:config', cb)
    }
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
    onChange: (cb: (s: Settings) => void): (() => void) => sub('settings:changed', cb)
  },
  files: {
    // Sürüklenip bırakılan bir File için gerçek disk yolu
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:version')
  },
  // Otomatik doğrulama kancaları (yalnızca SUNU_SPIKE ile kullanılır)
  spike: {
    onPresentation: (cb: (info: PresentationInfo) => void): (() => void) => sub('spike:presentation', cb)
  }
}

/** Bir IPC kanalına abone olur; aboneliği kaldıran fonksiyon döndürür. */
function sub<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Sunucu ⇄ katman MessagePort'u: contextIsolation nedeniyle sayfa dünyasına postMessage ile aktarılır
ipcRenderer.on('overlay:port', (e) => {
  window.postMessage('overlay:port', '*', e.ports)
})

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AudienceConfig,
  DisplayInfo,
  InkMap,
  LibraryView,
  PresentationInfo,
  Result,
  Settings,
  ShowMode,
  ShowState
} from '../shared/types'

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
    /** Sunucu ekranından çıkış: sunu PowerPoint'ten bırakılır */
    close: (): Promise<void> => ipcRenderer.invoke('show:close'),
    getState: (): Promise<ShowState> => ipcRenderer.invoke('show:get-state'),
    onState: (cb: (state: ShowState) => void): (() => void) => sub('show:state', cb),
    onExportProgress: (cb: (p: { done: number; total: number }) => void): (() => void) =>
      sub('show:export-progress', cb)
  },
  library: {
    get: (): Promise<LibraryView> => ipcRenderer.invoke('library:get'),
    createCourse: (name: string, color: string): Promise<LibraryView> =>
      ipcRenderer.invoke('library:create-course', name, color),
    updateCourse: (id: string, patch: { name?: string; color?: string }): Promise<LibraryView> =>
      ipcRenderer.invoke('library:update-course', id, patch),
    deleteCourse: (id: string): Promise<LibraryView> => ipcRenderer.invoke('library:delete-course', id),
    /** paths verilmezse dosya seçme penceresi açılır */
    addFiles: (id: string, paths?: string[]): Promise<LibraryView> => ipcRenderer.invoke('library:add-files', id, paths),
    linkFolder: (id: string): Promise<LibraryView> => ipcRenderer.invoke('library:link-folder', id),
    unlinkFolder: (id: string): Promise<LibraryView> => ipcRenderer.invoke('library:unlink-folder', id),
    removeFile: (id: string, path: string): Promise<LibraryView> => ipcRenderer.invoke('library:remove-file', id, path),
    moveFile: (id: string, path: string, delta: number): Promise<LibraryView> =>
      ipcRenderer.invoke('library:move-file', id, path, delta),
    retry: (path: string): Promise<LibraryView> => ipcRenderer.invoke('library:retry', path),
    forgetRecent: (path: string): Promise<LibraryView> => ipcRenderer.invoke('library:forget-recent', path),
    onChange: (cb: (view: LibraryView) => void): (() => void) => sub('library:changed', cb)
  },
  // Ara kilidi: Windows'un kendi kilidi (parmak izi / PIN ile açılır)
  lock: {
    windows: (reason?: string): Promise<void> => ipcRenderer.invoke('lock:windows', reason)
  },
  ink: {
    load: (path: string): Promise<InkMap | null> => ipcRenderer.invoke('ink:load', path),
    save: (path: string, ink: InkMap): Promise<void> => ipcRenderer.invoke('ink:save', path, ink)
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
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
    openLogs: (): Promise<string> => ipcRenderer.invoke('shell:open-logs')
  },
  cache: {
    info: (): Promise<{ bytes: number; presentations: number }> => ipcRenderer.invoke('cache:info'),
    clear: (): Promise<void> => ipcRenderer.invoke('cache:clear')
  },
  // Otomatik güncelleme (GitHub Releases)
  updates: {
    check: (): Promise<boolean> => ipcRenderer.invoke('update:check'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onAvailable: (cb: (version: string) => void): (() => void) => sub('update:available', cb),
    onProgress: (cb: (percent: number) => void): (() => void) => sub('update:progress', cb),
    onDownloaded: (cb: (version: string) => void): (() => void) => sub('update:downloaded', cb),
    onNone: (cb: () => void): (() => void) => sub('update:none', cb),
    onError: (cb: (message: string) => void): (() => void) => sub('update:error', cb)
  },
  // Uçtan uca test kancası (yalnızca SUNU_SELFTEST ile kullanılır)
  selftest: {
    onPresentation: (cb: (info: PresentationInfo) => void): (() => void) => sub('selftest:presentation', cb)
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

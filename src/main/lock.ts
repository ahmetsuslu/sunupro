import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { join } from 'path'
import { log } from './log'
import type { LockState } from '../shared/types'

/**
 * Ara kilidi: ana pencere tam ekran ve en üstte kilit ekranına döner, projeksiyondaki geri sayım
 * sürer. Gözcü süreç (resources/guard.ps1) kilidin aşılmasını engeller; aşılmaya çalışılırsa ya da
 * Sunu Pro kapanırsa gerçek Windows kilidini devreye sokar. Kilit Windows Hello (parmak izi / PIN)
 * ile açılır; Windows kilidi devreye girdiyse Windows'un kendi kilidi açılınca Sunu Pro da açılır.
 */
class BreakLock {
  private guard: ChildProcessWithoutNullStreams | null = null
  private state: LockState = { locked: false, hello: null, windowsLocked: false }
  private verifyWaiter: ((result: string) => void) | null = null

  constructor(private getMain: () => BrowserWindow | null) {
    powerMonitor.on('unlock-screen', () => {
      // Windows kilidini yalnızca kullanıcı açabilir → Sunu Pro kilidini de kaldır
      if (this.state.locked && this.state.windowsLocked) this.unlock('windows-unlock')
    })
  }

  get(): LockState {
    return this.state
  }

  private setState(patch: Partial<LockState>): void {
    this.state = { ...this.state, ...patch }
    this.getMain()?.webContents.send('lock:state', this.state)
  }

  private scriptPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'resources', 'guard.ps1')
      : join(app.getAppPath(), 'resources', 'guard.ps1')
  }

  /** Windows'un kendi kilidi (gözcü yoksa ya da Windows Hello kullanılamıyorsa) */
  private lockWindows(reason: string): void {
    log('[kilit] Windows kilitleniyor:', reason)
    if (process.env['SUNU_LOCK_DRYRUN']) return
    spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true, detached: true }).unref()
  }

  lock(): LockState {
    const main = this.getMain()
    if (!main || this.state.locked) return this.state
    log('[kilit] ara kilidi açıldı')
    main.setKiosk(true)
    main.setAlwaysOnTop(true, 'screen-saver')
    main.focus()
    this.setState({ locked: true, hello: null, windowsLocked: false })
    this.startGuard()
    return this.state
  }

  private startGuard(): void {
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath(), '-AppPid', String(process.pid)]
    if (process.env['SUNU_LOCK_DRYRUN']) args.push('-DryRun')
    const guard = spawn('powershell.exe', args, { windowsHide: true })
    this.guard = guard
    guard.stderr.on('data', (d: Buffer) => log('[gözcü]', d.toString()))
    createInterface({ input: guard.stdout }).on('line', (line) => {
      let msg: { event?: string; hello?: string; result?: string; reason?: string }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.event === 'ready') {
        this.setState({ hello: msg.hello ?? 'Unknown' })
        // Parmak izi/PIN yoksa Sunu Pro kilidi açılamaz → doğrudan Windows kilidi
        if (msg.hello !== 'Available') {
          this.setState({ windowsLocked: true })
          this.lockWindows(`hello:${msg.hello}`)
        }
      } else if (msg.event === 'verify') {
        this.verifyWaiter?.(msg.result ?? 'Error')
        this.verifyWaiter = null
      } else if (msg.event === 'locked') {
        log('[kilit] gözcü Windows kilidini devreye soktu:', msg.reason)
        this.setState({ windowsLocked: true })
      }
    })
    guard.on('exit', () => {
      if (this.guard !== guard) return
      this.guard = null
      this.verifyWaiter?.('Error')
      this.verifyWaiter = null
      // Gözcü beklenmedik biçimde kapandıysa (Windows kilidi devreye girmeden) koruma kalmasın diye kilitle
      if (this.state.locked && !this.state.windowsLocked) {
        this.setState({ windowsLocked: true })
        this.lockWindows('guard-exit')
      }
    })
  }

  /** Windows Hello ile doğrula; başarılıysa kilidi kaldır. */
  async verify(): Promise<string> {
    if (!this.state.locked) return 'Verified'
    if (!this.guard) return 'Error'
    if (this.verifyWaiter) return 'Busy'
    const result = await new Promise<string>((resolve) => {
      this.verifyWaiter = resolve
      this.guard!.stdin.write(JSON.stringify({ cmd: 'verify', message: 'Sunu Pro kilidini açmak için kimliğinizi doğrulayın' }) + '\n')
    })
    if (result === 'Verified') this.unlock('verified')
    return result
  }

  unlock(reason: string): void {
    const main = this.getMain()
    log('[kilit] açıldı:', reason)
    const guard = this.guard
    this.guard = null
    if (guard) {
      guard.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n')
      guard.stdin.end()
    }
    if (main && !main.isDestroyed()) {
      main.setAlwaysOnTop(false)
      main.setKiosk(false)
      main.maximize()
      main.focus()
    }
    this.setState({ locked: false, windowsLocked: false })
  }
}

export let breakLock: BreakLock

export function registerLock(getMain: () => BrowserWindow | null): void {
  breakLock = new BreakLock(getMain)
  ipcMain.handle('lock:start', () => breakLock.lock())
  ipcMain.handle('lock:verify', () => breakLock.verify())
  ipcMain.handle('lock:get', () => breakLock.get())
}

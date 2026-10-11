import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { EventEmitter } from 'events'
import { join } from 'path'
import { log } from './log'

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

/** pptctl.ps1'den dönen hata. Mesaj "KOD: açıklama" biçimindeyse kod ayrıştırılır. */
export class PptError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

/**
 * PowerPoint denetleyicisi: kalıcı bir PowerShell sürecine (resources/pptctl.ps1) satır satır
 * JSON komut gönderir. Süreç çökerse bir sonraki çağrıda kendiliğinden yeniden başlatılır.
 * Olaylar: 'event' (ad, veri) — ör. export-progress.
 */
export class PptController extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()

  private scriptPath(): string {
    // Paketli uygulamada extraResources altında; geliştirmede proje kökündeki resources/
    return app.isPackaged
      ? join(process.resourcesPath, 'resources', 'pptctl.ps1')
      : join(app.getAppPath(), 'resources', 'pptctl.ps1')
  }

  start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath()],
        { windowsHide: true }
      )
      this.proc = proc
      let started = false

      proc.stderr.on('data', (d: Buffer) => log('[pptctl]', d.toString()))
      proc.on('error', (err) => {
        if (!started) reject(err)
      })
      proc.on('exit', (code) => {
        this.proc = null
        this.ready = null
        const err = new PptError('PPTCTL_EXIT', `PowerPoint denetleyicisi kapandı (kod ${code}).`)
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(err)
        }
        this.pending.clear()
        if (!started) reject(err)
        this.emit('exit', code)
      })

      createInterface({ input: proc.stdout }).on('line', (line) => {
        let msg: { id?: number; ok?: boolean; result?: unknown; error?: string; event?: string; data?: unknown }
        try {
          msg = JSON.parse(line)
        } catch {
          console.warn('[pptctl] çözümlenemeyen satır:', line)
          return
        }
        if (msg.event) {
          if (msg.event === 'ready') {
            started = true
            resolve()
          } else this.emit('event', msg.event, msg.data)
          return
        }
        const p = msg.id != null ? this.pending.get(msg.id) : undefined
        if (!p) return
        this.pending.delete(msg.id!)
        clearTimeout(p.timer)
        if (msg.ok) p.resolve(msg.result)
        else {
          const text = msg.error ?? 'Bilinmeyen hata'
          const m = /^([A-Z_]+): (.*)$/s.exec(text)
          p.reject(m ? new PptError(m[1], m[2]) : new PptError('COM', text))
        }
      })
    })
    return this.ready
  }

  async call<T>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    await this.start()
    const proc = this.proc
    if (!proc) throw new PptError('PPTCTL_EXIT', 'PowerPoint denetleyicisi çalışmıyor.')
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new PptError('TIMEOUT', `PowerPoint yanıt vermedi (${cmd}).`))
        // Takılan COM çağrısının arkasındaki komutlar sonsuza dek beklemesin: süreci yeniden başlat
        this.proc?.kill()
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
    })
  }

  /** Uygulama kapanırken: açık sunuyu kapatır, PowerPoint'i yalnızca biz başlattıysak kapatır. */
  async dispose(): Promise<void> {
    if (!this.proc) return
    try {
      await this.call('quit', {}, 5_000)
    } catch {
      /* yoksay */
    }
    this.proc?.stdin.end()
  }
}

export const ppt = new PptController()

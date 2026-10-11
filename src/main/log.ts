import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

const MAX_BYTES = 1_000_000

/** Basit dosya günlüğü: %APPDATA%/Sunu Pro/logs/main.log (sorun bildirirken eklenebilir). */
export function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts
    .map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ')}\n`
  try {
    const dir = join(app.getPath('userData'), 'logs')
    const file = join(dir, 'main.log')
    mkdirSync(dir, { recursive: true })
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'main.old.log'))
    } catch {
      /* dosya henüz yok */
    }
    appendFileSync(file, line, 'utf-8')
  } catch {
    /* günlük yazılamazsa uygulama etkilenmesin */
  }
}

export function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

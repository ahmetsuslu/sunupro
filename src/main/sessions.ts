import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { JsonFile } from './json-file'
import type { FileSession, InkMap } from '../shared/types'

const RECENT_MAX = 12

type SessionData = {
  /** Dosya yolu (küçük harf) → son konum */
  positions: Record<string, FileSession & { path: string }>
  /** Son açılan dosyalar (yeniden eskiye) */
  recent: string[]
}

const file = new JsonFile<SessionData>('sessions.json', () => ({ positions: {}, recent: [] }))

const keyOf = (path: string): string => path.toLowerCase()

/** Kaldığın yerden devam: dosyanın son konumu */
export function getSession(path: string): FileSession | null {
  const s = file.get().positions[keyOf(path)]
  return s ? { slide: s.slide, click: s.click, slideCount: s.slideCount, updatedAt: s.updatedAt } : null
}

export function saveSession(path: string, pos: Omit<FileSession, 'updatedAt'>): void {
  const data = file.get()
  const prev = data.positions[keyOf(path)]
  if (prev && prev.slide === pos.slide && prev.click === pos.click && prev.slideCount === pos.slideCount) return
  file.set({ ...data, positions: { ...data.positions, [keyOf(path)]: { ...pos, path, updatedAt: Date.now() } } })
}

export function markRecent(path: string): void {
  const data = file.get()
  const recent = [path, ...data.recent.filter((p) => keyOf(p) !== keyOf(path))].slice(0, RECENT_MAX)
  file.set({ ...data, recent })
}

export function recentFiles(): string[] {
  return file.get().recent
}

export function forgetRecent(path: string): void {
  const data = file.get()
  file.set({ ...data, recent: data.recent.filter((p) => keyOf(p) !== keyOf(path)) })
}

export function flushSessions(): void {
  file.flush()
}

// ---------- Çizimleri dosya bazında saklama (ayar açıksa) ----------

function inkPath(path: string): string {
  const h = createHash('sha1').update(keyOf(path)).digest('hex').slice(0, 16)
  return join(app.getPath('userData'), 'ink', `${h}.json`)
}

export function loadInk(path: string): InkMap | null {
  try {
    return JSON.parse(readFileSync(inkPath(path), 'utf-8')) as InkMap
  } catch {
    return null
  }
}

export function saveInk(path: string, ink: InkMap): void {
  const target = inkPath(path)
  try {
    if (!Object.values(ink).some((list) => list.length)) {
      rmSync(target, { force: true })
      return
    }
    mkdirSync(join(app.getPath('userData'), 'ink'), { recursive: true })
    writeFileSync(target, JSON.stringify(ink), 'utf-8')
  } catch (err) {
    console.error('[ink] kaydedilemedi:', err)
  }
}

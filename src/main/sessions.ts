import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { JsonFile } from './json-file'
import type { FileSession, InkMap } from '../shared/types'

type SessionData = {
  /** Dosya yolu (küçük harf) → son konum */
  positions: Record<string, FileSession & { path: string }>
  /** Sunuldu olarak işaretlenen dosyalar: yol (küçük harf) → işaretlenme zamanı */
  presented: Record<string, { path: string; at: number }>
}

const file = new JsonFile<SessionData>('sessions.json', () => ({ positions: {}, presented: {} }))

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

export function presentedAt(path: string): number | null {
  return file.get().presented[keyOf(path)]?.at ?? null
}

/** Sunuldu işareti koy/kaldır. Zaten işaretli dosyanın ilk tarihi korunur. */
export function setPresented(paths: string[], on: boolean): void {
  const data = file.get()
  const presented = { ...data.presented }
  let changed = false
  for (const p of paths) {
    const k = keyOf(p)
    if (on && !presented[k]) presented[k] = { path: p, at: Date.now() }
    else if (!on && presented[k]) delete presented[k]
    else continue
    changed = true
  }
  if (changed) file.set({ ...data, presented })
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

import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { Settings } from '../shared/types'

const DEFAULTS: Settings = {
  audienceDisplayId: null,
  showMode: 'live',
  notesFontSize: 20,
  shortcuts: {},
  ink: { penColor: '#e53935', penSize: 1, hlColor: '#ffeb3b', hlSize: 1 },
  breakMinutes: 10,
  rememberInk: false,
  autoUpdate: true
}

let cache: Settings | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  if (cache) return cache
  try {
    const raw = readFileSync(filePath(), 'utf-8')
    cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  cache = next
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch {
    /* yazılamadıysa yoksay */
  }
  return next
}

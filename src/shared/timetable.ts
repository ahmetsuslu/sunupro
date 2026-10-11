// Haftalık ders programı: varsayılanlar, hazır sınıf şablonları ve doğrulama (main ve renderer ortak)
import type { ClassLevel, Period, ScheduleSlot, Timetable } from './types'

export const DAY_NAMES = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
export const DAY_SHORT = ['', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

/** Sınıflar için sırayla önerilen renkler (1. sınıf yeşil, 2. sınıf mavi, …) */
export const LEVEL_COLORS = ['#66bb6a', '#4f8cff', '#ff9800', '#7c4dff', '#ef5350', '#26a69a', '#ec407a', '#8d6e63']

export const DEFAULT_PERIODS: Period[] = [
  { start: '08:30', end: '09:20' },
  { start: '09:30', end: '10:20' },
  { start: '10:30', end: '11:20' },
  { start: '11:30', end: '12:20' },
  { start: '13:00', end: '13:50' },
  { start: '14:00', end: '14:50' },
  { start: '15:00', end: '15:50' },
  { start: '16:00', end: '16:50' }
]

/** Hazır sınıf şablonları: uygulanınca mevcut sınıfların kimliği sırayla korunur (derslerin sınıfı kaybolmaz) */
export const LEVEL_PRESETS: { name: string; levels: string[] }[] = [
  { name: 'Ön lisans (2 yıl)', levels: ['1. sınıf', '2. sınıf'] },
  { name: 'Lisans (4 yıl)', levels: ['1. sınıf', '2. sınıf', '3. sınıf', '4. sınıf'] },
  { name: 'Tıp (6 yıl)', levels: ['Dönem 1', 'Dönem 2', 'Dönem 3', 'Dönem 4', 'Dönem 5', 'Dönem 6'] }
]

export function defaultTimetable(newId: () => string): Timetable {
  return {
    title: '',
    days: [1, 2, 3, 4, 5],
    periods: DEFAULT_PERIODS.map((p) => ({ ...p })),
    levels: LEVEL_PRESETS[1].levels.map((name, i) => ({ id: newId(), name, color: LEVEL_COLORS[i] })),
    slots: []
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Dışarıdan gelen programı güvenli hâle getirir: geçersiz gün/saat/ders ayıklanır, aralıklar sınırlanır. */
export function sanitizeTimetable(input: Partial<Timetable> | undefined, courseIds: string[], fallback: Timetable): Timetable {
  const t = input ?? {}
  const days = [...new Set((t.days ?? fallback.days).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b)
  const periods: Period[] = (t.periods ?? fallback.periods).filter((p) => TIME.test(p?.start) && TIME.test(p?.end))
  const levels: ClassLevel[] = (t.levels ?? fallback.levels)
    .filter((l) => l && typeof l.id === 'string' && typeof l.name === 'string')
    .map((l) => ({ id: l.id, name: l.name.trim() || 'Sınıf', color: typeof l.color === 'string' ? l.color : LEVEL_COLORS[0] }))
  const n = (periods.length ? periods : fallback.periods).length
  const slots: ScheduleSlot[] = (t.slots ?? fallback.slots)
    .filter((s) => s && courseIds.includes(s.courseId) && s.day >= 1 && s.day <= 7 && s.from >= 0 && s.from < n)
    .map((s) => ({
      id: s.id,
      courseId: s.courseId,
      day: s.day,
      from: s.from,
      to: Math.min(Math.max(s.to, s.from), n - 1),
      room: typeof s.room === 'string' ? s.room.trim() : ''
    }))
  return {
    title: typeof t.title === 'string' ? t.title.trim() : fallback.title,
    days: days.length ? days : [1, 2, 3, 4, 5],
    periods: periods.length ? periods : fallback.periods,
    levels,
    slots
  }
}

/** "HH:MM" → gün içindeki dakika */
export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** JS Date.getDay() (0 = Pazar) → 1 = Pazartesi … 7 = Pazar */
export const isoDay = (d: Date): number => d.getDay() || 7

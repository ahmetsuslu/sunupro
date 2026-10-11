import { useEffect, useState } from 'react'
import type { LibraryCourse, LibraryView, ScheduleSlot, Timetable } from '@shared/types'
import { DAY_NAMES, isoDay, minutesOf } from '@shared/timetable'

declare global {
  interface Window {
    /** Uçtan uca test: "şimdi"yi sabitler (ms); değişince 'sunu:now' olayı gönderilir */
    __sunuNow?: number
  }
}

const now = (): Date => new Date(window.__sunuNow ?? Date.now())

/** Şimdiki zaman; yarım dakikada bir (ve test saati değişince) yenilenir */
export function useNow(): Date {
  const [t, setT] = useState(now)
  useEffect(() => {
    const tick = (): void => setT(now())
    const id = setInterval(tick, 30_000)
    window.addEventListener('sunu:now', tick)
    return () => {
      clearInterval(id)
      window.removeEventListener('sunu:now', tick)
    }
  }, [])
  return t
}

/** Dersin rengi: sınıfı varsa sınıfın rengi */
export function courseColor(course: Pick<LibraryCourse, 'color' | 'levelId'>, tt: Timetable): string {
  return tt.levels.find((l) => l.id === course.levelId)?.color ?? course.color
}

export function levelName(course: Pick<LibraryCourse, 'levelId'>, tt: Timetable): string | null {
  return tt.levels.find((l) => l.id === course.levelId)?.name ?? null
}

export function slotTime(tt: Timetable, s: ScheduleSlot): { start: string; end: string } {
  return { start: tt.periods[s.from]?.start ?? '', end: tt.periods[s.to]?.end ?? '' }
}

export type Entry = { slot: ScheduleSlot; course: LibraryCourse }

/** Bir günün dersleri, saat sırasıyla */
export function dayEntries(view: LibraryView, day: number): Entry[] {
  return view.timetable.slots
    .filter((s) => s.day === day)
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .flatMap((slot) => {
      const course = view.courses.find((c) => c.id === slot.courseId)
      return course ? [{ slot, course }] : []
    })
}

/** Dersin haftalık saatleri, kısa: "Pzt 10:30–12:20 · C201" */
export function courseSlots(view: LibraryView, courseId: string): ScheduleSlot[] {
  return view.timetable.slots
    .filter((s) => s.courseId === courseId)
    .sort((a, b) => a.day - b.day || a.from - b.from)
}

export type TodayEntry = Entry & { state: 'past' | 'now' | 'next' | 'later'; start: string; end: string }

/** Bugünün dersleri: geçmiş / şu an / sıradaki / sonra */
export function todayEntries(view: LibraryView, at: Date): TodayEntry[] {
  const m = at.getHours() * 60 + at.getMinutes()
  let nextMarked = false
  return dayEntries(view, isoDay(at)).map((e) => {
    const { start, end } = slotTime(view.timetable, e.slot)
    let state: TodayEntry['state'] = 'later'
    if (m >= minutesOf(end)) state = 'past'
    else if (m >= minutesOf(start)) state = 'now'
    else if (!nextMarked) state = 'next'
    if (state === 'now' || state === 'next') nextMarked = true
    return { ...e, state, start, end }
  })
}

/** Bugünden sonraki ilk ders (bugün kalan ders yoksa): gün adıyla */
export function nextDayEntry(view: LibraryView, at: Date): (Entry & { dayName: string; start: string }) | null {
  const today = isoDay(at)
  for (let k = 1; k <= 7; k++) {
    const day = ((today - 1 + k) % 7) + 1
    const first = dayEntries(view, day)[0]
    if (first) return { ...first, dayName: k === 1 ? 'Yarın' : DAY_NAMES[day], start: slotTime(view.timetable, first.slot).start }
  }
  return null
}

export type SideGroup = { title: string; today?: boolean; entries: { key: string; course: LibraryCourse; sub?: string }[] }

/**
 * Sol menü: programda ders varsa günlere göre (gün içinde saat sırasıyla), programsız dersler en altta;
 * program boşsa tek liste.
 */
export function sidebarGroups(view: LibraryView, at: Date): SideGroup[] {
  const tt = view.timetable
  if (!tt.slots.length) return [{ title: 'Dersler', entries: view.courses.map((c) => ({ key: c.id, course: c })) }]
  const days = [...new Set([...tt.days, ...tt.slots.map((s) => s.day)])].sort((a, b) => a - b)
  const groups: SideGroup[] = days
    .map((day) => ({
      title: DAY_NAMES[day],
      today: day === isoDay(at),
      entries: dayEntries(view, day).map(({ slot, course }) => ({
        key: slot.id,
        course,
        sub: [slotTime(tt, slot).start, slot.room].filter(Boolean).join(' · ')
      }))
    }))
    .filter((g) => g.entries.length)
  const unscheduled = view.courses.filter((c) => !tt.slots.some((s) => s.courseId === c.id))
  if (unscheduled.length) groups.push({ title: 'Programsız', entries: unscheduled.map((c) => ({ key: c.id, course: c })) })
  return groups
}

/** Dersin sıradaki sunusu: sunuldu işareti olmayan ilk sunu */
export function nextPresentation(course: LibraryCourse): LibraryCourse['items'][number] | null {
  return course.items.find((f) => !f.presentedAt && f.status !== 'missing') ?? null
}

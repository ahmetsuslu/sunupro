import React, { useEffect, useRef, useState } from 'react'
import type { ClassLevel, LibraryView, Period, ScheduleSlot, Timetable } from '@shared/types'
import { DAY_NAMES, DAY_SHORT, LEVEL_COLORS, LEVEL_PRESETS, minutesOf } from '@shared/timetable'
import { courseColor } from '../lib/schedule'

type Props = {
  view: LibraryView
  setView: (v: LibraryView) => void
  onOpenCourse: (id: string) => void
}

type Editing = { slot: ScheduleSlot; isNew: boolean } | null

/** Çakışan dersler alt alta: her derse bir şerit (gün satırında) */
function lanesOf(slots: ScheduleSlot[]): { slot: ScheduleSlot; lane: number }[] {
  const ends: number[] = []
  return [...slots]
    .sort((a, b) => a.from - b.from || b.to - a.to)
    .map((slot) => {
      let lane = ends.findIndex((end) => end < slot.from)
      if (lane < 0) lane = ends.length
      ends[lane] = slot.to
      return { slot, lane }
    })
}

/**
 * Ders programı ekranı: gün × ders saati ızgarası. Boş hücreye tıklayınca ders yerleştirilir, derse
 * tıklayınca düzenlenir. "Program ayarları": dönem başlığı, günler, ders saatleri, sınıflar (ad + renk).
 */
export default function TimetableView({ view, setView, onOpenCourse }: Props): React.JSX.Element {
  const tt = view.timetable
  const [editing, setEditing] = useState<Editing>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const save = async (patch: Partial<Timetable>): Promise<LibraryView> => {
    const v = await window.api.library.setTimetable(patch)
    setView(v)
    return v
  }

  const newSlot = (day: number, from: number): void =>
    setEditing({
      isNew: true,
      slot: { id: crypto.randomUUID(), courseId: view.courses[0]?.id ?? '', day, from, to: from, room: '' }
    })

  const P = tt.periods.length
  return (
    <div className="tt">
      <div className="lib-head">
        <h1>Ders programı</h1>
        <CommitInput
          className="input tt__title"
          value={tt.title}
          placeholder="Dönem (ör. 2026-2027 Güz)"
          onCommit={(title) => save({ title })}
        />
        <div className="spacer" />
        <button className={`btn btn--lg ${settingsOpen ? 'btn--active' : ''}`} onClick={() => setSettingsOpen((o) => !o)}>
          Program ayarları
        </button>
      </div>

      {!view.courses.length && (
        <div className="banner lib-banner">Programa ders yerleştirmek için önce soldan bir ders oluştur.</div>
      )}

      {settingsOpen && <TimetableSettings tt={tt} save={save} />}

      <div className="tt-grid" style={{ gridTemplateColumns: `minmax(96px, 120px) repeat(${P}, minmax(0, 1fr))` }}>
        <div className="tt-corner">Günler</div>
        {tt.periods.map((p, i) => (
          <div key={i} className="tt-head">
            <strong>{i + 1}.</strong>
            <span>
              {p.start}–{p.end}
            </span>
          </div>
        ))}
        {tt.days.map((day) => {
          const placed = lanesOf(tt.slots.filter((s) => s.day === day))
          const lanes = Math.max(1, ...placed.map((p) => p.lane + 1))
          return (
            <React.Fragment key={day}>
              <div className="tt-day">{DAY_NAMES[day]}</div>
              <div
                className="tt-row"
                data-day={day}
                style={{
                  gridColumn: `2 / span ${P}`,
                  gridTemplateColumns: `repeat(${P}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${lanes}, minmax(58px, auto))`
                }}
              >
                {tt.periods.map((_, i) => (
                  <button
                    key={i}
                    className="tt-cell"
                    style={{ gridColumn: i + 1, gridRow: `1 / span ${lanes}` }}
                    title={`${DAY_NAMES[day]} ${i + 1}. saat — ders ekle`}
                    disabled={!view.courses.length}
                    onClick={() => newSlot(day, i)}
                  >
                    <span>+</span>
                  </button>
                ))}
                {placed.map(({ slot, lane }) => {
                  const course = view.courses.find((c) => c.id === slot.courseId)
                  if (!course) return null
                  return (
                    <button
                      key={slot.id}
                      className="tt-slot"
                      style={{ gridColumn: `${slot.from + 1} / ${slot.to + 2}`, gridRow: lane + 1, ['--c' as string]: courseColor(course, tt) }}
                      title="Düzenle"
                      onClick={() => setEditing({ slot, isNew: false })}
                    >
                      <span className="tt-slot__name">{course.name}</span>
                      {slot.room && <span className="tt-slot__room">{slot.room}</span>}
                    </button>
                  )
                })}
              </div>
            </React.Fragment>
          )
        })}
      </div>
      <p className="hint tt__hint">
        Boş bir saate tıklayarak ders yerleştir, derse tıklayarak saatini, dersliğini ya da sınıfını değiştir. Programdaki
        dersler ana sayfada "Bugün" bölümünde ve soldaki listede günlere göre görünür.
      </p>

      {editing && (
        <SlotDialog
          view={view}
          editing={editing}
          onCancel={() => setEditing(null)}
          onOpenCourse={(id) => {
            setEditing(null)
            onOpenCourse(id)
          }}
          onSave={async (slot, levelId) => {
            setEditing(null)
            const course = view.courses.find((c) => c.id === slot.courseId)
            if (course && (course.levelId ?? null) !== levelId) setView(await window.api.library.updateCourse(course.id, { levelId }))
            const others = tt.slots.filter((s) => s.id !== slot.id)
            await save({ slots: [...others, slot] })
          }}
          onDelete={async () => {
            setEditing(null)
            await save({ slots: tt.slots.filter((s) => s.id !== editing.slot.id) })
          }}
        />
      )}
    </div>
  )
}

/** Ders yerleştirme / düzenleme penceresi */
function SlotDialog({
  view,
  editing,
  onSave,
  onDelete,
  onCancel,
  onOpenCourse
}: {
  view: LibraryView
  editing: NonNullable<Editing>
  onSave: (slot: ScheduleSlot, levelId: string | null) => void
  onDelete: () => void
  onCancel: () => void
  onOpenCourse: (id: string) => void
}): React.JSX.Element {
  const tt = view.timetable
  const [slot, setSlot] = useState(editing.slot)
  const course = view.courses.find((c) => c.id === slot.courseId)
  const [levelId, setLevelId] = useState<string | null>(course?.levelId ?? null)
  // Ders değişince sınıf seçimi o dersin sınıfına döner
  useEffect(() => setLevelId(view.courses.find((c) => c.id === slot.courseId)?.levelId ?? null), [slot.courseId, view.courses])

  const set = (patch: Partial<ScheduleSlot>): void =>
    setSlot((s) => {
      const next = { ...s, ...patch }
      if (next.to < next.from) next.to = next.from
      return next
    })
  const clash = tt.slots.some((s) => s.id !== slot.id && s.day === slot.day && s.from <= slot.to && slot.from <= s.to)
  const label = (i: number, edge: 'start' | 'end'): string => `${i + 1}. saat · ${tt.periods[i][edge]}`

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="modal slot-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (course) onSave(slot, levelId)
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>{editing.isNew ? 'Programa ders ekle' : 'Dersi düzenle'}</h2>
        <label className="field">
          <span>Ders</span>
          <select className="input" value={slot.courseId} onChange={(e) => set({ courseId: e.target.value })}>
            {view.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field-row">
          <label className="field">
            <span>Gün</span>
            <select className="input" value={slot.day} onChange={(e) => set({ day: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  {DAY_NAMES[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Derslik</span>
            <input className="input" value={slot.room} placeholder="ör. C201" onChange={(e) => set({ room: e.target.value })} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Başlangıç</span>
            <select className="input" value={slot.from} onChange={(e) => set({ from: Number(e.target.value) })}>
              {tt.periods.map((_, i) => (
                <option key={i} value={i}>
                  {label(i, 'start')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Bitiş</span>
            <select className="input" value={slot.to} onChange={(e) => set({ to: Number(e.target.value) })}>
              {tt.periods.map((_, i) =>
                i < slot.from ? null : (
                  <option key={i} value={i}>
                    {label(i, 'end')}
                  </option>
                )
              )}
            </select>
          </label>
        </div>
        <div className="field">
          <span>Sınıf (dersin rengi sınıftan gelir)</span>
          <div className="level-pick">
            <button type="button" className={`chip ${levelId === null ? 'chip--active' : ''}`} onClick={() => setLevelId(null)}>
              Yok
            </button>
            {tt.levels.map((l) => (
              <button
                type="button"
                key={l.id}
                className={`chip level-chip ${levelId === l.id ? 'chip--active' : ''}`}
                style={{ ['--c' as string]: l.color }}
                onClick={() => setLevelId(l.id)}
              >
                <span className="dot" style={{ background: l.color }} />
                {l.name}
              </button>
            ))}
          </div>
        </div>
        {clash && <div className="hint slot-dialog__warn">Bu gün ve saatte başka bir ders de var; ikisi alt alta gösterilir.</div>}
        <div className="modal__actions">
          {!editing.isNew && (
            <>
              <button type="button" className="btn btn--danger" onClick={onDelete}>
                Programdan çıkar
              </button>
              <button type="button" className="btn" onClick={() => onOpenCourse(slot.courseId)}>
                Derse git
              </button>
            </>
          )}
          <div className="spacer" />
          <button type="button" className="btn btn--lg" onClick={onCancel}>
            Vazgeç
          </button>
          <button type="submit" className="btn btn--lg btn--primary" disabled={!course}>
            Kaydet
          </button>
        </div>
      </form>
    </div>
  )
}

/** Program ayarları: günler, ders saatleri, sınıflar */
function TimetableSettings({ tt, save }: { tt: Timetable; save: (patch: Partial<Timetable>) => Promise<LibraryView> }): React.JSX.Element {
  const setPeriod = (i: number, patch: Partial<Period>): void => {
    save({ periods: tt.periods.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  }
  const addPeriod = (): void => {
    const last = tt.periods[tt.periods.length - 1]
    const at = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const start = last ? minutesOf(last.end) + 10 : 8 * 60 + 30
    save({ periods: [...tt.periods, { start: at(start), end: at(start + 50) }] })
  }
  const setLevel = (id: string, patch: Partial<ClassLevel>): void => {
    save({ levels: tt.levels.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  }
  // Şablon: mevcut sınıfların kimliği ve rengi sırayla korunur, fazlası silinir, eksikler eklenir
  const applyPreset = (names: string[]): void => {
    save({
      levels: names.map((name, i) => ({
        id: tt.levels[i]?.id ?? crypto.randomUUID(),
        name,
        color: tt.levels[i]?.color ?? LEVEL_COLORS[i % LEVEL_COLORS.length]
      }))
    })
  }

  return (
    <section className="tt-settings">
      <div className="tt-settings__block">
        <h3>Günler</h3>
        <div className="level-pick">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => {
            const on = tt.days.includes(d)
            return (
              <button
                key={d}
                className={`chip ${on ? 'chip--active' : ''}`}
                aria-pressed={on}
                onClick={() => save({ days: on ? tt.days.filter((x) => x !== d) : [...tt.days, d] })}
              >
                {DAY_SHORT[d]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="tt-settings__block">
        <h3>Ders saatleri</h3>
        <div className="period-list">
          {tt.periods.map((p, i) => (
            <div key={i} className="period-row">
              <span className="period-row__no">{i + 1}.</span>
              <input className="input" type="time" value={p.start} onChange={(e) => e.target.value && setPeriod(i, { start: e.target.value })} />
              <span>–</span>
              <input className="input" type="time" value={p.end} onChange={(e) => e.target.value && setPeriod(i, { end: e.target.value })} />
              <button
                className="icon-btn"
                title="Bu saati sil"
                disabled={tt.periods.length <= 1}
                onClick={() => save({ periods: tt.periods.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button className="btn" onClick={addPeriod}>
          + Saat ekle
        </button>
      </div>

      <div className="tt-settings__block">
        <h3>Sınıflar</h3>
        <div className="period-list">
          {tt.levels.map((l) => (
            <div key={l.id} className="period-row">
              <input
                className="color-input"
                type="color"
                value={l.color}
                title="Renk"
                onChange={(e) => setLevel(l.id, { color: e.target.value })}
              />
              <CommitInput className="input" value={l.name} onCommit={(name) => setLevel(l.id, { name })} />
              <button className="icon-btn" title="Sınıfı sil" onClick={() => save({ levels: tt.levels.filter((x) => x.id !== l.id) })}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="level-pick">
          <button
            className="btn"
            onClick={() =>
              save({
                levels: [
                  ...tt.levels,
                  { id: crypto.randomUUID(), name: `${tt.levels.length + 1}. sınıf`, color: LEVEL_COLORS[tt.levels.length % LEVEL_COLORS.length] }
                ]
              })
            }
          >
            + Sınıf ekle
          </button>
          {LEVEL_PRESETS.map((p) => (
            <button key={p.name} className="btn" title={p.levels.join(', ')} onClick={() => applyPreset(p.levels)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Yazarken değil, Enter'a basınca ya da odaktan çıkınca kaydeden metin kutusu */
function CommitInput({
  value,
  onCommit,
  className,
  placeholder
}: {
  value: string
  onCommit: (v: string) => void
  className?: string
  placeholder?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  const commit = (): void => {
    if (draft.trim() !== value) onCommit(draft.trim())
  }
  return (
    <input
      className={className}
      value={draft}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

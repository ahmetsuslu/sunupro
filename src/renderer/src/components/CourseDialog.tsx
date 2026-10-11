import React, { useEffect, useRef, useState } from 'react'
import type { ClassLevel } from '@shared/types'

export const COURSE_COLORS = ['#4f8cff', '#7c4dff', '#ef5350', '#ff9800', '#26a69a', '#66bb6a', '#ec407a', '#8d6e63']

type Props = {
  title: string
  initialName?: string
  initialColor?: string
  initialLevelId?: string | null
  levels: ClassLevel[]
  confirmLabel: string
  onSave: (name: string, color: string, levelId: string | null) => void
  onCancel: () => void
}

/** Ders oluşturma / düzenleme: ad, sınıf ve renk (sınıf seçilince renk sınıftan gelir). */
export default function CourseDialog({
  title,
  initialName = '',
  initialColor,
  initialLevelId = null,
  levels,
  confirmLabel,
  onSave,
  onCancel
}: Props): React.JSX.Element {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor ?? COURSE_COLORS[0])
  const [levelId, setLevelId] = useState<string | null>(initialLevelId)
  const inputRef = useRef<HTMLInputElement>(null)
  const level = levels.find((l) => l.id === levelId)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (): void => {
    if (name.trim()) onSave(name.trim(), color, levelId)
  }

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h2>{title}</h2>
        <label className="field">
          <span>Ders adı</span>
          <input
            ref={inputRef}
            className="input"
            value={name}
            placeholder="ör. SD209 Otonom Tarım Makineleri"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {!!levels.length && (
          <div className="field">
            <span>Sınıf</span>
            <div className="level-pick">
              <button type="button" className={`chip ${levelId === null ? 'chip--active' : ''}`} onClick={() => setLevelId(null)}>
                Yok
              </button>
              {levels.map((l) => (
                <button
                  type="button"
                  key={l.id}
                  className={`chip level-chip ${levelId === l.id ? 'chip--active' : ''}`}
                  onClick={() => setLevelId(l.id)}
                >
                  <span className="dot" style={{ background: l.color }} />
                  {l.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <span>{level ? `Renk: ${level.name} rengi (Ders programı → Program ayarları'ndan değişir)` : 'Renk'}</span>
          <div className={`color-row ${level ? 'color-row--off' : ''}`}>
            {COURSE_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`swatch ${c === (level?.color ?? color) ? 'swatch--active' : ''}`}
                style={{ ['--swatch' as string]: c }}
                disabled={!!level}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--lg" onClick={onCancel}>
            Vazgeç
          </button>
          <button type="submit" className="btn btn--lg btn--primary" disabled={!name.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

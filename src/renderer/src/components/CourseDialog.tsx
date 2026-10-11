import React, { useEffect, useRef, useState } from 'react'

export const COURSE_COLORS = ['#4f8cff', '#7c4dff', '#ef5350', '#ff9800', '#26a69a', '#66bb6a', '#ec407a', '#8d6e63']

type Props = {
  title: string
  initialName?: string
  initialColor?: string
  confirmLabel: string
  onSave: (name: string, color: string) => void
  onCancel: () => void
}

/** Ders oluşturma / düzenleme: ad + renk. */
export default function CourseDialog({ title, initialName = '', initialColor, confirmLabel, onSave, onCancel }: Props): React.JSX.Element {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor ?? COURSE_COLORS[0])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (): void => {
    if (name.trim()) onSave(name.trim(), color)
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
            placeholder="ör. SD209 Ölçme ve Değerlendirme"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="field">
          <span>Renk</span>
          <div className="color-row">
            {COURSE_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`swatch ${c === color ? 'swatch--active' : ''}`}
                style={{ ['--swatch' as string]: c }}
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

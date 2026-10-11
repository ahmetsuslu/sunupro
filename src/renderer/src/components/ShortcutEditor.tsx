import React, { useEffect, useState } from 'react'
import {
  ACTIONS,
  ACTION_BY_ID,
  CATEGORY_LABELS,
  bindingsFor,
  comboFromEvent,
  formatCombo,
  type ActionCategory,
  type ActionId,
  type ShortcutOverrides
} from '@shared/shortcuts'
import { updateSettings, useSettings } from '../lib/settings'

type Pending = { target: ActionId; combo: string; owner: ActionId } | null

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Kısayol atama: her eyleme bir veya birden çok tuş. "+ Tuş ekle" → istenen tuşa bas.
 * Tuş başka eyleme bağlıysa taşıma onayı sorulur; zorunlu eylemin son tuşu kaldırılamaz.
 * Değişiklikler anında geçerli olur ve ayarlarda yalnızca varsayılandan farklı olanlar saklanır.
 */
export default function ShortcutEditor(): React.JSX.Element {
  const settings = useSettings()
  const overrides = settings?.shortcuts ?? {}
  const [capturing, setCapturing] = useState<ActionId | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const save = (next: Record<ActionId, string[]>): void => {
    const o: ShortcutOverrides = {}
    for (const a of ACTIONS) if (!sameList(next[a.id], a.defaults)) o[a.id] = next[a.id]
    updateSettings({ shortcuts: o })
  }

  const current = (): Record<ActionId, string[]> =>
    Object.fromEntries(ACTIONS.map((a) => [a.id, [...bindingsFor(a.id, overrides)]])) as Record<ActionId, string[]>

  const ownerOf = (combo: string): ActionId | null => ACTIONS.find((a) => bindingsFor(a.id, overrides).includes(combo))?.id ?? null

  const assign = (target: ActionId, combo: string, owner: ActionId | null): void => {
    const next = current()
    if (owner && owner !== target) {
      if (ACTION_BY_ID[owner].required && next[owner].length === 1) {
        setNotice(`"${formatCombo(combo)}", "${ACTION_BY_ID[owner].label}" eyleminin tek tuşu. Önce o eyleme başka bir tuş atayın.`)
        return
      }
      next[owner] = next[owner].filter((c) => c !== combo)
    }
    if (!next[target].includes(combo)) next[target].push(combo)
    save(next)
  }

  // Tuş yakalama: yakalama aşamasında dinle ki sunum kısayolları tetiklenmesin
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      const combo = comboFromEvent(e)
      e.preventDefault()
      e.stopPropagation()
      if (!combo) return
      const target = capturing
      setCapturing(null)
      setNotice(null)
      const owner = ownerOf(combo)
      if (owner === target) return
      if (owner) setPending({ target, combo, owner })
      else assign(target, combo, null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const remove = (id: ActionId, combo: string): void => {
    const next = current()
    if (ACTION_BY_ID[id].required && next[id].length === 1) return
    next[id] = next[id].filter((c) => c !== combo)
    save(next)
  }

  const resetOne = (id: ActionId): void => {
    const next = current()
    // Varsayılan tuşları başka eylemlere taşınmışsa oradan geri al
    for (const combo of ACTION_BY_ID[id].defaults) {
      for (const a of ACTIONS) if (a.id !== id) next[a.id] = next[a.id].filter((c) => c !== combo)
    }
    next[id] = [...ACTION_BY_ID[id].defaults]
    save(next)
  }

  const categories = Object.keys(CATEGORY_LABELS) as ActionCategory[]

  return (
    <div className="shortcuts">
      <div className="shortcuts__head">
        <p className="hint">
          Bir eyleme birden fazla tuş atayabilirsin (ör. sunum kumandasının düğmeleri). Değişiklikler hemen geçerli olur.
        </p>
        <button className="btn" onClick={() => updateSettings({ shortcuts: {} })} disabled={!Object.keys(overrides).length}>
          Tümünü varsayılana döndür
        </button>
      </div>
      {notice && <div className="banner banner--warn shortcuts__notice">{notice}</div>}
      {pending && (
        <div className="banner banner--info shortcuts__notice">
          <span>
            <kbd>{formatCombo(pending.combo)}</kbd> şu an "{ACTION_BY_ID[pending.owner].label}" eylemine atanmış.
            "{ACTION_BY_ID[pending.target].label}" eylemine taşınsın mı?
          </span>
          <div className="spacer" />
          <button className="btn" onClick={() => setPending(null)}>
            Vazgeç
          </button>
          <button
            className="btn btn--primary"
            onClick={() => {
              assign(pending.target, pending.combo, pending.owner)
              setPending(null)
            }}
          >
            Taşı
          </button>
        </div>
      )}
      {categories.map((cat) => (
        <section key={cat} className="shortcuts__group">
          <h4>{CATEGORY_LABELS[cat]}</h4>
          {ACTIONS.filter((a) => a.category === cat).map((a) => {
            const keys = bindingsFor(a.id, overrides)
            const changed = !!overrides[a.id]
            return (
              <div key={a.id} className={`shortcut-row ${changed ? 'shortcut-row--changed' : ''}`}>
                <span className="shortcut-row__label">{a.label}</span>
                <div className="shortcut-row__keys">
                  {keys.map((k) => (
                    <span key={k} className="key-chip">
                      {formatCombo(k)}
                      <button
                        title="Bu tuşu kaldır"
                        disabled={!!a.required && keys.length === 1}
                        onClick={() => remove(a.id, k)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  {!keys.length && <span className="hint">Atanmamış</span>}
                  {capturing === a.id ? (
                    <button className="btn btn--active key-capture" onClick={() => setCapturing(null)}>
                      Bir tuşa bas… (vazgeç)
                    </button>
                  ) : (
                    <button
                      className="btn key-add"
                      onClick={() => {
                        setNotice(null)
                        setPending(null)
                        setCapturing(a.id)
                      }}
                    >
                      + Tuş ekle
                    </button>
                  )}
                  {changed && (
                    <button className="icon-btn" title="Varsayılana döndür" onClick={() => resetOne(a.id)}>
                      ↺
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import type { PresentationInfo } from '@shared/types'
import { nextVisible, thumbUrl } from '../lib/slides'
import { updateSettings, useSettings } from '../lib/settings'

type Props = {
  presentation: PresentationInfo
  slide: number
  /** Geçerli slaytta kalan animasyon adımı */
  remainingClicks: number
}

const FONT_MIN = 12
const FONT_MAX = 48

/** Kişisel notun slayt anahtarı: PowerPoint'in kalıcı slayt kimliği (slayt eklense de kaymaz), yoksa sıra */
const noteKey = (p: PresentationInfo, slide: number): string => {
  const id = p.slides[slide - 1]?.id
  return id ? String(id) : `#${slide}`
}

/**
 * Sağ panel: sonraki slayt önizlemesi + konuşmacı notları. PowerPoint notlarının altında kullanıcının
 * Sunu Pro'da eklediği kişisel not ("Notum") durur; provada ve derste eklenip düzenlenebilir.
 */
export default function SidePanel({ presentation: p, slide, remainingClicks }: Props): React.JSX.Element {
  const settings = useSettings()
  const fontSize = settings?.notesFontSize ?? 20
  const next = nextVisible(p, slide)
  const info = p.slides[slide - 1]
  const setFont = (n: number): void => updateSettings({ notesFontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, n)) })

  const [myNotes, setMyNotes] = useState<Record<string, string>>(() => ({ ...p.myNotes }))
  const [editing, setEditing] = useState(false)
  const key = noteKey(p, slide)
  const myNote = myNotes[key] ?? ''
  const saveTimer = useRef<number | undefined>(undefined)
  const pending = useRef<{ key: string; text: string } | null>(null)

  // Yazarken kısa gecikmeyle kaydedilir; slayt değişince ya da düzenleme bitince bekleyen kayıt hemen yazılır
  const flush = (): void => {
    window.clearTimeout(saveTimer.current)
    const job = pending.current
    pending.current = null
    if (job) window.api.myNotes.set(p.path, job.key, job.text)
  }
  const change = (text: string): void => {
    setMyNotes((m) => ({ ...m, [key]: text }))
    pending.current = { key, text }
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(flush, 500)
  }
  // Slayt değişince: bekleyen kayıt yazılır, düzenleme kapanır. Panel kapanırken de bekleyen kayıt yazılır.
  useEffect(() => {
    flush()
    setEditing(false)
  }, [key])
  useEffect(() => () => flush(), [])

  const finish = (): void => {
    flush()
    setEditing(false)
  }

  return (
    <aside className="side">
      <section className="panel">
        <h3>Sonraki</h3>
        {remainingClicks > 0 && (
          <div className="side__steps">
            Bu slaytta <strong>{remainingClicks}</strong> animasyon adımı daha var
          </div>
        )}
        {next ? (
          <div className="side__next">
            <img className="thumb" src={thumbUrl(p.cacheKey, next)} alt="" draggable={false} />
            <span className="side__next-label">
              {next}. {p.slides[next - 1]?.title || 'Başlıksız slayt'}
            </span>
          </div>
        ) : (
          <div className="side__end">Sunumun sonu</div>
        )}
      </section>
      <section className="panel panel--notes">
        <div className="panel__head">
          <h3>Notlar</h3>
          <div className="panel__actions">
            {!editing && (
              <button
                className="icon-btn my-note__edit"
                title="Bu slayta kendi notunu ekle (Sunu Pro'da saklanır, PowerPoint dosyası değişmez)"
                onClick={() => setEditing(true)}
              >
                {myNote.trim() ? '✎ Notumu düzenle' : '✎ Not ekle'}
              </button>
            )}
            <button className="icon-btn" title="Yazıyı küçült" onClick={() => setFont(fontSize - 2)}>
              A−
            </button>
            <button className="icon-btn" title="Yazıyı büyüt" onClick={() => setFont(fontSize + 2)}>
              A+
            </button>
          </div>
        </div>
        <div className="notes" style={{ fontSize }}>
          {info?.notes || (!myNote.trim() && !editing && <span className="hint">Bu slaytta not yok.</span>)}
          {editing ? (
            <div className="my-note my-note--editing">
              <div className="my-note__label">Notum</div>
              <textarea
                className="my-note__input"
                autoFocus
                value={myNote}
                placeholder="Bu slayt için notun… (Sunu Pro'da saklanır)"
                rows={Math.max(3, myNote.split('\n').length + 1)}
                onChange={(e) => change(e.target.value)}
                onBlur={finish}
                onKeyDown={(e) => {
                  // Esc ya da Ctrl+Enter: bitir (kısayollar metin kutusunda zaten çalışmaz)
                  if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                }}
              />
              <div className="my-note__actions">
                <span className="hint">Esc ya da Ctrl+Enter ile bitir</span>
                <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={finish}>
                  Bitti
                </button>
              </div>
            </div>
          ) : (
            myNote.trim() && (
              <div className="my-note" role="button" title="Düzenlemek için tıkla" onClick={() => setEditing(true)}>
                <div className="my-note__label">Notum</div>
                {myNote}
              </div>
            )
          )}
        </div>
      </section>
    </aside>
  )
}

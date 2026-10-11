import React, { useEffect, useRef, useState } from 'react'
import type { DisplayInfo } from '@shared/types'
import { updateSettings, useSettings } from '../lib/settings'

type Props = { running: boolean }

/** Seyirci ekranı seçimi, ekranları değiştirme ve sunum modu (canlı / görsel). */
export default function DisplayMenu({ running }: Props): React.JSX.Element {
  const settings = useSettings()
  const [open, setOpen] = useState(false)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.displays.list().then(setDisplays)
    return window.api.displays.onChange(setDisplays)
  }, [])
  useEffect(() => {
    if (!open) return
    window.api.displays.list().then(setDisplays)
    const close = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const audience = displays.find((d) => d.audience)
  const single = displays.length < 2
  const label = single ? 'Tek ekran' : `Seyirci: ${audience?.label ?? '—'}`

  return (
    <div className="menu-root" ref={rootRef}>
      <button className={`btn ${single ? 'btn--warn' : ''}`} onClick={() => setOpen(!open)}>
        {label} ▾
      </button>
      {open && (
        <div className="menu">
          <div className="menu__section">
            <div className="menu__title">Seyirci (projeksiyon) ekranı</div>
            {single && (
              <div className="menu__hint">
                Yalnızca bir ekran bağlı. Sunum, seyirci görünümü ayrı pencerede olacak şekilde test modunda açılır.
              </div>
            )}
            {!single &&
              displays.map((d) => (
                <label key={d.id} className="menu__option">
                  <input
                    type="radio"
                    name="audience"
                    checked={d.audience}
                    onChange={() => updateSettings({ audienceDisplayId: d.id })}
                  />
                  <span>
                    {d.label} <span className="hint">
                      {d.width}×{d.height}
                      {d.primary ? ' · birincil' : ''}
                    </span>
                  </span>
                </label>
              ))}
            {!single && (
              <button className="btn menu__wide" onClick={() => window.api.displays.swap().then(setDisplays)}>
                ⇄ Ekranları değiştir
              </button>
            )}
          </div>
          <div className="menu__section">
            <div className="menu__title">Sunum modu</div>
            <label className="menu__option">
              <input
                type="radio"
                name="mode"
                checked={settings?.showMode !== 'image'}
                onChange={() => updateSettings({ showMode: 'live' })}
              />
              <span>
                Canlı PowerPoint <span className="hint">animasyon, geçiş ve video çalışır</span>
              </span>
            </label>
            <label className="menu__option">
              <input
                type="radio"
                name="mode"
                checked={settings?.showMode === 'image'}
                onChange={() => updateSettings({ showMode: 'image' })}
              />
              <span>
                Görsel <span className="hint">animasyonsuz, yedek mod</span>
              </span>
            </label>
            {running && <div className="menu__hint">Mod değişikliği bir sonraki başlatmada geçerli olur.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

import React from 'react'
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

/** Sağ panel: sonraki slayt önizlemesi + konuşmacı notları. */
export default function SidePanel({ presentation: p, slide, remainingClicks }: Props): React.JSX.Element {
  const settings = useSettings()
  const fontSize = settings?.notesFontSize ?? 20
  const next = nextVisible(p, slide)
  const info = p.slides[slide - 1]
  const setFont = (n: number): void => updateSettings({ notesFontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, n)) })

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
            <button className="icon-btn" title="Yazıyı küçült" onClick={() => setFont(fontSize - 2)}>
              A−
            </button>
            <button className="icon-btn" title="Yazıyı büyüt" onClick={() => setFont(fontSize + 2)}>
              A+
            </button>
          </div>
        </div>
        <div className="notes" style={{ fontSize }}>
          {info?.notes || <span className="hint">Bu slaytta not yok.</span>}
        </div>
      </section>
    </aside>
  )
}

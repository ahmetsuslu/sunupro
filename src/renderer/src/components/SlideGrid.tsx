import React, { useEffect, useRef } from 'react'
import type { PresentationInfo } from '@shared/types'
import { thumbUrl } from '../lib/slides'

type Props = {
  presentation: PresentationInfo
  current: number
  onSelect: (slide: number) => void
  onClose: () => void
}

/** Tüm slaytların küçük resimleri; dokunarak istenen slayta gidilir. */
export default function SlideGrid({ presentation: p, current, onSelect, onClose }: Props): React.JSX.Element {
  const currentRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Not: scrollIntoView güncel Chromium'da Promise döndürür; effect'ten döndürülmemeli
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [])

  return (
    <div className="grid-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="grid-panel">
        <div className="grid-panel__head">
          <h2>Slayta git</h2>
          <button className="btn" onClick={onClose}>
            Kapat <kbd>Esc</kbd>
          </button>
        </div>
        <div className="slide-grid">
          {p.slides.map((s) => (
            <button
              key={s.index}
              ref={s.index === current ? currentRef : undefined}
              className={`slide-cell ${s.index === current ? 'slide-cell--current' : ''} ${s.hidden ? 'slide-cell--hidden' : ''}`}
              onClick={() => onSelect(s.index)}
            >
              <img src={thumbUrl(p.cacheKey, s.index)} alt="" draggable={false} />
              <span className="slide-cell__label">
                <strong>{s.index}</strong> {s.title || 'Başlıksız'}
              </span>
              {s.hidden && <span className="badge">Gizli</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

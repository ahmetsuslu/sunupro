import React, { useState } from 'react'
import { useUpdateState } from '../lib/updates'

/**
 * Güncelleme bildirimi. Yalnızca kütüphane ekranında gösterilir: sunum sırasında dikkat dağıtmaz,
 * "Yeniden başlat" yanlışlıkla gösteriyi kesmez. Ertelenirse uygulama kapanırken kurulur.
 */
export default function UpdateBanner(): React.JSX.Element | null {
  const s = useUpdateState()
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (s.kind === 'downloading' && s.version) {
    return (
      <div className="update-banner">
        <div className="update-banner__text">
          <strong>Güncelleme indiriliyor…</strong>
          <span>
            Sunu Pro {s.version} · %{s.progress}
          </span>
        </div>
        <div className="update-banner__bar">
          <div style={{ width: `${s.progress}%` }} />
        </div>
      </div>
    )
  }
  if (s.kind === 'ready' && dismissed !== s.version) {
    return (
      <div className="update-banner">
        <div className="update-banner__text">
          <strong>Güncelleme hazır</strong>
          <span>Sunu Pro {s.version} yüklenmeye hazır. Sonra dersen uygulama kapanırken kurulur.</span>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => setDismissed(s.version)}>
          Sonra
        </button>
        <button className="btn btn--primary" onClick={() => window.api.updates.install()}>
          Yeniden başlat
        </button>
      </div>
    )
  }
  return null
}

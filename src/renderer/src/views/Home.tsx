import React, { useEffect, useState } from 'react'
import type { PresentationInfo } from '@shared/types'

type Props = { onOpened: (info: PresentationInfo) => void }

/** Geçici açılış ekranı — Faz 5'te ders kütüphanesine dönüşecek. */
export default function Home({ onOpened }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => window.api.show.onExportProgress(setProgress), [])

  const open = async (path: string | null): Promise<void> => {
    if (!path || busy) return
    setBusy(true)
    setError(null)
    setProgress(null)
    const r = await window.api.show.open(path)
    setBusy(false)
    if (r.ok) onOpened(r.value)
    else setError(r.message)
  }

  return (
    <div
      className={`home ${dragging ? 'home--drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) open(window.api.files.getPathForFile(f))
      }}
    >
      <div className="home__card">
        <h1>Sunu Pro</h1>
        <p>PowerPoint dosyasını buraya sürükleyin ya da seçin.</p>
        <button className="btn btn--primary btn--lg" disabled={busy} onClick={async () => open(await window.api.show.pickFile())}>
          {busy ? 'Hazırlanıyor…' : 'Sunu aç'}
        </button>
        {busy && (
          <div className="progress">
            <div
              className="progress__fill"
              style={{ width: progress ? `${(progress.done / progress.total) * 100}%` : '8%' }}
            />
            <span>{progress ? `Slaytlar hazırlanıyor ${progress.done}/${progress.total}` : 'PowerPoint açılıyor…'}</span>
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}

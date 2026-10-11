import React, { useCallback, useEffect, useState } from 'react'
import type { PresentationInfo } from '@shared/types'
import ErrorBoundary from './components/ErrorBoundary'
import Library from './views/Library'
import Presenter from './views/Presenter'
import Overlay from './views/Overlay'
import SettingsModal from './components/SettingsModal'

export default function App(): React.JSX.Element {
  // Seyirci ekranındaki pencere ayrı, aynı bundle'ın #/overlay rotasıyla açılır
  if (window.location.hash === '#/overlay') return <Overlay />
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  )
}

type Opening = { name: string; progress: { done: number; total: number } | null }

function Shell(): React.JSX.Element {
  const [presentation, setPresentation] = useState<PresentationInfo | null>(null)
  const [opening, setOpening] = useState<Opening | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(
    () =>
      window.api.selftest.onPresentation((info) => {
        // Uçtan uca test: sunucu ekranı çizim deposunu test için dışa açar
        ;(window as unknown as { __sunuSelfTest: boolean }).__sunuSelfTest = true
        setPresentation(info)
      }),
    []
  )
  useEffect(() => window.api.show.onExportProgress((progress) => setOpening((o) => (o ? { ...o, progress } : o))), [])

  const open = useCallback(
    async (path: string) => {
      if (opening) return
      setError(null)
      setOpening({ name: path.split(/[\\/]/).pop() ?? path, progress: null })
      const r = await window.api.show.open(path)
      setOpening(null)
      if (r.ok) setPresentation(r.value)
      else setError(r.message)
    },
    [opening]
  )

  const close = useCallback(async () => {
    setPresentation(null)
    await window.api.show.close()
  }, [])

  return (
    <>
      {presentation ? (
        <Presenter
          key={presentation.path}
          presentation={presentation}
          onClose={close}
          onSettings={() => setSettingsOpen(true)}
          inputBlocked={settingsOpen}
        />
      ) : (
        <Library onOpen={open} onSettings={() => setSettingsOpen(true)} error={error} onDismissError={() => setError(null)} />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {opening && (
        <div className="modal-overlay">
          <div className="modal opening">
            <h2>Sunu açılıyor</h2>
            <p className="opening__name">{opening.name}</p>
            <div className="progress">
              <div
                className="progress__fill"
                style={{ width: opening.progress ? `${(opening.progress.done / opening.progress.total) * 100}%` : '8%' }}
              />
              <span>
                {opening.progress
                  ? `Slaytlar hazırlanıyor ${opening.progress.done}/${opening.progress.total}`
                  : 'PowerPoint açılıyor…'}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

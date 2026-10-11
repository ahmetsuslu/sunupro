import React, { useEffect, useState } from 'react'
import type { PresentationInfo } from '@shared/types'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './views/Home'
import Presenter from './views/Presenter'
import Overlay from './views/Overlay'

export default function App(): React.JSX.Element {
  // Seyirci ekranındaki pencere ayrı, aynı bundle'ın #/overlay rotasıyla açılır
  if (window.location.hash === '#/overlay') return <Overlay />
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  )
}

function Shell(): React.JSX.Element {
  const [presentation, setPresentation] = useState<PresentationInfo | null>(null)

  useEffect(
    () =>
      window.api.spike.onPresentation((info) => {
        // Otomatik doğrulama: sunucu ekranı çizim deposunu test için dışa açar
        ;(window as unknown as { __sunuSpike: boolean }).__sunuSpike = true
        setPresentation(info)
      }),
    []
  )

  if (presentation) return <Presenter presentation={presentation} onClose={() => setPresentation(null)} />
  return <Home onOpened={setPresentation} />
}

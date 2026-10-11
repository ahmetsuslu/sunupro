import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/app.css'
import './styles/library.css'
import './styles/settings.css'

// Ctrl+tekerlek tüm arayüzü büyütmesin (slayt yakınlaştırması sahnede ayrıca ele alınır)
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault()
  },
  { passive: false }
)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

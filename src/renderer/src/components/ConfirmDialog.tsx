import React, { useEffect } from 'react'

type Props = {
  title: string
  message?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Onay penceresi: Enter onaylar, Esc vazgeçer. */
export default function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') onConfirm()
      else if (e.key === 'Escape') onCancel()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // Yakalama aşamasında dinle: sunucu kısayolları bu sırada çalışmasın
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onConfirm, onCancel])

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {message && <p>{message}</p>}
        <div className="modal__actions">
          <button className="btn btn--lg" onClick={onCancel}>
            Vazgeç <kbd>Esc</kbd>
          </button>
          <button className={`btn btn--lg ${danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={onConfirm}>
            {confirmLabel} <kbd>Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

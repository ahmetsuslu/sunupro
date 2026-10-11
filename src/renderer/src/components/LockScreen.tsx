import React, { useEffect, useReducer, useState } from 'react'
import type { LockState } from '@shared/types'
import { formatCountdown } from '../lib/time'

const MESSAGES: Record<string, string> = {
  Canceled: 'Doğrulama iptal edildi.',
  RetriesExhausted: 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.',
  DeviceBusy: 'Parmak izi okuyucu meşgul, tekrar deneyin.',
  DeviceNotPresent: 'Parmak izi okuyucu bulunamadı.',
  NotConfiguredForUser: 'Bu kullanıcı için Windows Hello ayarlanmamış.',
  DisabledByPolicy: 'Windows Hello yönetici tarafından kapatılmış.',
  Error: 'Doğrulama başlatılamadı, tekrar deneyin.'
}

type Props = { state: LockState; breakUntil: number | null }

/**
 * Ara kilidi ekranı (sunucu ekranını kaplar). Projeksiyonda ara geri sayımı sürer.
 * Windows Hello (parmak izi / PIN) ile açılır.
 */
export default function LockScreen({ state, breakUntil }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [, tick] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  const unlock = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setStatus(null)
    const r = await window.api.lock.verify()
    setBusy(false)
    if (r !== 'Verified' && r !== 'Busy') setStatus(MESSAGES[r] ?? `Doğrulanamadı (${r}).`)
  }

  return (
    <div className="lock-screen" role="dialog" aria-modal="true">
      <div className="lock-screen__icon" aria-hidden="true" />
      <h1>Sunu Pro kilitli</h1>
      {breakUntil && (
        <div className="lock-screen__count">
          Ara · {breakUntil > Date.now() ? `${formatCountdown(breakUntil - Date.now())} kaldı` : 'süre doldu'} · dönüş{' '}
          {new Date(breakUntil).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
      <button className="btn btn--primary lock-screen__btn" onClick={unlock} disabled={busy}>
        {busy ? 'Parmak izinizi okutun…' : 'Parmak iziyle aç'}
      </button>
      <p className="lock-screen__hint">
        Windows Hello ile açılır (parmak izi ya da PIN). Projeksiyonda ara geri sayımı gösteriliyor.
      </p>
      {state.windowsLocked && (
        <div className="lock-screen__status">
          Kilit aşılmaya çalışıldı ya da Windows Hello kullanılamıyor: Windows kilidi devreye girdi. Windows'un kilidini
          açtığınızda Sunu Pro da açılır.
        </div>
      )}
      {status && <div className="lock-screen__status">{status}</div>}
    </div>
  )
}

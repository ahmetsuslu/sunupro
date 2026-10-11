import React, { useEffect, useState } from 'react'
import ShortcutEditor from './ShortcutEditor'
import { updateSettings, useSettings } from '../lib/settings'
import { checkForUpdates, useUpdateState } from '../lib/updates'

type Tab = 'general' | 'shortcuts' | 'updates' | 'about'

const REPO_URL = 'https://github.com/ahmetsuslu/sunupro'

const formatBytes = (n: number): string =>
  n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`

/** Ayarlar: genel, kısayollar, güncelleme, hakkında. Esc ile kapanır (kısayol yakalarken değil). */
export default function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('general')

  // Esc kapatır. Tuş yakalama sırasında ShortcutEditor olayı yakalama aşamasında durdurur, buraya ulaşmaz.
  // Sunum kısayolları ayarlar açıkken Shell tarafından devre dışı bırakılır.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" role="dialog" aria-modal="true">
        <nav className="settings__nav">
          <h2>Ayarlar</h2>
          {(
            [
              ['general', 'Genel'],
              ['shortcuts', 'Kısayollar'],
              ['updates', 'Güncelleme'],
              ['about', 'Hakkında']
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} className={`lib-nav ${tab === id ? 'lib-nav--active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Kapat <kbd>Esc</kbd>
          </button>
        </nav>
        <div className="settings__body">
          {tab === 'general' && <General />}
          {tab === 'shortcuts' && <ShortcutEditor />}
          {tab === 'updates' && <Updates />}
          {tab === 'about' && <About />}
        </div>
      </div>
    </div>
  )
}

function General(): React.JSX.Element {
  const s = useSettings()
  const [cache, setCache] = useState<{ bytes: number; presentations: number } | null>(null)
  useEffect(() => {
    window.api.cache.info().then(setCache)
  }, [])
  if (!s) return <div />

  return (
    <div className="settings__section">
      <h3>Sunum</h3>
      <label className="setting">
        <div>
          <strong>Sunum modu</strong>
          <span>Canlı mod animasyon, geçiş ve videoları PowerPoint ile oynatır. Görsel mod yedektir.</span>
        </div>
        <select
          className="input"
          value={s.showMode}
          onChange={(e) => updateSettings({ showMode: e.target.value as 'live' | 'image' })}
        >
          <option value="live">Canlı PowerPoint</option>
          <option value="image">Görsel (animasyonsuz)</option>
        </select>
      </label>
      <label className="setting">
        <div>
          <strong>Ara süresi</strong>
          <span>Ara modunda (A) seyirci ekranındaki geri sayımın başlangıcı.</span>
        </div>
        <select
          className="input"
          value={s.breakMinutes}
          onChange={(e) => updateSettings({ breakMinutes: Number(e.target.value) })}
        >
          {[5, 10, 15, 20, 30].map((m) => (
            <option key={m} value={m}>
              {m} dakika
            </option>
          ))}
        </select>
      </label>
      <label className="setting">
        <div>
          <strong>Çizimleri hatırla</strong>
          <span>Kalem ve vurgulayıcı çizimleri dosya bazında saklanır, sunu yeniden açılınca geri gelir.</span>
        </div>
        <input
          type="checkbox"
          className="toggle"
          checked={s.rememberInk}
          onChange={(e) => updateSettings({ rememberInk: e.target.checked })}
        />
      </label>
      <label className="setting">
        <div>
          <strong>Not yazı boyutu</strong>
          <span>Sunucu ekranındaki konuşmacı notları (sunum sırasında A− / A+ ile de değişir).</span>
        </div>
        <select
          className="input"
          value={s.notesFontSize}
          onChange={(e) => updateSettings({ notesFontSize: Number(e.target.value) })}
        >
          {[14, 16, 18, 20, 24, 28, 32, 40].map((n) => (
            <option key={n} value={n}>
              {n} px
            </option>
          ))}
        </select>
      </label>

      <h3>Önbellek</h3>
      <div className="setting">
        <div>
          <strong>Slayt görselleri</strong>
          <span>
            {cache
              ? `${cache.presentations} sunu · ${formatBytes(cache.bytes)}. Temizlenirse sunular bir sonraki açılışta yeniden hazırlanır.`
              : 'Hesaplanıyor…'}
          </span>
        </div>
        <button
          className="btn"
          disabled={!cache?.presentations}
          onClick={async () => {
            await window.api.cache.clear()
            setCache(await window.api.cache.info())
          }}
        >
          Önbelleği temizle
        </button>
      </div>
    </div>
  )
}

function Updates(): React.JSX.Element {
  const s = useSettings()
  const u = useUpdateState()
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.api.app.getVersion().then(setVersion)
  }, [])

  const status = ((): string => {
    switch (u.kind) {
      case 'checking':
        return 'Denetleniyor…'
      case 'none':
        return 'Sunu Pro güncel.'
      case 'downloading':
        return `Sunu Pro ${u.version} indiriliyor… %${u.progress}`
      case 'ready':
        return `Sunu Pro ${u.version} indirildi. Yeniden başlatınca kurulur.`
      case 'error':
        return `Denetlenemedi: ${u.message}`
      case 'dev':
        return 'Geliştirme sürümünde güncelleme denetlenmez.'
      default:
        return ''
    }
  })()

  return (
    <div className="settings__section">
      <h3>Güncelleme</h3>
      <div className="setting">
        <div>
          <strong>Yüklü sürüm: {version}</strong>
          <span>Yeni sürümler GitHub üzerinden yayınlanır, arka planda indirilir.</span>
        </div>
        {u.kind === 'ready' ? (
          <button className="btn btn--primary" onClick={() => window.api.updates.install()}>
            Yeniden başlat ve kur
          </button>
        ) : (
          <button className="btn" disabled={u.kind === 'checking' || u.kind === 'downloading'} onClick={checkForUpdates}>
            Güncellemeleri denetle
          </button>
        )}
      </div>
      {status && <div className="settings__status">{status}</div>}
      <label className="setting">
        <div>
          <strong>Açılışta otomatik denetle</strong>
          <span>Kapatılırsa güncellemeler yalnızca elle denetlenir.</span>
        </div>
        <input
          type="checkbox"
          className="toggle"
          checked={s?.autoUpdate ?? true}
          onChange={(e) => updateSettings({ autoUpdate: e.target.checked })}
        />
      </label>
    </div>
  )
}

function About(): React.JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.api.app.getVersion().then(setVersion)
  }, [])
  return (
    <div className="settings__section about">
      <div className="about__logo lib-brand__logo" />
      <h3>Sunu Pro {version}</h3>
      <p>
        Derslere göre düzenlenen, kaldığı yeri hatırlayan, dokunmatik işaretçili çift ekran PowerPoint sunum aracı.
      </p>
      <p className="hint">Geliştiren: Ahmet Süslü · Açık kaynak (MIT lisansı)</p>
      <div className="about__actions">
        <button className="btn" onClick={() => window.api.app.openExternal(REPO_URL)}>
          GitHub sayfası
        </button>
        <button className="btn" onClick={() => window.api.app.openExternal(`${REPO_URL}/issues`)}>
          Sorun bildir / öneri
        </button>
        <button className="btn" onClick={() => window.api.app.openLogs()}>
          Günlük klasörünü aç
        </button>
      </div>
    </div>
  )
}

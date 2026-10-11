import React from 'react'
import type { ActionId } from '@shared/shortcuts'
import type { InkPrefs } from '@shared/types'
import { COLOR_NAMES, HL_COLORS, HL_SIZES, PEN_COLORS, PEN_SIZES, type Tool } from '../lib/tools'
import { useKeyHint } from '../lib/use-shortcuts'

type Props = {
  running: boolean
  tool: Tool
  prefs: InkPrefs
  black: boolean
  white: boolean
  gridOpen: boolean
  canUndo: boolean
  canRedo: boolean
  canClear: boolean
  run: (action: ActionId) => void
  onPrefs: (patch: Partial<InkPrefs>) => void
}

const SIZE_NAMES = ['İnce', 'Orta', 'Kalın']

/** Alt araç çubuğu: gezinme, işaretleme araçları, renk/kalınlık, geri al, ekran. Dokunmatik dostu. */
export default function Toolbar(p: Props): React.JSX.Element {
  const hint = useKeyHint()

  const btn = (
    label: React.ReactNode,
    action: ActionId,
    opts: { active?: boolean; disabled?: boolean; title?: string; kbd?: boolean } = {}
  ): React.JSX.Element => {
    const key = hint(action)
    return (
      <button
        key={action}
        className={`btn btn--lg ${opts.active ? 'btn--active' : ''}`}
        disabled={opts.disabled}
        onClick={() => p.run(action)}
        title={[opts.title, key && `Kısayol: ${key}`].filter(Boolean).join(' · ') || undefined}
      >
        {label}
        {key && opts.kbd !== false && <kbd>{key}</kbd>}
      </button>
    )
  }

  const drawing = p.tool === 'pen' || p.tool === 'highlighter'
  const pen = p.tool === 'pen'
  const colors = pen ? PEN_COLORS : HL_COLORS
  const sizes = pen ? PEN_SIZES : HL_SIZES
  const color = pen ? p.prefs.penColor : p.prefs.hlColor
  const size = pen ? p.prefs.penSize : p.prefs.hlSize

  return (
    <footer className="toolbar">
      {btn('◀', 'prev', { title: 'Geri' })}
      {btn('▶', 'next', { title: 'İleri' })}
      <div className="sep" />
      {btn('Lazer', 'toolLaser', { active: p.tool === 'laser' })}
      {btn('Vurgu', 'toolHighlighter', { active: p.tool === 'highlighter', title: 'Vurgulayıcı' })}
      {btn('Kalem', 'toolPen', { active: p.tool === 'pen' })}
      {btn('Silgi', 'toolEraser', { active: p.tool === 'eraser', title: 'Dokunduğu çizgiyi siler' })}
      {drawing && (
        <div className="palette">
          {colors.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color ? 'swatch--active' : ''}`}
              style={{ ['--swatch' as string]: c }}
              title={COLOR_NAMES[c] ?? c}
              onClick={() => p.onPrefs(pen ? { penColor: c } : { hlColor: c })}
            />
          ))}
          <div className="palette__sep" />
          {sizes.map((_, i) => (
            <button
              key={i}
              className={`size-btn ${i === size ? 'size-btn--active' : ''}`}
              title={SIZE_NAMES[i]}
              onClick={() => p.onPrefs(pen ? { penSize: i } : { hlSize: i })}
            >
              <span
                className={pen ? 'size-btn__dot' : 'size-btn__bar'}
                style={{ ['--s' as string]: `${pen ? 4 + i * 4 : 6 + i * 5}px`, ['--swatch' as string]: color }}
              />
            </button>
          ))}
        </div>
      )}
      <div className="sep" />
      {/* Uzun tuş birleşimleri (Ctrl + Z) yalnızca ipucunda: çubuk tek satıra sığsın */}
      {btn('↶', 'undo', { disabled: !p.canUndo, title: 'Geri al', kbd: false })}
      {btn('↷', 'redo', { disabled: !p.canRedo, title: 'Yinele', kbd: false })}
      {btn('Temizle', 'clearSlide', { disabled: !p.canClear, title: 'Bu slayttaki çizimleri sil' })}
      <div className="sep" />
      {btn('Siyah', 'black', { active: p.black, disabled: !p.running })}
      {btn('Beyaz', 'white', { active: p.white, disabled: !p.running })}
      <div className="spacer" />
      {btn('Slaytlar', 'grid', { active: p.gridOpen })}
    </footer>
  )
}

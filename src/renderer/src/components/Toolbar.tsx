import React from 'react'
import type { ActionId } from '@shared/shortcuts'
import type { InkPrefs } from '@shared/types'
import { COLOR_NAMES, HL_COLORS, HL_SIZES, LASER_COLORS, LASER_SIZES, PEN_COLORS, PEN_SIZES, type Tool } from '../lib/tools'
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
const LASER_SIZE_NAMES = ['Küçük', 'Orta', 'Büyük']

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

  // Renk/kalınlık paleti: kalem, vurgulayıcı ve lazer için (her aracın son seçimi ayrı tutulur)
  const tool = p.tool
  const palette =
    tool === 'pen'
      ? { colors: PEN_COLORS, sizes: PEN_SIZES, color: p.prefs.penColor, size: p.prefs.penSize, kind: 'dot' }
      : tool === 'highlighter'
        ? { colors: HL_COLORS, sizes: HL_SIZES, color: p.prefs.hlColor, size: p.prefs.hlSize, kind: 'bar' }
        : tool === 'laser'
          ? { colors: LASER_COLORS, sizes: LASER_SIZES, color: p.prefs.laserColor, size: p.prefs.laserSize, kind: 'glow' }
          : null
  const setColor = (c: string): void =>
    p.onPrefs(tool === 'pen' ? { penColor: c } : tool === 'highlighter' ? { hlColor: c } : { laserColor: c })
  const setSize = (i: number): void =>
    p.onPrefs(tool === 'pen' ? { penSize: i } : tool === 'highlighter' ? { hlSize: i } : { laserSize: i })
  const sizePx = (i: number): number => (palette?.kind === 'bar' ? 6 + i * 5 : palette?.kind === 'glow' ? 6 + i * 5 : 4 + i * 4)

  return (
    <footer className="toolbar">
      {btn('◀', 'prev', { title: 'Geri' })}
      {btn('▶', 'next', { title: 'İleri' })}
      <div className="sep" />
      {btn('Lazer', 'toolLaser', { active: p.tool === 'laser' })}
      {btn('Vurgu', 'toolHighlighter', { active: p.tool === 'highlighter', title: 'Vurgulayıcı' })}
      {btn('Kalem', 'toolPen', { active: p.tool === 'pen' })}
      {btn('Silgi', 'toolEraser', { active: p.tool === 'eraser', title: 'Dokunduğu çizgiyi siler' })}
      {palette && (
        <div className="palette">
          {palette.colors.map((c) => (
            <button
              key={c}
              className={`swatch ${c === palette.color ? 'swatch--active' : ''}`}
              style={{ ['--swatch' as string]: c }}
              title={COLOR_NAMES[c] ?? c}
              onClick={() => setColor(c)}
            />
          ))}
          <div className="palette__sep" />
          {palette.sizes.map((_, i) => (
            <button
              key={i}
              className={`size-btn ${i === palette.size ? 'size-btn--active' : ''}`}
              title={tool === 'laser' ? LASER_SIZE_NAMES[i] : SIZE_NAMES[i]}
              onClick={() => setSize(i)}
            >
              <span
                className={`size-btn__${palette.kind}`}
                style={{ ['--s' as string]: `${sizePx(i)}px`, ['--swatch' as string]: palette.color }}
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

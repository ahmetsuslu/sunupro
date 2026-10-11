/**
 * Eylem kaydı: uygulamadaki her işlev kimlikli bir eylemdir; tuşlar eylemlere bağlanır.
 * Hiçbir tuş sabit kodlanmaz — varsayılanlar burada, kullanıcı atamaları ayarlarda tutulur.
 *
 * Tuş birleşimi biçimi: "Ctrl+Shift+Alt+<Tuş>" (değiştiriciler bu sırayla).
 * <Tuş>: harf/işaret büyük harfle ("B", "."), rakam ("1"; Numpad rakamları da "1"),
 * adlandırılmış tuşlar KeyboardEvent.key adıyla ("ArrowRight", "PageDown", "Delete", "F5"),
 * boşluk "Space".
 */

export type ActionId =
  | 'next'
  | 'prev'
  | 'nextSlide'
  | 'prevSlide'
  | 'first'
  | 'last'
  | 'grid'
  | 'toolLaser'
  | 'toolHighlighter'
  | 'toolPen'
  | 'toolEraser'
  | 'toolNone'
  | 'nextColor'
  | 'undo'
  | 'redo'
  | 'clearSlide'
  | 'clearAll'
  | 'black'
  | 'white'
  | 'break'
  | 'startShow'
  | 'startHere'
  | 'escape'

export type ActionCategory = 'nav' | 'tools' | 'draw' | 'screen'

export type ActionDef = {
  id: ActionId
  label: string
  category: ActionCategory
  defaults: string[]
  /** En az bir tuşu kalmak zorunda (kullanıcı kendini kilitlemesin) */
  required?: boolean
  /** Basılı tutunca tekrarlansın mı (ör. ileri/geri) */
  repeat?: boolean
}

export const CATEGORY_LABELS: Record<ActionCategory, string> = {
  nav: 'Gezinme',
  tools: 'Araçlar',
  draw: 'Çizim ve silme',
  screen: 'Ekran ve sunum'
}

export const ACTIONS: ActionDef[] = [
  { id: 'next', label: 'İleri (sıradaki adım / slayt)', category: 'nav', defaults: ['ArrowRight', 'ArrowDown', 'PageDown', 'Space', 'Enter'], repeat: true },
  { id: 'prev', label: 'Geri', category: 'nav', defaults: ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'], repeat: true },
  { id: 'nextSlide', label: 'Animasyonları atlayıp sonraki slayt', category: 'nav', defaults: ['Ctrl+ArrowRight'] },
  { id: 'prevSlide', label: 'Önceki slayt (baştan)', category: 'nav', defaults: ['Ctrl+ArrowLeft'] },
  { id: 'first', label: 'İlk slayt', category: 'nav', defaults: ['Home'] },
  { id: 'last', label: 'Son slayt', category: 'nav', defaults: ['End'] },
  { id: 'grid', label: 'Slayt ızgarası', category: 'nav', defaults: ['G'] },

  { id: 'toolLaser', label: 'Lazer işaretçi', category: 'tools', defaults: ['1'] },
  { id: 'toolHighlighter', label: 'Vurgulayıcı', category: 'tools', defaults: ['2'] },
  { id: 'toolPen', label: 'Kalem', category: 'tools', defaults: ['3'] },
  { id: 'toolEraser', label: 'Silgi aracı', category: 'tools', defaults: ['4'] },
  { id: 'toolNone', label: 'Aracı bırak (normal imleç)', category: 'tools', defaults: ['0'] },
  { id: 'nextColor', label: 'Sonraki renk', category: 'tools', defaults: ['R'] },

  { id: 'undo', label: 'Geri al', category: 'draw', defaults: ['Ctrl+Z'] },
  { id: 'redo', label: 'Yinele', category: 'draw', defaults: ['Ctrl+Y'] },
  { id: 'clearSlide', label: 'Bu slayttaki çizimleri sil', category: 'draw', defaults: ['C', 'Delete'] },
  { id: 'clearAll', label: 'Tüm slaytlardaki çizimleri sil', category: 'draw', defaults: ['Shift+Delete'] },

  { id: 'black', label: 'Siyah ekran (aç/kapa)', category: 'screen', defaults: ['B', '.'] },
  { id: 'white', label: 'Beyaz ekran (aç/kapa)', category: 'screen', defaults: ['W', ','] },
  { id: 'break', label: 'Ara modu', category: 'screen', defaults: ['A'] },
  { id: 'startShow', label: 'Sunumu baştan başlat', category: 'screen', defaults: ['F5'] },
  { id: 'startHere', label: 'Sunumu bu slayttan başlat', category: 'screen', defaults: ['Shift+F5'] },
  { id: 'escape', label: 'Aracı bırak; araç yoksa sunumu bitir', category: 'screen', defaults: ['Escape'], required: true }
]

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<ActionId, ActionDef>

/** Kullanıcı atamaları: yalnızca varsayılandan farklı olan eylemler saklanır. */
export type ShortcutOverrides = Partial<Record<ActionId, string[]>>

export function bindingsFor(id: ActionId, overrides: ShortcutOverrides): string[] {
  return overrides[id] ?? ACTION_BY_ID[id].defaults
}

/** Tuş birleşimi → eylem eşlemesi. Çakışmada listede önce gelen eylem kazanır. */
export function buildKeymap(overrides: ShortcutOverrides): Map<string, ActionId> {
  const map = new Map<string, ActionId>()
  for (const a of ACTIONS) {
    for (const combo of bindingsFor(a.id, overrides)) {
      if (!map.has(combo)) map.set(combo, a.id)
    }
  }
  return map
}

type KeyLike = {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'Dead', 'Unidentified'])

/** Klavye olayından tuş birleşimi; yalnızca değiştirici tuşa basıldıysa null. */
export function comboFromEvent(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  let key: string
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (/^Numpad\d$/.test(e.code) && /^\d$/.test(e.key)) key = e.code.slice(6)
  else if (e.key === ' ') key = 'Space'
  else if (e.key.length === 1) key = e.key.toUpperCase()
  else key = e.key
  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl')
  if (e.shiftKey) mods.push('Shift')
  if (e.altKey) mods.push('Alt')
  return [...mods, key].join('+')
}

const KEY_LABELS: Record<string, string> = {
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageDown: 'Sayfa Aşağı',
  PageUp: 'Sayfa Yukarı',
  Space: 'Boşluk',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Geri Sil',
  Delete: 'Del',
  Home: 'Home',
  End: 'End',
  Tab: 'Tab'
}

/** Ekranda gösterilecek tuş adı: "Ctrl+ArrowRight" → "Ctrl + →" */
export function formatCombo(combo: string): string {
  // Tuşun kendisi "+" olabilir ("Shift++"), bu yüzden düz split yerine değiştiricileri ayıkla
  const m = /^((?:(?:Ctrl|Shift|Alt)\+)*)(.+)$/.exec(combo)
  if (!m) return combo
  const mods = m[1] ? m[1].slice(0, -1).split('+') : []
  return [...mods, KEY_LABELS[m[2]] ?? m[2]].join(' + ')
}

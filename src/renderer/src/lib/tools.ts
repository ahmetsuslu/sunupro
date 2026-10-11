/** Sunucu ekranındaki işaretleme aracı */
export type Tool = 'none' | 'laser' | 'highlighter' | 'pen' | 'eraser'

export const PEN_COLORS = ['#e53935', '#1e88e5', '#43a047', '#111111', '#ffffff', '#fb8c00']
export const HL_COLORS = ['#ffeb3b', '#76ff03', '#ff4fa3', '#40c4ff']

export const COLOR_NAMES: Record<string, string> = {
  '#e53935': 'Kırmızı',
  '#1e88e5': 'Mavi',
  '#43a047': 'Yeşil',
  '#111111': 'Siyah',
  '#ffffff': 'Beyaz',
  '#fb8c00': 'Turuncu',
  '#ffeb3b': 'Sarı',
  '#76ff03': 'Fosforlu yeşil',
  '#ff4fa3': 'Pembe',
  '#40c4ff': 'Açık mavi'
}

/** Kalınlıklar slayt yüksekliğine oranla (ince / orta / kalın) */
export const PEN_SIZES = [0.004, 0.007, 0.012]
export const HL_SIZES = [0.022, 0.034, 0.05]

/** Silginin yarıçapı, slayt yüksekliğine oranla */
export const ERASER_RADIUS = 0.022

export const HIGHLIGHTER_ALPHA = 0.5

export const isDrawingTool = (t: Tool): t is 'pen' | 'highlighter' => t === 'pen' || t === 'highlighter'

// main, preload ve renderer arasında paylaşılan tipler
import type { ShortcutOverrides } from './shortcuts'

export type SlideInfo = {
  index: number
  title: string
  notes: string
  hidden: boolean
  /** Tıklamayla tetiklenen animasyon adımı sayısı */
  clicks: number
}

export type PresentationInfo = {
  path: string
  name: string
  slideCount: number
  widthPt: number
  heightPt: number
  /** Gösterideki son görünür (gizli olmayan) slayt */
  lastVisible: number
  slides: SlideInfo[]
  /** Önizleme görselleri: sunu://cache/<anahtar>/slide-001.png, thumb-001.png */
  cacheKey: string
  /** Dosya PowerPoint'te açık olduğu için kaydedilmiş hâlinin kopyası kullanılıyor */
  openedCopy: boolean
}

/** PowerPoint SlideShowView.State */
export const ShowScreen = {
  Running: 1,
  Paused: 2,
  Black: 3,
  White: 4,
  Done: 5
} as const
export type ShowScreen = (typeof ShowScreen)[keyof typeof ShowScreen]

/** live: PowerPoint gösterisi (animasyonlu) · image: önizleme görselleri (animasyonsuz yedek) */
export type ShowMode = 'live' | 'image'

export type ShowState = {
  running: boolean
  mode?: ShowMode
  /** Tek ekranda: seyirci görünümü ayrı bir pencerede (test modu) */
  windowed?: boolean
  /** Seyirci ekranı bağlantısı koptu; geri takılınca gösteri kaldığı yerden sürer */
  detached?: boolean
  slide?: number
  click?: number
  clickCount?: number
  state?: ShowScreen
  slideCount?: number
  hwnd?: number
  /** Son slaytın son adımında ileri denendi (gösteri sonu ekranına düşülmedi) */
  atEnd?: boolean
}

/** Seyirci penceresinin ihtiyaç duyduğu sunu bilgisi (main → katman) */
export type AudienceConfig = {
  mode: ShowMode
  windowed: boolean
  aspect: number
  cacheKey: string
}

export type InkKind = 'pen' | 'highlighter'
/** [x, y, basınç] — x, y slayta göre 0..1 */
export type InkPoint = [number, number, number]
export type InkStroke = {
  id: string
  /** Oluşturulma sırası: geri alınan çizgiler eski yerine (z-sırası) döner */
  seq: number
  kind: InkKind
  color: string
  /** Kalınlık, slayt yüksekliğine oranla */
  size: number
  /** Basınç yok (fare/parmak): hızdan benzetilir */
  simulate: boolean
  points: InkPoint[]
}
/** Slayt numarası → o slayttaki çizimler */
export type InkMap = Record<number, InkStroke[]>

/** presenter → katman (MessagePort) mesajları. Koordinatlar slayta göre 0..1. */
export type OverlayMsg =
  | { t: 'laser'; x: number; y: number }
  | { t: 'laser-off' }
  /** Tüm çizimler (bağlantı kurulunca / tümü silinince) */
  | { t: 'ink-all'; ink: InkMap }
  /** Bir slaytın çizimleri değişti; listedeki kimlikler canlı çizgilerden düşülür */
  | { t: 'ink-slide'; slide: number; strokes: InkStroke[] }
  /** Çizilmekte olan çizgi: başlangıç, yeni noktalar, iptal */
  | { t: 'live-begin'; slide: number; stroke: InkStroke }
  | { t: 'live-pts'; id: string; points: InkPoint[] }
  | { t: 'live-cancel'; id: string }

export type InkPrefs = {
  penColor: string
  /** PEN_SIZES içindeki sıra */
  penSize: number
  hlColor: string
  hlSize: number
}

export type DisplayInfo = {
  id: number
  label: string
  width: number
  height: number
  scaleFactor: number
  primary: boolean
  audience: boolean
}

export type Settings = {
  /** Seyirci (projeksiyon) ekranı; null → birincil olmayan ilk ekran */
  audienceDisplayId: number | null
  showMode: ShowMode
  notesFontSize: number
  /** Yalnızca varsayılandan farklı atanmış eylemler */
  shortcuts: ShortcutOverrides
  /** Kalem/vurgulayıcı renk ve kalınlık seçimi (son kullanılan) */
  ink: InkPrefs
  autoUpdate: boolean
}

/** IPC sonucu: hatalar kullanıcıya gösterilecek Türkçe mesajla döner */
export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

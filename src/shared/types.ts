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
  /** Bu sunuda en son kalınan yer (yoksa null) */
  session: FileSession | null
  /** Prova: sunu oynatılır ama kaldığın yer ve sunuldu işareti değişmez, çizimler saklanmaz */
  rehearsal: boolean
}

/** Kaldığın yerden devam: dosya başına son konum */
export type FileSession = {
  slide: number
  click: number
  slideCount: number
  updatedAt: number
}

export type Course = {
  id: string
  name: string
  color: string
  /** Bağlı klasör: içindeki sunular derse otomatik eklenir */
  folder: string | null
  /** Sıralı dosya yolları */
  files: string[]
  createdAt: number
  /** Sınıfı (Timetable.levels); varsa dersin rengi sınıfın rengidir */
  levelId?: string | null
  /** Bağlı klasörde durduğu hâlde kullanıcının listeden çıkardığı sunular (taramada geri eklenmez) */
  excluded?: string[]
}

/** Ders saati (okulun zil saatleri), ör. 08:30–09:20 */
export type Period = { start: string; end: string }

/** Sınıf / dönem: ad ve renk kullanıcı tanımlı (ör. "1. sınıf" yeşil, "Dönem 3" mor) */
export type ClassLevel = { id: string; name: string; color: string }

/** Haftalık programda bir ders: gün (1 = Pazartesi … 7 = Pazar), ders saatleri from–to (0'dan, dahil) */
export type ScheduleSlot = { id: string; courseId: string; day: number; from: number; to: number; room: string }

export type Timetable = {
  /** ör. 2026-2027 Güz */
  title: string
  /** Programda gösterilen günler (1 = Pazartesi … 7 = Pazar) */
  days: number[]
  periods: Period[]
  levels: ClassLevel[]
  slots: ScheduleSlot[]
}

export type FileStatus = 'ready' | 'pending' | 'preparing' | 'missing' | 'error'

export type LibraryFile = {
  path: string
  name: string
  status: FileStatus
  /** Hazırlama hatası (status = error) */
  error?: string
  session: FileSession | null
  /** Sunuldu olarak işaretlendiği zaman (elle ya da son slayta gelince); işaretsizse null */
  presentedAt: number | null
  /** Bağlı klasörden geldi */
  fromFolder: boolean
}

export type LibraryCourse = Omit<Course, 'files'> & {
  items: LibraryFile[]
  /** Bağlı klasöre ulaşılamıyor (ör. çıkarılmış USB bellek) */
  folderMissing: boolean
}

export type LibraryView = {
  courses: LibraryCourse[]
  /** Haftalık ders programı */
  timetable: Timetable
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
  /** size: nokta yarıçapı, slayt yüksekliğine oranla */
  | { t: 'laser'; x: number; y: number; color: string; size: number }
  | { t: 'laser-off' }
  /** Fare imleci (araç seçili değilken): seyirci ekranında ok olarak gösterilir */
  | { t: 'pointer'; x: number; y: number }
  | { t: 'pointer-off' }
  /** Tüm çizimler (bağlantı kurulunca / tümü silinince) */
  | { t: 'ink-all'; ink: InkMap }
  /** Bir slaytın çizimleri değişti; listedeki kimlikler canlı çizgilerden düşülür */
  | { t: 'ink-slide'; slide: number; strokes: InkStroke[] }
  /** Çizilmekte olan çizgi: başlangıç, yeni noktalar, iptal */
  | { t: 'live-begin'; slide: number; stroke: InkStroke }
  | { t: 'live-pts'; id: string; points: InkPoint[] }
  | { t: 'live-cancel'; id: string }
  /** Ara modu: seyirci ekranında geri sayım (until: bitiş zamanı, ms) ya da kapat (null) */
  | { t: 'break'; until: number | null }
  /** Yakınlaştırma görünümü (sunucuda iki parmakla / Ctrl+tekerlek) */
  | ({ t: 'view' } & ZoomViewState)

/**
 * Yakınlaştırma: s ölçek (1 = tüm slayt), (cx, cy) görünen bölgenin merkezi (slayta göre 0..1).
 * Slayt noktası (x, y) ekranda (0.5 + (x - cx)·s, 0.5 + (y - cy)·s) konumuna düşer.
 */
export type ZoomViewState = { s: number; cx: number; cy: number }

export type InkPrefs = {
  penColor: string
  /** PEN_SIZES içindeki sıra */
  penSize: number
  hlColor: string
  hlSize: number
  laserColor: string
  /** LASER_SIZES içindeki sıra */
  laserSize: number
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
  /** Ara modunun varsayılan süresi (dakika) */
  breakMinutes: number
  /** Çizimleri dosya bazında sakla ve sunu yeniden açılınca geri getir */
  rememberInk: boolean
  /** Fare tekerleği: aşağı → sonraki, yukarı → önceki */
  wheelNavigation: boolean
  /** Araç seçili değilken sunucudaki fare imleci seyirci ekranında ok olarak görünür */
  mirrorPointer: boolean
  autoUpdate: boolean
}

/** IPC sonucu: hatalar kullanıcıya gösterilecek Türkçe mesajla döner */
export type Result<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

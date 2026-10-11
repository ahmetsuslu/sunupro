import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { JsonFile } from './json-file'
import { forgetRecent, getSession, loadInk, presentedAt, recentFiles, saveInk, setPresented } from './sessions'
import { friendlyError, isPrepared, show } from './show'
import type { Course, FileStatus, InkMap, LibraryCourse, LibraryFile, LibraryView } from '../shared/types'

const PPT_FILE = /\.(pptx|pptm|ppsx|ppsm|ppt|pps)$/i
// Office'in açık belgeler için bıraktığı kilit dosyaları (~$ad.pptx)
const isLockFile = (name: string): boolean => name.startsWith('~$')

const sameFile = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' })

const store = new JsonFile<{ courses: Course[] }>('library.json', () => ({ courses: [] }))

function courses(): Course[] {
  return store.get().courses
}

function saveCourses(list: Course[]): void {
  store.set({ courses: list })
}

function updateCourse(id: string, fn: (c: Course) => Course): void {
  saveCourses(courses().map((c) => (c.id === id ? fn(c) : c)))
}

/** Bağlı klasörü tarar: yeni sunular sona (doğal sıralı) eklenir, klasörden silinenler çıkarılır. */
function syncFolder(c: Course): Course {
  if (!c.folder || !existsSync(c.folder)) return c
  let names: string[]
  try {
    names = readdirSync(c.folder).filter((n) => PPT_FILE.test(n) && !isLockFile(n))
  } catch {
    return c
  }
  const inFolder = names.sort(collator.compare).map((n) => join(c.folder!, n))
  const kept = c.files.filter((f) => !sameFile(dirname(f), c.folder!) || inFolder.some((p) => sameFile(p, f)))
  const added = inFolder.filter((p) => !kept.some((f) => sameFile(f, p)))
  if (!added.length && kept.length === c.files.length) return c
  return { ...c, files: [...kept, ...added] }
}

// ---------- Arka planda ön hazırlık ----------

/**
 * Kütüphanedeki sunuları boşta iken sırayla hazırlar (slayt görselleri + notlar), böylece ders
 * anında açılış anlık olur. Sunucu ekranı bir sunu açarken duraklar, kapanınca devam eder.
 */
class Preparer {
  private queue: string[] = []
  private current: { path: string; done: Promise<void> } | null = null
  private paused = false
  private errors = new Map<string, string>()

  constructor(private notify: () => void) {}

  status(path: string): { status: FileStatus; error?: string } {
    if (!existsSync(path)) return { status: 'missing' }
    if (this.current && sameFile(this.current.path, path)) return { status: 'preparing' }
    const err = this.errors.get(path.toLowerCase())
    if (err) return { status: 'error', error: err }
    if (isPrepared(path)) return { status: 'ready' }
    return { status: 'pending' }
  }

  enqueue(paths: string[]): void {
    for (const p of paths) {
      if (!existsSync(p) || this.errors.has(p.toLowerCase())) continue
      if (this.queue.some((q) => sameFile(q, p)) || (this.current && sameFile(this.current.path, p))) continue
      if (!isPrepared(p)) this.queue.push(p)
    }
    this.kick()
  }

  /** Hatalı dosyayı yeniden denemeye aç (ör. kullanıcı parolayı kaldırdı) */
  retry(path: string): void {
    this.errors.delete(path.toLowerCase())
    this.enqueue([path])
  }

  async pause(): Promise<void> {
    this.paused = true
    await this.current?.done
  }

  resume(): void {
    this.paused = false
    this.kick()
  }

  private kick(): void {
    if (this.paused || this.current) return
    const path = this.queue.shift()
    if (!path) return
    const done = show
      .prepare(path)
      .catch((err) => {
        this.errors.set(path.toLowerCase(), friendlyError(err).message)
      })
      .finally(() => {
        this.current = null
        this.notify()
        this.kick()
      })
    this.current = { path, done }
    this.notify()
  }
}

let preparer: Preparer

function toFile(path: string, fromFolder: boolean): LibraryFile {
  return {
    path,
    name: basename(path),
    ...preparer.status(path),
    session: getSession(path),
    presentedAt: presentedAt(path),
    fromFolder
  }
}

/** Kütüphanenin arayüze giden görünümü (klasörler taranır, durumlar hesaplanır). */
export function libraryView(): LibraryView {
  const synced = courses().map(syncFolder)
  if (synced.some((c, i) => c !== courses()[i])) saveCourses(synced)
  const list: LibraryCourse[] = synced.map(({ files, ...c }) => ({
    ...c,
    folderMissing: !!c.folder && !existsSync(c.folder),
    items: files.map((f) => toFile(f, !!c.folder && sameFile(dirname(f), c.folder)))
  }))
  const recent = recentFiles()
    .filter((p) => existsSync(p))
    .map((p) => {
      const course = list.find((c) => c.items.some((i) => sameFile(i.path, p)))
      return { ...toFile(p, false), courseId: course?.id ?? null, courseName: course?.name ?? null }
    })
  return { courses: list, recent }
}

function allFiles(): string[] {
  return courses().flatMap((c) => syncFolder(c).files)
}

async function pickFiles(): Promise<string[]> {
  const res = await dialog.showOpenDialog({
    title: 'Derse sunu ekle',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PowerPoint', extensions: ['pptx', 'ppt', 'pptm', 'ppsx', 'pps', 'ppsm'] }]
  })
  return res.canceled ? [] : res.filePaths
}

export function registerLibrary(getMain: () => BrowserWindow | null): void {
  let notifyTimer: NodeJS.Timeout | null = null
  const notify = (): void => {
    // Hazırlık ilerledikçe arayüzü güncelle (art arda olayları birleştir)
    if (notifyTimer) return
    notifyTimer = setTimeout(() => {
      notifyTimer = null
      getMain()?.webContents.send('library:changed', libraryView())
    }, 150)
  }
  preparer = new Preparer(notify)
  show.hooks = {
    beforeOpen: () => preparer.pause(),
    afterClose: () => preparer.resume()
  }

  const view = (): LibraryView => {
    preparer.enqueue(allFiles())
    return libraryView()
  }

  ipcMain.handle('library:get', () => view())

  ipcMain.handle('library:create-course', (_e, name: string, color: string) => {
    saveCourses([...courses(), { id: randomUUID(), name: name.trim() || 'Yeni ders', color, folder: null, files: [], createdAt: Date.now() }])
    return view()
  })

  ipcMain.handle('library:update-course', (_e, id: string, patch: { name?: string; color?: string }) => {
    updateCourse(id, (c) => ({ ...c, ...(patch.name != null ? { name: patch.name.trim() || c.name } : {}), ...(patch.color ? { color: patch.color } : {}) }))
    return view()
  })

  ipcMain.handle('library:delete-course', (_e, id: string) => {
    saveCourses(courses().filter((c) => c.id !== id))
    return view()
  })

  // Sürükle-bırakta klasör de gelebilir: ilk klasör derse bağlanır, sunular listeye eklenir
  ipcMain.handle('library:add-files', async (_e, id: string, paths?: string[]) => {
    const input = paths?.length ? paths : await pickFiles()
    const folder = input.find((p) => {
      try {
        return statSync(p).isDirectory()
      } catch {
        return false
      }
    })
    const list = input.filter((p) => PPT_FILE.test(p) && existsSync(p))
    updateCourse(id, (c) =>
      syncFolder({
        ...c,
        folder: folder ?? c.folder,
        files: [...c.files, ...list.filter((p) => !c.files.some((f) => sameFile(f, p)))]
      })
    )
    return view()
  })

  ipcMain.handle('library:link-folder', async (_e, id: string) => {
    const res = await dialog.showOpenDialog({ title: 'Ders klasörünü seç', properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return view()
    const folder = res.filePaths[0]
    updateCourse(id, (c) => syncFolder({ ...c, folder }))
    return view()
  })

  ipcMain.handle('library:unlink-folder', (_e, id: string) => {
    // Klasörden gelen dosyalar listede kalır, yalnızca otomatik eşitleme durur
    updateCourse(id, (c) => ({ ...c, folder: null }))
    return view()
  })

  ipcMain.handle('library:remove-file', (_e, id: string, path: string) => {
    updateCourse(id, (c) => ({ ...c, files: c.files.filter((f) => !sameFile(f, path)) }))
    return view()
  })

  // Sürükle-bırak sıralama: dosya delta kadar yukarı/aşağı taşınır, aradakiler bir kayar
  ipcMain.handle('library:move-file', (_e, id: string, path: string, delta: number) => {
    updateCourse(id, (c) => {
      const i = c.files.findIndex((f) => sameFile(f, path))
      const j = i + delta
      if (i < 0 || j < 0 || j >= c.files.length || j === i) return c
      const files = [...c.files]
      files.splice(j, 0, ...files.splice(i, 1))
      return { ...c, files }
    })
    return view()
  })

  ipcMain.handle('library:retry', (_e, path: string) => {
    preparer.retry(path)
    return view()
  })

  ipcMain.handle('library:forget-recent', (_e, path: string) => {
    forgetRecent(path)
    return view()
  })

  ipcMain.handle('library:set-presented', (_e, paths: string[], on: boolean) => {
    setPresented(paths, on)
    return view()
  })

  ipcMain.handle('ink:load', (_e, path: string): InkMap | null => loadInk(path))
  ipcMain.handle('ink:save', (_e, path: string, ink: InkMap) => saveInk(path, ink))
}

export function flushLibrary(): void {
  store.flush()
}

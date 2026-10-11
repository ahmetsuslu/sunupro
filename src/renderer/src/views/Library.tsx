import React, { useEffect, useState } from 'react'
import type { LibraryCourse, LibraryFile, LibraryView } from '@shared/types'
import CourseDialog from '../components/CourseDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import { timeAgo } from '../lib/time'
import { useDragReorder } from '../lib/use-drag-reorder'
import UpdateBanner from '../components/UpdateBanner'
import TimetableView from '../components/TimetableView'
import { DAY_NAMES, DAY_SHORT, isoDay } from '@shared/timetable'
import {
  courseColor,
  courseSlots,
  levelName,
  nextDayEntry,
  nextPresentation,
  sidebarGroups,
  slotTime,
  todayEntries,
  useNow,
  type TodayEntry
} from '../lib/schedule'

type Props = {
  onOpen: (path: string) => void
  onSettings: () => void
  /** Açılış hatası (Shell'den) */
  error: string | null
  onDismissError: () => void
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; course: LibraryCourse }
  | { kind: 'delete'; course: LibraryCourse }
  | null

const STATUS_LABEL: Record<LibraryFile['status'], string> = {
  ready: 'Hazır',
  pending: 'Sırada',
  preparing: 'Hazırlanıyor…',
  missing: 'Bulunamadı',
  error: 'Açılamadı'
}

/** Ana ekran: dersler, kaldığın yerden devam, son açılanlar. */
export default function Library({ onOpen, onSettings, error, onDismissError }: Props): React.JSX.Element {
  const [view, setView] = useState<LibraryView | null>(null)
  const [selected, setSelected] = useState<string | null>(null) // null → ana sayfa
  const [timetableOpen, setTimetableOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dragging, setDragging] = useState(false)
  const now = useNow()
  const openCourse = (id: string | null): void => {
    setSelected(id)
    setTimetableOpen(false)
  }
  const openTimetable = (): void => {
    setSelected(null)
    setTimetableOpen(true)
  }

  useEffect(() => {
    window.api.library.get().then(setView)
    return window.api.library.onChange(setView)
  }, [])

  const course = view?.courses.find((c) => c.id === selected) ?? null
  useEffect(() => {
    if (selected && view && !course) setSelected(null) // ders silindi
  }, [selected, view, course])

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => window.api.files.getPathForFile(f))
    if (!paths.length) return
    // Ders açıkken: sunular derse eklenir, bırakılan klasör derse bağlanır
    if (course) setView(await window.api.library.addFiles(course.id, paths))
    else {
      const ppt = paths.find((p) => /\.(pptx|pptm|ppsx|ppsm|ppt|pps)$/i.test(p))
      if (ppt) onOpen(ppt)
    }
  }

  const quickOpen = async (): Promise<void> => {
    const path = await window.api.show.pickFile()
    if (path) onOpen(path)
  }

  // Derste sıradaki sunu: sunulmamış ilk dosya
  const nextPath = course?.items.find((f) => !f.presentedAt && f.status !== 'missing')?.path ?? null
  const doneCount = course?.items.filter((f) => f.presentedAt).length ?? 0

  // Tutamaçtan sürükleyerek sıralama: yeni sıra hemen gösterilir, kayıt ardından gelir
  const reorder = useDragReorder(course?.items.length ?? 0, (from, to) => {
    if (!course) return
    const path = course.items[from].path
    setView((v) =>
      v && {
        ...v,
        courses: v.courses.map((c) => {
          if (c.id !== course.id) return c
          const items = [...c.items]
          items.splice(to, 0, ...items.splice(from, 1))
          return { ...c, items }
        })
      }
    )
    window.api.library.moveFile(course.id, path, to - from).then(setView)
  })

  return (
    <div
      className={`library ${dragging ? 'library--drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <aside className="lib-side">
        <div className="lib-brand">
          <span className="lib-brand__logo" />
          Sunu Pro
        </div>
        <button
          className={`lib-nav ${selected === null && !timetableOpen ? 'lib-nav--active' : ''}`}
          onClick={() => openCourse(null)}
        >
          Ana sayfa
        </button>
        <button className={`lib-nav ${timetableOpen ? 'lib-nav--active' : ''}`} onClick={openTimetable}>
          Ders programı
        </button>
        <div className="lib-courses">
          {view &&
            sidebarGroups(view, now).map((g) => (
              <React.Fragment key={g.title}>
                <div className={`lib-side__title ${g.today ? 'lib-side__title--today' : ''}`}>
                  {g.title}
                  {g.today && <span> · bugün</span>}
                </div>
                {g.entries.map(({ key, course: c, sub }) => (
                  <button
                    key={key}
                    className={`lib-nav ${selected === c.id ? 'lib-nav--active' : ''}`}
                    onClick={() => openCourse(c.id)}
                  >
                    <span className="dot" style={{ background: courseColor(c, view.timetable) }} />
                    <span className="lib-nav__name">
                      {c.name}
                      {sub && <small>{sub}</small>}
                    </span>
                    <span className="lib-nav__count">{c.items.length}</span>
                  </button>
                ))}
              </React.Fragment>
            ))}
          {view && !view.courses.length && <div className="hint lib-side__empty">Henüz ders yok.</div>}
        </div>
        <button className="btn lib-side__add" onClick={() => setDialog({ kind: 'create' })}>
          + Yeni ders
        </button>
        <button className="btn lib-side__settings" onClick={onSettings}>
          Ayarlar
        </button>
      </aside>

      <main className="lib-main" data-reorder-scroll>
        <UpdateBanner />
        {error && (
          <div className="banner banner--error lib-banner">
            <span>{error}</span>
            <div className="spacer" />
            <button className="icon-btn" onClick={onDismissError} title="Kapat">
              ✕
            </button>
          </div>
        )}

        {timetableOpen && view && <TimetableView view={view} setView={setView} onOpenCourse={(id) => openCourse(id)} />}

        {!course && !timetableOpen && (
          <div className="lib-home">
            <div className="lib-head">
              <h1>Merhaba</h1>
              <div className="spacer" />
              <button className="btn btn--lg" onClick={quickOpen}>
                Sunu aç…
              </button>
            </div>

            {/* Ana sayfada yalnızca günün dersleri ve sunuları; program yoksa nasıl başlanacağı */}
            {view && view.timetable.slots.length > 0 && (
              <TodayPanel view={view} now={now} onOpen={onOpen} onCourse={(id) => openCourse(id)} />
            )}
            {view && !view.courses.length && (
              <section className="lib-empty">
                <h2>Derslerini ekle, programını oluştur</h2>
                <p>
                  Soldan bir ders oluştur ve sunularını ekle ya da ders klasörünü bağla. Ders programını oluşturduğunda
                  bugünün dersleri ve sıradaki sunuları burada görünür.
                </p>
                <div className="lib-empty__actions">
                  <button className="btn btn--primary btn--lg" onClick={() => setDialog({ kind: 'create' })}>
                    + İlk dersini oluştur
                  </button>
                  <button className="btn btn--lg" onClick={quickOpen}>
                    Sunu aç…
                  </button>
                </div>
                <p className="hint">PowerPoint dosyasını bu pencereye sürükleyip bırakarak da açabilirsin.</p>
              </section>
            )}
            {view && !!view.courses.length && !view.timetable.slots.length && (
              <section className="lib-empty">
                <h2>Ders programını oluştur</h2>
                <p>Derslerini haftalık programa yerleştirdiğinde bugünün dersleri ve sıradaki sunuları burada görünür.</p>
                <div className="lib-empty__actions">
                  <button className="btn btn--primary btn--lg" onClick={openTimetable}>
                    Ders programını aç
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {course && (
          <div className="lib-course">
            <div className="lib-head">
              <span className="dot dot--lg" style={{ background: view ? courseColor(course, view.timetable) : course.color }} />
              <h1>{course.name}</h1>
              <button className="icon-btn" title="Dersi düzenle" onClick={() => setDialog({ kind: 'edit', course })}>
                ✎
              </button>
              {!!course.items.length && (
                <span className="lib-head__count">
                  {doneCount} / {course.items.length} sunuldu
                </span>
              )}
              <div className="spacer" />
              <button className="btn btn--lg" onClick={async () => setView(await window.api.library.addFiles(course.id))}>
                + Sunu ekle
              </button>
              <button className="btn btn--lg" onClick={async () => setView(await window.api.library.linkFolder(course.id))}>
                {course.folder ? 'Klasörü değiştir' : 'Klasör bağla'}
              </button>
            </div>

            {view && <CourseMeta view={view} course={course} onEdit={openTimetable} />}

            {course.folder && (
              <div className={`folder-chip ${course.folderMissing ? 'folder-chip--missing' : ''}`}>
                <span>
                  {course.folderMissing ? 'Klasöre ulaşılamıyor: ' : 'Bağlı klasör: '}
                  <strong>{course.folder}</strong>
                  {!course.folderMissing && ' — yeni eklenen sunular otomatik listelenir'}
                </span>
                <button
                  className="icon-btn"
                  title="Klasör bağlantısını kaldır (dosyalar listede kalır)"
                  onClick={async () => setView(await window.api.library.unlinkFolder(course.id))}
                >
                  ✕
                </button>
              </div>
            )}

            {course.items.length ? (
              <div className={`file-list ${reorder.dragging !== null ? 'file-list--dragging' : ''}`}>
                {course.items.map((f, i) => (
                  <FileRow
                    key={f.path}
                    file={f}
                    index={i + 1}
                    next={f.path === nextPath}
                    handle={reorder.handleProps(i)}
                    dragging={reorder.dragging === i}
                    style={reorder.rowStyle(i)}
                    onOpen={() => onOpen(f.path)}
                    onRetry={async () => setView(await window.api.library.retry(f.path))}
                    actions={
                      <>
                        <button
                          className={`icon-btn ${f.presentedAt ? 'icon-btn--done' : ''}`}
                          aria-pressed={!!f.presentedAt}
                          title={
                            f.presentedAt
                              ? 'Sunulmadı olarak işaretle'
                              : 'Sunuldu olarak işaretle (Shift: üsttekilerle birlikte)'
                          }
                          onClick={async (e) => {
                            e.stopPropagation()
                            // Shift ile: bu ve üstündeki tüm sunular (ör. "ilk 3 hafta bitti")
                            const paths = e.shiftKey && !f.presentedAt ? course.items.slice(0, i + 1).map((x) => x.path) : [f.path]
                            setView(await window.api.library.setPresented(paths, !f.presentedAt))
                          }}
                        >
                          ✓
                        </button>
                        <button
                          className="icon-btn"
                          title="Dersten çıkar (dosya silinmez)"
                          onClick={async (e) => {
                            e.stopPropagation()
                            setView(await window.api.library.removeFile(course.id, f.path))
                          }}
                        >
                          ✕
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="lib-drop">
                Bu derste henüz sunu yok.
                <br />
                <span className="hint">PowerPoint dosyalarını buraya sürükle, "Sunu ekle" ile seç ya da ders klasörünü bağla.</span>
              </div>
            )}

            <div className="lib-course__footer">
              <button className="btn btn--danger" onClick={() => setDialog({ kind: 'delete', course })}>
                Dersi sil
              </button>
            </div>
          </div>
        )}
      </main>

      {dialog?.kind === 'create' && (
        <CourseDialog
          title="Yeni ders"
          confirmLabel="Oluştur"
          levels={view?.timetable.levels ?? []}
          onCancel={() => setDialog(null)}
          onSave={async (name, color, levelId) => {
            setDialog(null)
            let v = await window.api.library.createCourse(name, color)
            const id = v.courses[v.courses.length - 1]?.id ?? null
            if (id && levelId) v = await window.api.library.updateCourse(id, { levelId })
            setView(v)
            openCourse(id)
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <CourseDialog
          title="Dersi düzenle"
          initialName={dialog.course.name}
          initialColor={dialog.course.color}
          initialLevelId={dialog.course.levelId ?? null}
          levels={view?.timetable.levels ?? []}
          confirmLabel="Kaydet"
          onCancel={() => setDialog(null)}
          onSave={async (name, color, levelId) => {
            setDialog(null)
            setView(await window.api.library.updateCourse(dialog.course.id, { name, color, levelId }))
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`"${dialog.course.name}" silinsin mi?`}
          message="Ders ve sunu listesi kaldırılır. Bilgisayarındaki dosyalar silinmez."
          confirmLabel="Dersi sil"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setDialog(null)
            setView(await window.api.library.deleteCourse(dialog.course.id))
          }}
        />
      )}
    </div>
  )
}

/**
 * Ana sayfa "Bugün": bugünün dersleri saat sırasıyla, her birinde dersin sıradaki sunusu. Bugün kalan ders
 * yoksa sonraki ders gösterilir. Programda hiç ders yoksa görünmez.
 */
function TodayPanel({
  view,
  now,
  onOpen,
  onCourse
}: {
  view: LibraryView
  now: Date
  onOpen: (path: string) => void
  onCourse: (id: string) => void
}): React.JSX.Element | null {
  const today = todayEntries(view, now)
  const next = today.some((e) => e.state !== 'past') ? null : nextDayEntry(view, now)
  const nextFile = next && nextPresentation(next.course)
  return (
    <section className="today">
      <div className="today__head">
        <h2>Bugün · {DAY_NAMES[isoDay(now)]}</h2>
        <span className="hint">{now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </div>
      {today.length ? (
        <div className="today__list">
          {today.map((e) => (
            <TodayCard key={e.slot.id} entry={e} view={view} onOpen={onOpen} onCourse={onCourse} />
          ))}
        </div>
      ) : (
        <div className="today__empty">Bugün ders yok.</div>
      )}
      {next && (
        <div className="today__next" role="button" onClick={() => onCourse(next.course.id)}>
          <span>
            Sıradaki ders: <strong>{next.dayName} {next.start}</strong> · {next.course.name}
            {nextFile && <span className="hint"> — {stripExt(nextFile.name)}</span>}
          </span>
          {nextFile && (
            <button
              className="btn"
              onClick={(ev) => {
                ev.stopPropagation()
                onOpen(nextFile.path)
              }}
            >
              ▶ Aç
            </button>
          )}
        </div>
      )}
    </section>
  )
}

const stripExt = (name: string): string => name.replace(/\.(pptx|pptm|ppsx|ppsm|ppt|pps)$/i, '')

function TodayCard({
  entry,
  view,
  onOpen,
  onCourse
}: {
  entry: TodayEntry
  view: LibraryView
  onOpen: (path: string) => void
  onCourse: (id: string) => void
}): React.JSX.Element {
  const { course, slot, state, start, end } = entry
  const file = nextPresentation(course)
  const level = levelName(course, view.timetable)
  const active = state === 'now' || state === 'next'
  return (
    <div
      className={`today-card today-card--${state}`}
      style={{ ['--c' as string]: courseColor(course, view.timetable) }}
      role="button"
      onClick={() => onCourse(course.id)}
    >
      <div className="today-card__time">
        <strong>{start}</strong>
        <span>{end}</span>
      </div>
      <div className="today-card__main">
        <div className="today-card__tags">
          {state === 'now' && <span className="tag tag--now">Şu an</span>}
          {state === 'next' && <span className="tag tag--next">Sıradaki</span>}
          {level && <span className="tag tag--level">{level}</span>}
          {slot.room && <span className="tag">{slot.room}</span>}
        </div>
        <div className="today-card__course">{course.name}</div>
        <div className="today-card__file">
          {file ? (
            <>
              Sunu: <strong>{stripExt(file.name)}</strong>
              {/* Yarıda bırakılan sunu: açınca kaldığı slayttan devam önerilir */}
              {file.session && file.session.slide > 1 && (
                <span>
                  {' '}
                  · kaldığın yer: slayt {file.session.slide} / {file.session.slideCount}
                </span>
              )}
            </>
          ) : course.items.length ? (
            'Tüm sunular sunuldu'
          ) : (
            'Bu derste henüz sunu yok'
          )}
        </div>
      </div>
      {file && (
        <button
          className={`btn btn--lg ${active ? 'btn--primary' : ''}`}
          onClick={(ev) => {
            ev.stopPropagation()
            onOpen(file.path)
          }}
        >
          ▶ Başlat
        </button>
      )}
    </div>
  )
}

/** Ders sayfası: sınıf rozeti ve haftalık saatleri */
function CourseMeta({ view, course, onEdit }: { view: LibraryView; course: LibraryCourse; onEdit: () => void }): React.JSX.Element {
  const level = levelName(course, view.timetable)
  const slots = courseSlots(view, course.id)
  return (
    <div className="course-meta" style={{ ['--c' as string]: courseColor(course, view.timetable) }}>
      {level && <span className="tag tag--level">{level}</span>}
      {slots.map((s) => {
        const t = slotTime(view.timetable, s)
        return (
          <span key={s.id} className="tag">
            {DAY_SHORT[s.day]} {t.start}–{t.end}
            {s.room ? ` · ${s.room}` : ''}
          </span>
        )
      })}
      <button className="link-btn" onClick={onEdit}>
        {slots.length ? 'Programı düzenle' : 'Programa ekle'}
      </button>
    </div>
  )
}

function Progress({ session }: { session: LibraryFile['session'] }): React.JSX.Element | null {
  if (!session || session.slideCount < 1) return null
  return (
    <div className="mini-progress">
      <div style={{ width: `${Math.min(100, (session.slide / session.slideCount) * 100)}%` }} />
    </div>
  )
}

function FileRow({
  file,
  index,
  next,
  handle,
  dragging,
  style,
  onOpen,
  onRetry,
  actions
}: {
  file: LibraryFile
  index?: number
  /** Derste sıradaki (sunulmamış ilk) sunu */
  next?: boolean
  /** Sürükleyerek sıralama tutamacı (yalnızca ders listesinde) */
  handle?: React.HTMLAttributes<HTMLElement>
  dragging?: boolean
  style?: React.CSSProperties
  onOpen: () => void
  onRetry?: () => void
  actions?: React.ReactNode
}): React.JSX.Element {
  const missing = file.status === 'missing'
  const done = file.presentedAt != null
  const cls = ['file-row', missing && 'file-row--missing', done && 'file-row--done', next && 'file-row--next', dragging && 'file-row--dragging']
  return (
    <div
      className={cls.filter(Boolean).join(' ')}
      style={style}
      data-reorder-row
      onClick={() => !missing && onOpen()}
      role="button"
    >
      {handle && (
        <button className="drag-handle" title="Sürükleyerek sırala" aria-label="Sırala" {...handle}>
          <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
            {[3, 8, 13].flatMap((y) => [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
          </svg>
        </button>
      )}
      {index != null && <span className="file-row__index">{index}</span>}
      <div className="file-row__main">
        <div className="file-row__name" title={file.path}>
          {file.name.replace(/\.(pptx|pptm|ppsx|ppsm|ppt|pps)$/i, '')}
        </div>
        <div className="file-row__meta">
          {next && <span className="next-badge">Sıradaki</span>}
          {done ? (
            <span className="file-row__done" title={`İşaretlendi: ${new Date(file.presentedAt!).toLocaleString('tr-TR')}`}>
              ✓ Sunuldu
            </span>
          ) : file.session ? (
            <span>
              Slayt {file.session.slide} / {file.session.slideCount} · {timeAgo(file.session.updatedAt)}
            </span>
          ) : (
            <span className="hint">Henüz sunulmadı</span>
          )}
        </div>
        {!done && <Progress session={file.session} />}
      </div>
      <span
        className={`status status--${file.status}`}
        title={file.error}
        onClick={(e) => {
          if (file.status === 'error' && onRetry) {
            e.stopPropagation()
            onRetry()
          }
        }}
      >
        {STATUS_LABEL[file.status]}
        {file.status === 'error' && onRetry ? ' · yeniden dene' : ''}
      </span>
      <div className="file-row__actions">{actions}</div>
    </div>
  )
}

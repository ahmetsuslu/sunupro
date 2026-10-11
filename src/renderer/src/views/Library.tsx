import React, { useEffect, useState } from 'react'
import type { LibraryCourse, LibraryFile, LibraryView } from '@shared/types'
import CourseDialog from '../components/CourseDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import { timeAgo } from '../lib/time'
import UpdateBanner from '../components/UpdateBanner'

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
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dragging, setDragging] = useState(false)

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

  // Sunuldu olarak işaretlenmiş (bitmiş) sunu "kaldığın yerden devam" önerilmez
  const resume = view?.recent.find((r) => r.session && !r.presentedAt) ?? null
  // Derste sıradaki sunu: sunulmamış ilk dosya
  const nextPath = course?.items.find((f) => !f.presentedAt && f.status !== 'missing')?.path ?? null
  const doneCount = course?.items.filter((f) => f.presentedAt).length ?? 0

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
        <button className={`lib-nav ${selected === null ? 'lib-nav--active' : ''}`} onClick={() => setSelected(null)}>
          Ana sayfa
        </button>
        <div className="lib-side__title">Dersler</div>
        <div className="lib-courses">
          {view?.courses.map((c) => (
            <button
              key={c.id}
              className={`lib-nav ${selected === c.id ? 'lib-nav--active' : ''}`}
              onClick={() => setSelected(c.id)}
            >
              <span className="dot" style={{ background: c.color }} />
              <span className="lib-nav__name">{c.name}</span>
              <span className="lib-nav__count">{c.items.length}</span>
            </button>
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

      <main className="lib-main">
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

        {!course && (
          <div className="lib-home">
            <div className="lib-head">
              <h1>Merhaba</h1>
              <div className="spacer" />
              <button className="btn btn--lg" onClick={quickOpen}>
                Sunu aç…
              </button>
            </div>

            {resume ? (
              <section className="resume-card" onClick={() => onOpen(resume.path)}>
                <div className="resume-card__label">Kaldığın yerden devam</div>
                <div className="resume-card__name">{resume.name}</div>
                <div className="resume-card__meta">
                  {resume.courseName && <span>{resume.courseName} · </span>}
                  Slayt {resume.session!.slide} / {resume.session!.slideCount} · {timeAgo(resume.session!.updatedAt)}
                </div>
                <Progress session={resume.session} />
                <button className="btn btn--primary btn--lg resume-card__btn">▶ Devam et</button>
              </section>
            ) : (
              <section className="lib-empty">
                <h2>Derslerini düzenle, kaldığın yerden devam et</h2>
                <p>
                  Soldan bir ders oluştur ve sunularını ekle ya da ders klasörünü bağla. Bir sunuyu açtığında hangi
                  slaytta kaldığın otomatik kaydedilir.
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

            {!!view?.recent.length && (
              <section>
                <h3 className="lib-section-title">Son açılanlar</h3>
                <div className="file-list">
                  {view.recent.map((f) => (
                    <FileRow
                      key={f.path}
                      file={f}
                      subtitle={f.courseName ?? undefined}
                      onOpen={() => onOpen(f.path)}
                      actions={
                        <button
                          className="icon-btn"
                          title="Listeden kaldır"
                          onClick={async (e) => {
                            e.stopPropagation()
                            setView(await window.api.library.forgetRecent(f.path))
                          }}
                        >
                          ✕
                        </button>
                      }
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {course && (
          <div className="lib-course">
            <div className="lib-head">
              <span className="dot dot--lg" style={{ background: course.color }} />
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
              <div className="file-list">
                {course.items.map((f, i) => (
                  <FileRow
                    key={f.path}
                    file={f}
                    index={i + 1}
                    next={f.path === nextPath}
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
                          title="Yukarı taşı"
                          disabled={i === 0}
                          onClick={async (e) => {
                            e.stopPropagation()
                            setView(await window.api.library.moveFile(course.id, f.path, -1))
                          }}
                        >
                          ↑
                        </button>
                        <button
                          className="icon-btn"
                          title="Aşağı taşı"
                          disabled={i === course.items.length - 1}
                          onClick={async (e) => {
                            e.stopPropagation()
                            setView(await window.api.library.moveFile(course.id, f.path, 1))
                          }}
                        >
                          ↓
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
          onCancel={() => setDialog(null)}
          onSave={async (name, color) => {
            setDialog(null)
            const v = await window.api.library.createCourse(name, color)
            setView(v)
            setSelected(v.courses[v.courses.length - 1]?.id ?? null)
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <CourseDialog
          title="Dersi düzenle"
          initialName={dialog.course.name}
          initialColor={dialog.course.color}
          confirmLabel="Kaydet"
          onCancel={() => setDialog(null)}
          onSave={async (name, color) => {
            setDialog(null)
            setView(await window.api.library.updateCourse(dialog.course.id, { name, color }))
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
  subtitle,
  next,
  onOpen,
  onRetry,
  actions
}: {
  file: LibraryFile
  index?: number
  subtitle?: string
  /** Derste sıradaki (sunulmamış ilk) sunu */
  next?: boolean
  onOpen: () => void
  onRetry?: () => void
  actions?: React.ReactNode
}): React.JSX.Element {
  const missing = file.status === 'missing'
  const done = file.presentedAt != null
  return (
    <div
      className={`file-row ${missing ? 'file-row--missing' : ''} ${done ? 'file-row--done' : ''} ${next ? 'file-row--next' : ''}`}
      onClick={() => !missing && onOpen()}
      role="button"
    >
      {index != null && <span className="file-row__index">{index}</span>}
      <div className="file-row__main">
        <div className="file-row__name" title={file.path}>
          {file.name.replace(/\.(pptx|pptm|ppsx|ppsm|ppt|pps)$/i, '')}
        </div>
        <div className="file-row__meta">
          {next && <span className="next-badge">Sıradaki</span>}
          {subtitle && <span>{subtitle} · </span>}
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

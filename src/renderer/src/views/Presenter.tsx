import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ShowScreen, type InkPrefs, type OverlayMsg, type PresentationInfo, type ShowMode, type ShowState } from '@shared/types'
import Stage from '../components/Stage'
import Toolbar from '../components/Toolbar'
import SidePanel from '../components/SidePanel'
import SlideGrid from '../components/SlideGrid'
import ConfirmDialog from '../components/ConfirmDialog'
import DisplayMenu from '../components/DisplayMenu'
import { onOverlayPort, post } from '../lib/overlay-port'
import { firstVisible, lastVisible, nextVisible, prevVisible } from '../lib/slides'
import { useKeyHint, useShortcuts, type ActionHandlers } from '../lib/use-shortcuts'
import { formatDuration, useTimer } from '../lib/use-timer'
import { COLOR_NAMES, HL_COLORS, PEN_COLORS, type Tool } from '../lib/tools'
import { InkStore } from '../lib/ink-store'
import { updateSettings, useSettings } from '../lib/settings'

type Props = { presentation: PresentationInfo; onClose: () => void }
type Point = { x: number; y: number }

const DEFAULT_INK: InkPrefs = { penColor: PEN_COLORS[0], penSize: 1, hlColor: HL_COLORS[0], hlSize: 1 }

export default function Presenter({ presentation: p, onClose }: Props): React.JSX.Element {
  const [state, setState] = useState<ShowState>({ running: false })
  const [previewSlide, setPreviewSlide] = useState(() => firstVisible(p))
  const [tool, setTool] = useState<Tool>('none')
  const [gridOpen, setGridOpen] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyNoticeOpen, setCopyNoticeOpen] = useState(p.openedCopy)
  const [toast, setToast] = useState<string | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  const timer = useTimer(state.running)
  const hint = useKeyHint()
  const settings = useSettings()
  const prefs = settings?.ink ?? DEFAULT_INK
  // Çizimler sunu boyunca bellekte; değişiklikler seyirci katmanına aktarılır
  const [ink] = useState(() => new InkStore())
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const testHook = window as unknown as { __sunuSpike?: boolean; __sunuInk?: InkStore }
  if (testHook.__sunuSpike) testHook.__sunuInk = ink

  const toOverlay = useCallback((msg: OverlayMsg) => post(portRef.current, msg), [])

  useEffect(() => {
    window.api.show.getState().then(setState)
    return window.api.show.onState(setState)
  }, [])
  useEffect(
    () =>
      onOverlayPort((port) => {
        portRef.current = port
        post(port, { t: 'ink-all', ink: ink.all() })
      }),
    [ink]
  )
  useEffect(
    () =>
      ink.subscribe((changed) => {
        if (changed === null) toOverlay({ t: 'ink-all', ink: ink.all() })
        else toOverlay({ t: 'ink-slide', slide: changed, strokes: ink.get(changed) })
        bump()
      }),
    [ink, toOverlay]
  )

  const running = state.running
  const slide = running && state.slide ? state.slide : previewSlide

  // Gösteri bitince önizleme kaldığı slayttan devam etsin
  const lastRunningSlide = useRef(slide)
  useEffect(() => {
    if (running && state.slide) lastRunningSlide.current = state.slide
    if (!running) {
      setPreviewSlide(lastRunningSlide.current)
      setTool('none')
    }
  }, [running, state.slide])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200)
  }, [])

  useEffect(() => {
    if (state.atEnd) showToast('Son slayttasınız')
  }, [state.atEnd, showToast])

  const sendLaser = useCallback((pos: Point | null) => {
    post(portRef.current, pos ? { t: 'laser', ...pos } : { t: 'laser-off' })
  }, [])

  const selectTool = useCallback(
    (t: Tool) => {
      setTool((cur) => {
        const next = cur === t ? 'none' : t
        if (next !== 'laser') sendLaser(null)
        return next
      })
    },
    [sendLaser]
  )

  const cmd = useCallback((c: 'next' | 'prev' | 'goto' | 'screen', args?: Record<string, unknown>) => {
    window.api.show.cmd(c, args).then(setState).catch(console.error)
  }, [])

  const goto = useCallback(
    (n: number | null) => {
      if (n == null) return
      if (running) cmd('goto', { slide: n })
      else setPreviewSlide(n)
    },
    [running, cmd]
  )

  const start = useCallback(
    async (from: number, mode?: ShowMode) => {
      setStarting(true)
      setError(null)
      const r = await window.api.show.start({ slide: from, mode })
      setStarting(false)
      if (!r.ok) {
        setError(r.message)
        return
      }
      timer.reset()
      setState(r.value)
    },
    [timer]
  )

  const toggleScreen = useCallback(
    (mode: 'black' | 'white') => {
      if (!running) return
      const target = mode === 'black' ? ShowScreen.Black : ShowScreen.White
      cmd('screen', { mode: state.state === target ? 'normal' : mode })
    },
    [running, cmd, state.state]
  )

  const setPrefs = useCallback((patch: Partial<InkPrefs>) => updateSettings({ ink: { ...prefs, ...patch } }), [prefs])

  const nextColor = (): void => {
    const hl = tool === 'highlighter'
    const list = hl ? HL_COLORS : PEN_COLORS
    const next = list[(list.indexOf(hl ? prefs.hlColor : prefs.penColor) + 1) % list.length]
    setPrefs(hl ? { hlColor: next } : { penColor: next })
    showToast(`${hl ? 'Vurgulayıcı' : 'Kalem'} rengi: ${COLOR_NAMES[next] ?? next}`)
  }

  const handlers: ActionHandlers = gridOpen
    ? { escape: () => setGridOpen(false), grid: () => setGridOpen(false) }
    : {
        next: () => (running ? cmd('next') : goto(nextVisible(p, slide))),
        prev: () => (running ? cmd('prev') : goto(prevVisible(p, slide))),
        nextSlide: () => goto(nextVisible(p, slide)),
        prevSlide: () => goto(prevVisible(p, slide)),
        first: () => goto(firstVisible(p)),
        last: () => goto(lastVisible(p)),
        grid: () => setGridOpen(true),
        toolLaser: () => selectTool('laser'),
        toolHighlighter: () => selectTool('highlighter'),
        toolPen: () => selectTool('pen'),
        toolEraser: () => selectTool('eraser'),
        toolNone: () => setTool('none'),
        nextColor,
        undo: () => ink.undo(slide),
        redo: () => ink.redo(slide),
        clearSlide: () => ink.clear(slide),
        clearAll: () => ink.hasAny() && setConfirmClearAll(true),
        black: () => toggleScreen('black'),
        white: () => toggleScreen('white'),
        startShow: () => !running && !starting && start(firstVisible(p)),
        startHere: () => !running && !starting && start(slide),
        escape: () => {
          if (tool !== 'none') selectTool('none')
          else if (running) setConfirmEnd(true)
        }
      }
  useShortcuts(handlers, !confirmEnd && !confirmClearAll)

  const remainingClicks = running ? Math.max(0, (state.clickCount ?? 0) - (state.click ?? 0)) : 0

  return (
    <div className="presenter">
      <header className="presenter__bar">
        {!running && (
          <button className="btn" onClick={onClose} title="Sunuyu kapat">
            ← Kapat
          </button>
        )}
        <strong className="presenter__name" title={p.path}>
          {p.name}
        </strong>
        <span className="chip">
          Slayt {slide} / {p.slideCount}
        </span>
        {(state.clickCount ?? 0) > 0 && running && (
          <span className="chip">
            Adım {state.click} / {state.clickCount}
          </span>
        )}
        {running && state.mode === 'image' && <span className="chip chip--warn">Görsel mod (animasyonsuz)</span>}
        {running && state.windowed && <span className="chip chip--warn">Test modu · tek ekran</span>}
        <div className="spacer" />
        {running && (
          <div className="timer">
            <button
              className={`chip chip--mono chip--btn ${timer.paused ? 'chip--paused' : ''}`}
              onClick={timer.toggle}
              title={timer.paused ? 'Süreyi sürdür' : 'Süreyi duraklat'}
            >
              {timer.paused ? '❚❚ ' : ''}
              {formatDuration(timer.elapsedSec)}
            </button>
            <button className="icon-btn" onClick={timer.reset} title="Süreyi sıfırla">
              ↺
            </button>
          </div>
        )}
        <Clock />
        <DisplayMenu running={running} />
        {running ? (
          <button className="btn btn--danger" onClick={() => setConfirmEnd(true)}>
            Sunumu bitir
          </button>
        ) : (
          <>
            {slide !== firstVisible(p) && (
              <button className="btn" disabled={starting} onClick={() => start(slide)} title={hint('startHere')}>
                Bu slayttan başlat
              </button>
            )}
            <button
              className="btn btn--primary"
              disabled={starting}
              onClick={() => start(firstVisible(p))}
              title={hint('startShow')}
            >
              {starting ? 'Başlatılıyor…' : '▶ Sunumu başlat'}
            </button>
          </>
        )}
      </header>

      {error && (
        <div className="banner banner--error">
          <span>{error}</span>
          <div className="spacer" />
          <button className="btn" onClick={() => start(slide, 'image')}>
            Görsel modda başlat
          </button>
          <button className="icon-btn" onClick={() => setError(null)} title="Kapat">
            ✕
          </button>
        </div>
      )}
      {running && state.detached && (
        <div className="banner banner--warn">
          Seyirci ekranının bağlantısı koptu. Ekran yeniden bağlanınca gösteri kaldığı yerden sürecek.
        </div>
      )}
      {copyNoticeOpen && (
        <div className="banner banner--info">
          <span>Bu dosya PowerPoint'te açık; kaydedilmiş son hâli gösteriliyor. Kaydedilmemiş değişiklikler görünmez.</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setCopyNoticeOpen(false)} title="Kapat">
            ✕
          </button>
        </div>
      )}

      <main className="presenter__main">
        <Stage
          presentation={p}
          state={state}
          slide={slide}
          tool={tool}
          ink={ink}
          inkPrefs={prefs}
          hideInk={running && (state.state === ShowScreen.Black || state.state === ShowScreen.White)}
          onLaser={sendLaser}
          onOverlay={toOverlay}
          onSwipe={(dir) => handlers[dir]?.()}
        />
        <SidePanel presentation={p} slide={slide} remainingClicks={remainingClicks} />
        {toast && <div className="toast">{toast}</div>}
      </main>

      <Toolbar
        running={running}
        tool={tool}
        prefs={prefs}
        black={state.state === ShowScreen.Black}
        white={state.state === ShowScreen.White}
        gridOpen={gridOpen}
        canUndo={ink.canUndo(slide)}
        canRedo={ink.canRedo(slide)}
        canClear={ink.get(slide).length > 0}
        run={(action) => handlers[action]?.()}
        onPrefs={setPrefs}
      />

      {gridOpen && (
        <SlideGrid
          presentation={p}
          current={slide}
          onClose={() => setGridOpen(false)}
          onSelect={(n) => {
            setGridOpen(false)
            goto(n)
          }}
        />
      )}
      {confirmClearAll && (
        <ConfirmDialog
          title="Tüm çizimler silinsin mi?"
          message="Bütün slaytlardaki kalem ve vurgulayıcı çizimleri silinecek. Bu işlem geri alınamaz."
          confirmLabel="Tümünü sil"
          danger
          onCancel={() => setConfirmClearAll(false)}
          onConfirm={() => {
            setConfirmClearAll(false)
            ink.clearAll()
          }}
        />
      )}
      {confirmEnd && (
        <ConfirmDialog
          title="Sunum bitirilsin mi?"
          message={`Slayt ${slide} / ${p.slideCount} üzerindesiniz.`}
          confirmLabel="Bitir"
          danger
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => {
            setConfirmEnd(false)
            window.api.show.stop().then(setState)
          }}
        />
      )}
    </div>
  )
}

function Clock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5000)
    return () => clearInterval(id)
  }, [])
  return <span className="chip chip--mono">{now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
}

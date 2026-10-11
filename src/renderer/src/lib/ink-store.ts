import type { InkMap, InkStroke } from '@shared/types'

type Entry = { kind: 'add'; strokes: InkStroke[] } | { kind: 'remove'; strokes: InkStroke[]; group?: string }

/**
 * Sunu boyunca çizimlerin tek doğruluk kaynağı (sunucu penceresinde yaşar).
 * Geri al / yinele slayt başınadır: Ctrl+Z yalnızca o an gösterilen slayttaki son işlemi geri alır.
 * Değişiklikler abonelere slayt numarasıyla (tümü silindiyse null) bildirilir.
 */
export class InkStore {
  private map = new Map<number, InkStroke[]>()
  private undoStack = new Map<number, Entry[]>()
  private redoStack = new Map<number, Entry[]>()
  private listeners = new Set<(slide: number | null) => void>()
  private nextSeq = 1

  subscribe(cb: (slide: number | null) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(slide: number | null): void {
    for (const cb of this.listeners) cb(slide)
  }

  seq(): number {
    return this.nextSeq++
  }

  get(slide: number): InkStroke[] {
    return this.map.get(slide) ?? []
  }

  all(): InkMap {
    return Object.fromEntries(this.map)
  }

  hasAny(): boolean {
    for (const list of this.map.values()) if (list.length) return true
    return false
  }

  private set(slide: number, strokes: InkStroke[]): void {
    if (strokes.length) this.map.set(slide, strokes)
    else this.map.delete(slide)
  }

  private push(slide: number, entry: Entry): void {
    const stack = this.undoStack.get(slide) ?? []
    stack.push(entry)
    this.undoStack.set(slide, stack)
    this.redoStack.delete(slide)
  }

  private insertSorted(slide: number, strokes: InkStroke[]): void {
    this.set(slide, [...this.get(slide), ...strokes].sort((a, b) => a.seq - b.seq))
  }

  private removeIds(slide: number, ids: Set<string>): void {
    this.set(
      slide,
      this.get(slide).filter((s) => !ids.has(s.id))
    )
  }

  add(slide: number, stroke: InkStroke): void {
    this.insertSorted(slide, [stroke])
    this.push(slide, { kind: 'add', strokes: [stroke] })
    this.emit(slide)
  }

  /** Silgi: aynı sürüklemedeki (group) silmeler tek geri alma adımında birleşir. */
  remove(slide: number, ids: string[], group?: string): void {
    const idSet = new Set(ids)
    const removed = this.get(slide).filter((s) => idSet.has(s.id))
    if (!removed.length) return
    this.removeIds(slide, idSet)
    const stack = this.undoStack.get(slide)
    const last = stack?.[stack.length - 1]
    if (group && last?.kind === 'remove' && last.group === group) {
      last.strokes.push(...removed)
      this.redoStack.delete(slide)
    } else this.push(slide, { kind: 'remove', strokes: removed, group })
    this.emit(slide)
  }

  clear(slide: number): void {
    const strokes = this.get(slide)
    if (!strokes.length) return
    this.set(slide, [])
    this.push(slide, { kind: 'remove', strokes })
    this.emit(slide)
  }

  /** Kaydedilmiş çizimleri yükler (geçmiş sıfırlanır); sunuda artık olmayan slaytlar atlanır. */
  load(ink: InkMap, slideCount: number): void {
    this.map.clear()
    this.undoStack.clear()
    this.redoStack.clear()
    for (const [key, strokes] of Object.entries(ink)) {
      const slide = Number(key)
      if (slide >= 1 && slide <= slideCount && strokes.length) this.map.set(slide, strokes)
      for (const s of strokes) this.nextSeq = Math.max(this.nextSeq, s.seq + 1)
    }
    this.emit(null)
  }

  /** Tüm slaytlar: geri alınamaz (onay sorulduktan sonra çağrılır). */
  clearAll(): void {
    this.map.clear()
    this.undoStack.clear()
    this.redoStack.clear()
    this.emit(null)
  }

  undo(slide: number): void {
    const entry = this.undoStack.get(slide)?.pop()
    if (!entry) return
    if (entry.kind === 'add') this.removeIds(slide, new Set(entry.strokes.map((s) => s.id)))
    else this.insertSorted(slide, entry.strokes)
    const redo = this.redoStack.get(slide) ?? []
    redo.push(entry)
    this.redoStack.set(slide, redo)
    this.emit(slide)
  }

  redo(slide: number): void {
    const entry = this.redoStack.get(slide)?.pop()
    if (!entry) return
    if (entry.kind === 'add') this.insertSorted(slide, entry.strokes)
    else this.removeIds(slide, new Set(entry.strokes.map((s) => s.id)))
    const undo = this.undoStack.get(slide) ?? []
    undo.push(entry)
    this.undoStack.set(slide, undo)
    this.emit(slide)
  }

  canUndo(slide: number): boolean {
    return (this.undoStack.get(slide)?.length ?? 0) > 0
  }

  canRedo(slide: number): boolean {
    return (this.redoStack.get(slide)?.length ?? 0) > 0
  }
}

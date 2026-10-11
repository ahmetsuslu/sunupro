import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * userData altında JSON dosyası: bellekte tutulur, değişiklikler kısa gecikmeyle (birleştirilerek)
 * diske yazılır. Yazma önce geçici dosyaya yapılır, sonra taşınır (yarım yazılmış dosya kalmasın).
 */
export class JsonFile<T> {
  private data: T | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private name: string,
    private defaults: () => T,
    private delayMs = 400
  ) {}

  private path(): string {
    return join(app.getPath('userData'), this.name)
  }

  get(): T {
    if (this.data) return this.data
    try {
      this.data = { ...this.defaults(), ...(JSON.parse(readFileSync(this.path(), 'utf-8')) as Partial<T>) }
    } catch {
      this.data = this.defaults()
    }
    return this.data
  }

  set(next: T): void {
    this.data = next
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.data) return
    try {
      const file = this.path()
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file + '.tmp', JSON.stringify(this.data, null, 2), 'utf-8')
      renameSync(file + '.tmp', file)
    } catch (err) {
      console.error(`[${this.name}] yazılamadı:`, err)
    }
  }
}

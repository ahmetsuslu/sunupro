// Uçtan uca test: derlenmiş uygulamayı SUNU_SELFTEST ile başlatır, sonuçları özetler.
// Gereksinimler: Windows, Microsoft PowerPoint, mümkünse iki ekran (tek ekranda bazı adımlar başarısız olur).
// Kullanım: npm run test:e2e            (geliştirme derlemesi)
//           node scripts/selftest.mjs "release/win-unpacked/Sunu Pro.exe"   (paketlenmiş uygulama)
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const exe = process.argv[2] ? resolve(process.argv[2]) : join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const args = process.argv[2] ? [] : ['.']
const out = mkdtempSync(join(tmpdir(), 'sunupro-selftest-'))

console.log(`Sunu Pro uçtan uca test başlıyor (çıktı: ${out})`)
console.log('Test sırasında 2. ekranda örnek sunu açılıp kapanacak; fare imleci bir kez hareket edecek.')

const child = spawn(exe, args, {
  cwd: root,
  env: { ...process.env, SUNU_SELFTEST: out, SUNU_SAMPLE: join(root, 'samples', 'ornek-sunu.pptx') },
  stdio: 'ignore'
})
const timer = setTimeout(() => {
  console.error('Zaman aşımı (8 dk) — uygulama kapatılıyor')
  child.kill()
}, 8 * 60_000)

child.on('exit', () => {
  clearTimeout(timer)
  let result
  try {
    result = JSON.parse(readFileSync(join(out, 'sonuc.json'), 'utf-8'))
  } catch {
    console.error('Sonuç dosyası okunamadı.')
    process.exit(2)
  }
  for (const c of result.checks) {
    console.log(`${c.ok ? '✔' : '✘'} ${c.name}${c.ok ? '' : `  ${JSON.stringify(c.detail)}`}`)
  }
  if (result.consoleLog?.length) console.log('\nArayüz konsolu:\n' + result.consoleLog.join('\n'))
  console.log(`\n${result.passed} / ${result.total} kontrol geçti. Ekran görüntüleri: ${out}`)
  process.exit(result.passed === result.total ? 0 : 1)
})

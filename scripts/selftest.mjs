// Uçtan uca test: derlenmiş uygulamayı SUNU_SELFTEST ile başlatır, sonuçları özetler.
// Gereksinimler: Windows, Microsoft PowerPoint, mümkünse iki ekran (tek ekranda bazı adımlar başarısız olur).
// Kullanım: npm run test:e2e            (geliştirme derlemesi)
//           node scripts/selftest.mjs "release/win-unpacked/Sunu Pro.exe"   (paketlenmiş uygulama)
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Test PowerPoint'i ve 2. ekranı kullanır, ekrana gerçek fare tıklaması yapar: kurulu Sunu Pro ya da PowerPoint
// açıkken (ör. kullanıcı sunum/prova yaparken) çalışırsa o oturuma karışır. Bu yüzden önce kapatılmaları istenir.
if (!process.argv.includes('--force')) {
  const running = (image) => {
    try {
      return execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], { encoding: 'utf-8' }).includes(image)
    } catch {
      return false
    }
  }
  const busy = ['Sunu Pro.exe', 'POWERPNT.EXE'].filter(running)
  if (busy.length) {
    console.error(`Açık: ${busy.join(', ')}. Test PowerPoint'i ve 2. ekranı kullandığı için bu oturuma karışır.`)
    console.error('Kapatıp tekrar deneyin (yine de çalıştırmak için: npm run test:e2e -- --force).')
    process.exit(3)
  }
}

const root = resolve(import.meta.dirname, '..')
const exeArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
const exe = exeArg ? resolve(exeArg) : join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const args = exeArg ? [] : ['.']
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

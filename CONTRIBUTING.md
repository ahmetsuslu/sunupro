# Katkıda bulunma

Hata bildirimleri ve öneriler için [Issues](https://github.com/ahmetsuslu/sunupro/issues) sayfasını
kullanın. Hata bildirirken Windows ve PowerPoint sürümünü, ekran düzeninizi ve
`%APPDATA%\Sunu Pro\logs\main.log` dosyasını eklemeniz çok yardımcı olur.

## Geliştirme ortamı

- Windows 10/11, Node.js 20+, Microsoft PowerPoint
- `npm install` ardından `npm run dev`
- Örnek sunuyu yeniden üretmek için: `npm run sample` (animasyonlu maddeler, notlar, gizli slayt,
  hizalama işaretleri içerir)

## Kurallar

- TypeScript `strict`; değişiklik sonrası `npm run typecheck` temiz olmalı.
- Davranışı etkileyen değişikliklerden önce ve sonra `npm run test:e2e` çalıştırın (gerçek PowerPoint
  ile; iki ekran önerilir). Yeni özellik eklerken `src/main/selftest.ts`'e kontrol ekleyin.
- Kısayollar sabit kodlanmaz: yeni işlevi `src/shared/shortcuts.ts` içinde bir eylem olarak tanımlayın.
- `.ps1` dosyaları **UTF-8 BOM** ile kaydedilmeli (Windows PowerShell 5.1 aksi halde Türkçe
  karakterleri bozar).
- Arayüz metinleri ve kod yorumları Türkçe; değişken ve fonksiyon adları İngilizce.

#!/usr/bin/env bash
# Sürümü derler ve GitHub Releases'e yayınlar (kurulu uygulamalar buradan güncellenir).
# Yükleme gh CLI ile yapılır: electron-builder'ın kendi yükleyicisi büyük dosyalarda kararsız
# ağda kopabiliyor. Asset adları electron-builder.yml'deki artifactName ile boşluksuz üretilir,
# böylece latest.yml'deki adlarla birebir eşleşir.
# Kullanım: npm run release -- "Sürüm notları"
set -e
cd "$(dirname "$0")/.."

OWNER="ahmetsuslu"
REPO="sunupro"

V=$(node -p "require('./package.json').version")
TAG="v$V"
NOTES="${1:-Sunu Pro $V}"
echo "==> Sunu Pro $V derleniyor..."

# Ağ büyük indirmelerde ara sıra kopabildiği için derlemeyi birkaç kez dene
for i in $(seq 1 6); do
  if npm run build:win; then break; fi
  if [ "$i" = "6" ]; then echo "derleme 6 denemede de başarısız"; exit 1; fi
  echo "    derleme denemesi $i başarısız, yeniden deneniyor..."
  sleep 8
done

ASSETS=(
  "release/SunuPro-Setup-$V.exe"
  "release/SunuPro-Setup-$V.exe.blockmap"
  "release/SunuPro-$V-portable.exe"
  "release/latest.yml"
)
for a in "${ASSETS[@]}"; do
  [ -f "$a" ] || { echo "Eksik dosya: $a"; exit 1; }
done

echo "==> GitHub release ($TAG) oluşturuluyor..."
gh release create "$TAG" --repo "$OWNER/$REPO" --target main --latest --title "Sunu Pro $V" --notes "$NOTES" 2>/dev/null \
  || echo "    (release zaten var, dosyalar güncellenecek)"

echo "==> Dosyalar yükleniyor (gh, --clobber, ağ yeniden denemesi)..."
for i in $(seq 1 15); do
  if gh release upload "$TAG" --repo "$OWNER/$REPO" "${ASSETS[@]}" --clobber; then
    break
  fi
  if [ "$i" = "15" ]; then echo "yükleme 15 denemede de başarısız (ağ)"; exit 1; fi
  echo "    yükleme denemesi $i koptu, yeniden deneniyor..."
  sleep 10
done

echo "==> Yayınlandı: https://github.com/$OWNER/$REPO/releases/tag/$TAG"

#!/bin/bash
# Publica una versión nueva de la app en GitHub Releases.
# Los Macs con la app instalada la descargan e instalan solos.
#
#   npm run release                       # sube la versión (0.1.3 → 0.1.4)
#   npm run release -- "Qué ha cambiado"  # con notas
set -euo pipefail
cd "$(dirname "$0")/.."

NOTES="${1:-Mejoras y correcciones.}"
gh auth status >/dev/null 2>&1 || { echo "Falta iniciar sesión en GitHub: gh auth login"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Hay cambios sin guardar en git. Guárdalos antes de publicar."; exit 1; }

npm version patch --no-git-tag-version >/dev/null
VER=$(node -p "require('./package.json').version")
ARCH=$(uname -m)
echo "Publicando la versión $VER ($ARCH)…"

npm run dist
OUT="dist/mac-$ARCH"; [ "$ARCH" = "x86_64" ] && OUT="dist/mac" && ARCH="x64"
ZIP="dist/Segundo-Cerebro-$VER-$ARCH.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$OUT/Segundo Cerebro.app" "$ZIP"

git add package.json package-lock.json
git commit -m "Versión $VER"
git push
gh release create "v$VER" "$ZIP" --title "Versión $VER" --notes "$NOTES"
echo "Listo: versión $VER publicada. Los Macs la instalarán en las próximas horas (o en Ajustes → Buscar ahora)."

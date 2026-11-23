#!/bin/bash
# Publica una versión nueva de la app en GitHub Releases.
# Los Macs con la app instalada la descargan e instalan solos.
#
#   npm run release                       # sube la versión (0.1.3 → 0.1.4)
#   npm run release -- "Qué ha cambiado"  # con notas
#
# Se compila desde una copia limpia de lo que está guardado en git (HEAD),
# así nunca se publica un cambio a medias.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

NOTES="${1:-Mejoras y correcciones.}"
gh auth status >/dev/null 2>&1 || { echo "Falta iniciar sesión en GitHub: gh auth login"; exit 1; }
git diff --quiet HEAD -- package.json package-lock.json || { echo "package.json tiene cambios sin guardar. Guárdalos antes de publicar."; exit 1; }

# 1. Nueva versión: solo se toca package.json / package-lock.json y se guarda en git.
npm version patch --no-git-tag-version >/dev/null
VER=$(node -p "require('./package.json').version")
git add package.json package-lock.json
git commit -q -m "Versión $VER" -- package.json package-lock.json
git push -q

ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH="x64"
OUT_DIR="mac-$ARCH"; [ "$ARCH" = "x64" ] && OUT_DIR="mac"
echo "Compilando la versión $VER ($ARCH)…"

# 2. Copia limpia de HEAD, con las dependencias clonadas (instantáneo en APFS).
WT="$(mktemp -d)/segundo-cerebro-$VER"
trap 'git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true' EXIT
git worktree add -q --detach "$WT" HEAD
cp -cR node_modules "$WT/node_modules"
(cd "$WT" && npm run dist)

ZIP="$ROOT/dist/Segundo-Cerebro-$VER-$ARCH.zip"
mkdir -p "$ROOT/dist"
rm -f "$ZIP"
ditto -c -k --keepParent "$WT/dist/$OUT_DIR/Segundo Cerebro.app" "$ZIP"

# 3. Publicar.
gh release create "v$VER" "$ZIP" --title "Versión $VER" --notes "$NOTES"
echo "Listo: versión $VER publicada. Los Macs la instalarán en las próximas horas (o en Ajustes → Actualizaciones → Buscar ahora)."

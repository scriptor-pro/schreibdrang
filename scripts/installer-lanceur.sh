#!/usr/bin/env bash
# Installe, pour l'utilisateur courant, un lanceur et les icônes du prototype :
# l'app apparaît alors avec son icône dans le menu des applications, les
# lanceurs du tableau de bord et le sélecteur de fenêtres, au lieu de l'icône
# générique. Rien n'est écrit hors de ~/.local/share.
#
# Désinstaller : scripts/installer-lanceur.sh --retirer
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
NAME=schreibdrang-prototype
BINARY="$ROOT/src-tauri/target/debug/$NAME"
SOURCE="$ROOT/src-tauri/icons/source"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
DESKTOP="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$NAME.desktop"

refresh() {
  gtk-update-icon-cache -q -f -t "$ICONS" 2>/dev/null || true
  update-desktop-database -q "$(dirname "$DESKTOP")" 2>/dev/null || true
}

if [ "${1:-}" = "--retirer" ]; then
  rm -f "$DESKTOP" "$ICONS"/*/apps/"$NAME".png "$ICONS/scalable/apps/$NAME.svg"
  refresh
  echo "Lanceur et icônes retirés."
  exit 0
fi

[ -x "$BINARY" ] || { echo "Prototype non compilé : $BINARY" >&2; exit 1; }

# Le dessin adapté sert aux petites tailles, le dessin normal aux autres.
for size in 16 24 32 48 64 128 256; do
  design=icone
  [ "$size" -le 24 ] && design=icone-petite
  mkdir -p "$ICONS/${size}x${size}/apps"
  rsvg-convert -w "$size" "$SOURCE/$design.svg" -o "$ICONS/${size}x${size}/apps/$NAME.png"
done
mkdir -p "$ICONS/scalable/apps"
cp "$SOURCE/icone.svg" "$ICONS/scalable/apps/$NAME.svg"

mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<DESKTOP_ENTRY
[Desktop Entry]
Type=Application
Name=Schreibdrang (prototype)
GenericName=Écriture de fiction
Comment=Écrire un roman, une nouvelle, un scénario ou une pièce de théâtre
Exec=$BINARY
Icon=$NAME
Terminal=false
Categories=Office;WordProcessor;
StartupWMClass=Schreibdrang-prototype
DESKTOP_ENTRY

refresh
echo "Lanceur installé : $DESKTOP"

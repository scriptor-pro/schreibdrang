#!/usr/bin/env python3
"""Télécharge les polices du prototype depuis fonts.bunny.net.

- Courier Prime (affichage) : fichiers woff2 copiés tels quels dans src/fonts/.
- Literata (export) : fonts.bunny.net ne fournit que des woff2 découpés par
  jeu de caractères ; ils sont convertis et fusionnés en un fichier TrueType
  par style dans src-tauri/resources/fonts/, lisible par le moteur PDF.

Les polices sont embarquées dans l'app : rien n'est téléchargé à l'exécution.
"""

import io
import pathlib
import urllib.request

from fontTools.merge import Merger
from fontTools.ttLib import TTFont

BASE = "https://fonts.bunny.net"
ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "src" / "fonts"
EXPORT_DIR = ROOT / "src-tauri" / "resources" / "fonts"
TMP_DIR = ROOT / "scripts" / ".fonts-tmp"

SUBSETS = ["latin", "latin-ext"]
STYLES = [
    ("400", "normal", "Regular"),
    ("400", "italic", "Italic"),
    ("700", "normal", "Bold"),
    ("700", "italic", "BoldItalic"),
]


def download(family: str, subset: str, weight: str, style: str) -> bytes:
    url = f"{BASE}/{family}/files/{family}-{subset}-{weight}-{style}.woff2"
    request = urllib.request.Request(url, headers={"User-Agent": "schreibdrang-prototype"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def main() -> None:
    for directory in (WEB_DIR, EXPORT_DIR, TMP_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    # Courier Prime : woff2 d'origine, pour la page.
    for subset in SUBSETS:
        for weight, style, _ in STYLES:
            name = f"courier-prime-{subset}-{weight}-{style}.woff2"
            (WEB_DIR / name).write_bytes(download("courier-prime", subset, weight, style))
            print("page   ", name)

    # Literata : un TrueType par style, pour l'export.
    for weight, style, label in STYLES:
        parts = []
        for subset in SUBSETS:
            font = TTFont(io.BytesIO(download("literata", subset, weight, style)))
            font.flavor = None
            path = TMP_DIR / f"literata-{subset}-{weight}-{style}.ttf"
            font.save(path)
            parts.append(str(path))
        merged = Merger().merge(parts)
        target = EXPORT_DIR / f"Literata-{label}.ttf"
        merged.save(target)
        print("export ", target.name, f"({len(merged.getBestCmap())} caractères)")

    for path in TMP_DIR.iterdir():
        path.unlink()
    TMP_DIR.rmdir()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Télécharge les polices du prototype depuis fonts.bunny.net.

- Courier Prime (affichage) : fichiers woff2 copiés tels quels dans src/fonts/ ;
  chaque style est aussi converti en TrueType pour la couverture et le PDF
  d'un scénario.
- Jost (interface) : fichiers woff2 copiés tels quels dans src/fonts/, l'italique
  compris.
- Literata (export) : fonts.bunny.net ne fournit que des woff2 découpés par
  jeu de caractères ; ils sont convertis et fusionnés en un fichier TrueType
  par style dans src-tauri/resources/fonts/, lisible par le moteur PDF.
- EB Garamond (export « Édition » d'une pièce) : comme Literata, un TrueType
  par style dans src-tauri/resources/fonts/. Les fichiers de fonts.bunny.net
  n'ont pas de petites capitales.

Les polices sont embarquées dans l'app : rien n'est téléchargé à l'exécution.
"""

import io
import pathlib
import sys
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
JOST_WEIGHTS = ["400", "700", "800"]


def download(family: str, subset: str, weight: str, style: str) -> bytes:
    url = f"{BASE}/{family}/files/{family}-{subset}-{weight}-{style}.woff2"
    request = urllib.request.Request(url, headers={"User-Agent": "schreibdrang-prototype"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def main() -> None:
    wanted = set(sys.argv[1:]) or {"courier-prime", "literata", "jost", "eb-garamond"}
    for directory in (WEB_DIR, EXPORT_DIR, TMP_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    # Jost : woff2 d'origine, pour l'interface.
    if "jost" in wanted:
        for subset in SUBSETS:
            for weight in JOST_WEIGHTS:
                name = f"jost-{subset}-{weight}-normal.woff2"
                (WEB_DIR / name).write_bytes(download("jost", subset, weight, "normal"))
                print("page   ", name)
            # L'italique sert au nom du modèle, dans la barre.
            name = f"jost-{subset}-400-italic.woff2"
            (WEB_DIR / name).write_bytes(download("jost", subset, "400", "italic"))
            print("page   ", name)

    # Courier Prime : woff2 d'origine, pour la page.
    if "courier-prime" in wanted:
        for subset in SUBSETS:
            for weight, style, _ in STYLES:
                name = f"courier-prime-{subset}-{weight}-{style}.woff2"
                (WEB_DIR / name).write_bytes(download("courier-prime", subset, weight, style))
                print("page   ", name)

        # La couverture et le PDF d'un scénario sont composés en Courier
        # Prime : le moteur PDF a besoin d'un TrueType par style, fusionné à
        # partir des mêmes fichiers.
        for weight, style, label in STYLES:
            parts = []
            for subset in SUBSETS:
                font = TTFont(WEB_DIR / f"courier-prime-{subset}-{weight}-{style}.woff2")
                font.flavor = None
                path = TMP_DIR / f"courier-prime-{subset}-{weight}-{style}.ttf"
                font.save(path)
                parts.append(str(path))
            merged = Merger().merge(parts)
            target = EXPORT_DIR / f"CourierPrime-{label}.ttf"
            merged.save(target)
            print("export ", target.name, f"({len(merged.getBestCmap())} caractères)")

    # Literata et EB Garamond : un TrueType par style, pour l'export.
    for family, prefix in (("literata", "Literata"), ("eb-garamond", "EBGaramond")):
        if family not in wanted:
            continue
        for weight, style, label in STYLES:
            parts = []
            for subset in SUBSETS:
                font = TTFont(io.BytesIO(download(family, subset, weight, style)))
                font.flavor = None
                path = TMP_DIR / f"{family}-{subset}-{weight}-{style}.ttf"
                font.save(path)
                parts.append(str(path))
            merged = Merger().merge(parts)
            target = EXPORT_DIR / f"{prefix}-{label}.ttf"
            merged.save(target)
            print("export ", target.name, f"({len(merged.getBestCmap())} caractères)")

    for path in TMP_DIR.iterdir():
        path.unlink()
    TMP_DIR.rmdir()


if __name__ == "__main__":
    main()

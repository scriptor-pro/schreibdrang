#!/usr/bin/env python3
"""Dessine l'icône de l'app (monogramme S*) et l'exporte en SVG.

Deux dessins, décrits dans identite-visuelle.md : le dessin normal, à partir
de 32 px, et le dessin adapté, pour 16 et 24 px. Le S vient de Jost 800 et il
est converti en tracé : les fichiers ne dépendent d'aucune police.
"""

import pathlib

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = ROOT / "src" / "fonts" / "jost-latin-800-normal.woff2"
OUT = ROOT / "src-tauri" / "icons" / "source"
# Copie du dessin normal pour la fenêtre « À propos ».
PAGE_COPY = ROOT / "src" / "icone.svg"

INK = "#000000"
PAPER = "#FFFFFF"
ACCENT = "#1F3FD1"

ASTERISK = (
    '<rect x="42" y="8" width="16" height="84"/>'
    '<rect x="42" y="8" width="16" height="84" transform="rotate(60 50 50)"/>'
    '<rect x="42" y="8" width="16" height="84" transform="rotate(120 50 50)"/>'
)

# nom : (filet, corps du S, x du S, ligne de base, x, y et échelle de l'astérisque)
DESIGNS = {
    "icone": (2, 84, 10, 82, 58, 8, 0.36),
    "icone-petite": (4, 80, 6, 86, 48, 4, 0.50),
}


def letter_path(font: TTFont, letter: str) -> str:
    glyphs = font.getGlyphSet()
    pen = SVGPathPen(glyphs)
    glyphs[font.getBestCmap()[ord(letter)]].draw(pen)
    return pen.getCommands()


def main() -> None:
    font = TTFont(FONT)
    units = font["head"].unitsPerEm
    path = letter_path(font, "S")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (rule, size, x, baseline, ax, ay, scale) in DESIGNS.items():
        k = size / units
        inset = rule / 2
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<rect x="{inset}" y="{inset}" width="{100 - rule}" height="{100 - rule}" '
            f'fill="{PAPER}" stroke="{INK}" stroke-width="{rule}"/>'
            f'<path d="{path}" fill="{INK}" transform="translate({x} {baseline}) scale({k:.6f} -{k:.6f})"/>'
            f'<g fill="{ACCENT}" transform="translate({ax} {ay}) scale({scale})">{ASTERISK}</g>'
            "</svg>\n"
        )
        (OUT / f"{name}.svg").write_text(svg, encoding="utf-8")
        print("écrit", OUT / f"{name}.svg")
    PAGE_COPY.write_text((OUT / "icone.svg").read_text(encoding="utf-8"), encoding="utf-8")
    print("écrit", PAGE_COPY)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Contrôle l'identité visuelle du prototype : contrastes et interdits.

Référence : identite-visuelle.md, dans le dossier du projet.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = (ROOT / "src" / "styles.css").read_text(encoding="utf-8")
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
SOURCES = {path.name: path.read_text(encoding="utf-8") for path in (ROOT / "src").glob("*.ts")}

EXPECTED = {
    "clair": {
        "aff-bg": "#FFFFFF", "aff-ink": "#000000", "aff-muted": "#5C5C5C",
        "ecr-bg": "#FAFAF7", "ecr-ink": "#1C1C1C", "ecr-muted": "#5C5C5C",
        "ecr-hint": "#6B6B6B", "ecr-selection": "#D5DCFA",
        "accent": "#1F3FD1", "on-accent": "#FFFFFF", "error": "#B3261E",
        "cork": "#C9A878",
    },
    "sombre": {
        "aff-bg": "#000000", "aff-ink": "#FFFFFF", "aff-muted": "#A8A8A3",
        "ecr-bg": "#161616", "ecr-ink": "#E6E6E1", "ecr-muted": "#A8A8A3",
        "ecr-hint": "#959590", "ecr-selection": "#2A3570",
        "accent": "#8296FF", "on-accent": "#111111", "error": "#FF8A80",
        "cork": "#4A3826",
    },
}

# (texte, fond) : rapport d'au moins 4,5 exigé.
PAIRS = [
    ("aff-ink", "aff-bg"), ("aff-muted", "aff-bg"), ("accent", "aff-bg"), ("error", "aff-bg"),
    ("ecr-ink", "ecr-bg"), ("ecr-muted", "ecr-bg"), ("ecr-hint", "ecr-bg"),
    ("accent", "ecr-bg"), ("error", "ecr-bg"),
    ("on-accent", "accent"), ("ecr-ink", "ecr-selection"),
    # Les titres de chapitre du cork board sont posés sur le liège.
    ("aff-ink", "cork"),
]

TOKEN = re.compile(r"--([a-z-]+):\s*(#[0-9a-fA-F]{6})\b")


def luminance(color: str) -> float:
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(a: str, b: str) -> float:
    high, low = sorted((luminance(a), luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def main() -> int:
    errors: list[str] = []
    # Les couleurs sombres sont déclarées deux fois, à la fin de la feuille :
    # pour le thème du système, puis pour le thème forcé.
    light_css, _, dark_css = CSS.partition("@media (prefers-color-scheme: dark)")
    found = {"clair": dict(TOKEN.findall(light_css))}
    dark_pairs = TOKEN.findall(dark_css)
    found["sombre"] = dict(dark_pairs)

    for theme, expected in EXPECTED.items():
        for name, value in expected.items():
            got = (found[theme].get(name) or "").upper()
            if got != value:
                errors.append(f"thème {theme} : --{name} vaut {got or 'rien'}, attendu {value}")
        for text, background in PAIRS:
            ratio = contrast(expected[text], expected[background])
            if ratio < 4.5:
                errors.append(f"thème {theme} : contraste {text} sur {background} = {ratio:.2f}")
    for name, value in EXPECTED["sombre"].items():
        values = [v.upper() for n, v in dark_pairs if n == name]
        if values != [value, value]:
            errors.append(f"thème sombre : --{name} doit être déclaré deux fois à {value}, trouvé {values}")

    for word in ("border-radius", "box-shadow", "gradient", "transition", "animation"):
        if word in CSS:
            errors.append(f"styles.css contient « {word} »")
    for size in re.findall(r"font-size:\s*([0-9.]+)rem", CSS):
        if float(size) < 0.8125:
            errors.append(f"styles.css : taille de {size}rem, inférieure à 13 px")
    for size in re.findall(r"font-size:\s*([0-9.]+)px", CSS):
        errors.append(f"styles.css : taille en pixels ({size}px), attendue en rem")
    for name, source in {"styles.css": CSS, "index.html": HTML, **SOURCES}.items():
        if re.search(r"https?://(?!www\.w3\.org)", source):
            errors.append(f"{name} contient une adresse réseau")
    colors = set(re.findall(r"#[0-9a-fA-F]{3,8}\b", CSS)) | set(re.findall(r"rgba?\([^)]*\)", CSS))
    allowed = {v for theme in EXPECTED.values() for v in theme.values()}
    for color in sorted(colors):
        if color.upper() not in allowed and color not in allowed:
            errors.append(f"styles.css : couleur hors palette {color}")
    if "data-regime=" not in HTML:
        errors.append("index.html : <body> sans data-regime")
    if "dataset.regime" not in SOURCES.get("app.ts", ""):
        errors.append("app.ts : le régime n'est pas mis à jour par show()")

    for line in errors:
        print("ÉCHEC", line)
    print("OK" if not errors else f"{len(errors)} problème(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

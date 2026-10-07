#!/usr/bin/env python3
"""Dessine le grain du liège du cork board : src/liege.png.

Le liège aggloméré est fait de granules serrés, de teintes légèrement
différentes, séparés par des joints plus sombres, avec çà et là un éclat
foncé. L'image reproduit cela par un pavage de cellules irrégulières.

C'est une tuile transparente, qui se répète sans raccord visible et se pose
sur la couleur de fond du liège (variable CSS --cork) : la même image sert
ainsi aux deux thèmes. Le tirage est fixé : relancer le script redonne la
même image. Dépendances : numpy, scipy et Pillow.
"""

import pathlib

import numpy as np
from PIL import Image, ImageFilter
from scipy.spatial import cKDTree

SIZE = 384
GRANULES = 1700
COLORS = 64
OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "liege.png"

DARK = np.array([40, 24, 10])
LIGHT = np.array([255, 240, 208])


def main() -> None:
    rng = np.random.default_rng(183)
    seeds = rng.uniform(0, SIZE, size=(GRANULES, 2))
    # Les granules sont répétés autour de la tuile pour que le pavage se
    # raccorde d'un bord à l'autre.
    offsets = np.array([(dx, dy) for dx in (-SIZE, 0, SIZE) for dy in (-SIZE, 0, SIZE)])
    points = (seeds[None, :, :] + offsets[:, None, :]).reshape(-1, 2)
    owner = np.tile(np.arange(GRANULES), len(offsets))

    ys, xs = np.mgrid[0:SIZE, 0:SIZE]
    pixels = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], axis=1)
    # Pour chaque pixel : le granule le plus proche, et l'écart avec le
    # suivant, qui est faible le long des joints.
    distances, indexes = cKDTree(points).query(pixels, k=2)
    nearest = owner[indexes[:, 0]]
    gap = distances[:, 1] - distances[:, 0]

    # Teinte de chaque granule : de plus sombre (-1) à plus clair (+1), et
    # quelques éclats nettement foncés.
    tone = rng.normal(0, 0.45, GRANULES).clip(-1, 1)
    fleck = rng.random(GRANULES) < 0.035
    tone[fleck] = -rng.uniform(1.6, 2.4, fleck.sum())
    shade = tone[nearest]
    # Grain fin à l'intérieur des granules.
    shade = shade + rng.normal(0, 0.12, len(pixels))

    dark_alpha = np.where(shade < 0, -shade * 52, 0)
    light_alpha = np.where(shade > 0, shade * 58, 0)
    # Joints entre granules : plus sombres, sur un à deux pixels.
    joint = (1 - gap / 1.8).clip(0, 1) * 74
    dark_alpha = np.maximum(dark_alpha, joint)

    alpha = np.where(dark_alpha >= light_alpha, dark_alpha, light_alpha).clip(0, 150)
    color = np.where((dark_alpha >= light_alpha)[:, None], DARK, LIGHT)
    rgba = np.concatenate([color, alpha[:, None]], axis=1).astype(np.uint8).reshape(SIZE, SIZE, 4)

    # Léger adouci, appliqué sur la tuile entourée de ses copies pour ne pas
    # créer de raccord aux bords.
    tile = Image.fromarray(rgba, "RGBA")
    wide = Image.new("RGBA", (SIZE * 3, SIZE * 3))
    for dx in range(3):
        for dy in range(3):
            wide.paste(tile, (dx * SIZE, dy * SIZE))
    wide = wide.filter(ImageFilter.GaussianBlur(0.55))
    tile = wide.crop((SIZE, SIZE, SIZE * 2, SIZE * 2))
    # Réduite à 64 couleurs, l'image garde le même aspect et pèse sept fois
    # moins (une cinquantaine de kilo-octets).
    tile = tile.quantize(colors=COLORS, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    tile.save(OUT, optimize=True)
    print("écrit", OUT, OUT.stat().st_size, "octets")


if __name__ == "__main__":
    main()

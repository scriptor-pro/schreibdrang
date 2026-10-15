#!/usr/bin/env python3
"""Télécharge Grammalecte 2.3.0, dans sa version JavaScript (extension Firefox,
licence GPL 3), et copie le correcteur dans public/grammalecte/, sans les
synonymes ni les données de tests.

Les fichiers sont embarqués dans l'app : rien n'est téléchargé à l'exécution.
"""

import hashlib
import io
import pathlib
import shutil
import sys
import urllib.request
import zipfile

URL = "https://addons.mozilla.org/firefox/downloads/file/4643560/grammalecte_fr-2.3.0.xpi"
SHA256 = "443030004dbf62ecd5fc42f7b96872b96c9e3765f1cba4704a2a4170bb945256"
ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
TARGET = PUBLIC / "grammalecte"
# Fichiers de l'extension dont le correcteur n'a pas besoin.
LEFT_OUT = {
    "grammalecte/tests.js",
    "grammalecte/fr/tests_data.json",
    "grammalecte/fr/thesaurus.js",
    "grammalecte/fr/thesaurus1_data.json",
    "grammalecte/fr/thesaurus2_data.json",
}


def main() -> int:
    request = urllib.request.Request(URL, headers={"User-Agent": "schreibdrang-prototype"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        print(f"Empreinte inattendue : {digest}", file=sys.stderr)
        return 1
    if TARGET.exists():
        shutil.rmtree(TARGET)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            if not name.startswith("grammalecte/") or name.endswith("/") or name in LEFT_OUT or ".." in name:
                continue
            path = PUBLIC / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.read(name))
    # La licence de Grammalecte est la GPL 3, dont le texte est celui du prototype.
    shutil.copyfile(ROOT / "LICENSE", TARGET / "LICENSE")
    print(f"Grammalecte copié dans {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

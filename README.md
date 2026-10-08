# Schreibdrang*

\* le besoin impérieux d'écrire

Schreibdrang est une app de bureau pour écrire de la fiction : roman, nouvelle, scénario, pièce de théâtre, et un format libre sans réglages. Elle est francophone, elle n'utilise aucune IA, et c'est un logiciel libre, distribué sous licence GPL 3 ou ultérieure.

Ce dépôt contient le **prototype** : une version de travail qui sert à valider les choix techniques et l'identité visuelle. Ce n'est pas encore l'app.

## État du prototype

Version 0.0.32, testée uniquement sous Debian 12 (XFCE, X11). macOS et Windows ne sont pas testés.

Ce qui fonctionne :

- **Écriture** d'un texte au format roman (chapitres en `#`, scènes en `##`), en Courier Prime, avec le compte des caractères et des mots.
- **Format vanilla** : un texte d'un seul tenant, sans réglages propres et sans cork board. Le format d'un texte est retenu avec la liste des textes récents ; un fichier inconnu s'ouvre comme un roman.
- **Cork board** : les scènes en fiches sur un fond en liège, à réordonner à la souris ou au clavier, d'un chapitre à l'autre.
- **Fichiers** : nouveau, ouvrir, enregistrer, enregistrer sous, et la liste des cinq derniers textes sur l'écran d'accueil.
- **Export** en PDF, Word (.docx), OpenDocument (.odt), EPUB, Markdown et texte brut.
- **Chercher et remplacer** dans le texte, avec respect de la casse, mot entier et expression régulière.
- **Page de couverture d'un scénario**, en PDF : titre, un ou plusieurs auteurs avec leurs coordonnées, agent en option.
- **Paramètres** : thème clair ou sombre, police et taille du texte, écran affiché au lancement.
- **Plein écran**, barre de menu native, fenêtre « À propos ».

Ce qui n'existe pas encore : les formats nouvelle, scénario et théâtre, les fiches personnage et les fiches de lieu, les notes, les objectifs d'écriture, l'historique des versions, la sauvegarde vers un cloud, la correction grammaticale, l'import.

## Prérequis

- [Node.js](https://nodejs.org/) 24 ou plus récent (les tests s'appuient sur l'exécution directe du TypeScript).
- [Rust](https://www.rust-lang.org/) et les [dépendances système de Tauri 2](https://tauri.app/start/prerequisites/) (sous Debian : WebKitGTK 4.1 et ses bibliothèques de développement).
- Pour l'export : [pandoc](https://pandoc.org/) et, pour le PDF et la page de couverture, XeLaTeX.

## Compiler et lancer

```bash
npm install
npm run tauri -- build --debug --no-bundle
./src-tauri/target/debug/schreibdrang-prototype
```

Pour travailler sur l'interface avec rechargement à chaud :

```bash
npm run tauri dev
```

## Contrôles

```bash
npm test                          # réglages, textes récents, découpage en scènes
npx tsc --noEmit                  # types
python3 scripts/check-identite.py # identité visuelle
```

Le dernier script vérifie que la feuille de style respecte l'identité visuelle : couleurs de la palette aux valeurs exactes, contrastes d'au moins 4,5, aucun arrondi, aucune ombre, aucune animation, aucun texte sous 13 px, aucune ressource chargée depuis le réseau.

## Organisation du code

| Chemin | Rôle |
|---|---|
| `index.html` | la page : barre, accueil, vues, boîtes de dialogue |
| `src/main.ts` | lancement : accueil complété tout de suite, puis chargement de l'app |
| `src/app.ts` | éditeur, cork board, fichiers, export, dialogues, actions du menu |
| `src/home.ts` | liste des textes récents de l'accueil |
| `src/settings.ts` | réglages : valeurs, validation, stockage |
| `src/recents.ts` | liste des textes récents |
| `src/cover.ts` | champs de la page de couverture d'un scénario |
| `src/outline.ts` | découpage du texte en chapitres et en scènes, pour le cork board |
| `src/icons.ts` | pictogrammes |
| `src/styles.css` | polices embarquées, couleurs, thèmes, toutes les règles |
| `src-tauri/src/lib.rs` | menu natif, lecture et écriture des fichiers, export, polices installées |
| `scripts/fetch-fonts.py` | télécharge les polices embarquées depuis fonts.bunny.net |
| `scripts/make-icon.py` | dessine l'icône de l'app |
| `scripts/make-cork.py` | dessine le grain du liège du cork board |
| `scripts/installer-lanceur.sh` | installe un lanceur et les icônes pour l'utilisateur |
| `scripts/check-identite.py` | contrôle de l'identité visuelle |
| `tests/` | tests des réglages, des textes récents et du découpage |

## Identité visuelle

L'interface suit le modernisme typographique : noir, blanc et un seul bleu outremer, des angles droits, des filets, aucune ombre. Seul le cork board s'en écarte, avec son fond en liège. Elle s'applique selon deux régimes : affirmée là où l'on choisit et organise (accueil, cork board, boîtes de dialogue), calme là où l'on écrit (éditeur et plein écran). Elle existe en thème clair et en thème sombre, et vise la conformité à WCAG 2.2 niveau AA et au RGAA.

Les polices et les pictogrammes sont embarqués dans l'app : rien n'est chargé depuis le réseau à l'exécution.

## Pile technique

[Tauri 2](https://tauri.app/) (Rust), TypeScript, [CodeMirror 6](https://codemirror.net/), [Vite](https://vite.dev/).

## Licence

Schreibdrang est un logiciel libre, distribué sous la licence publique générale GNU, version 3 ou toute version ultérieure (GPL 3 ou ultérieure). Le texte complet de la licence se trouve dans le fichier [`LICENSE`](LICENSE).

Composants tiers embarqués, sous leurs propres licences :

- [Jost*](https://indestructibletype.com/Jost.html), police de l'interface : SIL Open Font License 1.1.
- [Courier Prime](https://quoteunquoteapps.com/courierprime/), police du texte : SIL Open Font License 1.1.
- [Literata](https://github.com/googlefonts/literata), police des exports : SIL Open Font License 1.1.
- [Lucide](https://lucide.dev/), pictogrammes : licence ISC.

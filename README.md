# Schreibdrang*

\* le besoin impérieux d'écrire

Schreibdrang est une app de bureau pour écrire de la fiction : roman, nouvelle, scénario, pièce de théâtre, et un format libre, sans structure imposée. Elle est francophone, elle n'utilise aucune IA, et c'est un logiciel libre, distribué sous licence GPL 3 ou ultérieure.

Ce dépôt contient le **prototype** : une version de travail qui sert à valider les choix techniques et l'identité visuelle. Ce n'est pas encore l'app.

## État du prototype

Version 0.0.39, testée uniquement sous Debian 12 (XFCE, X11). macOS et Windows ne sont pas testés.

Ce qui fonctionne :

- **Écriture** d'un texte au format roman (chapitres en `#`, scènes en `##`), en Courier Prime, avec le compte des caractères et des mots.
- **Format scénario** (première étape) : écriture en Fountain avec la mise en page d'un scénario dans l'éditeur, saisie d'un dialogue par la touche Tab, coupures de page et numéros de page, une fiche par scène au cork board, export `.fountain` avec sa page de titre, export PDF à la mise en page standard (A4, Courier Prime, intitulés de scène en gras, italique et gras de Fountain), aux mêmes coupures de page que l'éditeur.
- **Templates de scénario** : huit modèles de structure (trois actes, quatre actes, huit séquences, Save the Cat, voyage du héros, Truby, cinq actes, Kishōtenketsu), choisis à la création d'un scénario ou par Scénario > Modèle…, avec une longueur cible (110 pages par défaut, de 1 à 999). L'éditeur montre la consigne de chaque étape dans la marge de droite, en face de la page où elle commence, ou dans la page si la fenêtre est étroite ; Affichage > Afficher les consignes les masque. Le modèle est retenu pour chaque fichier, et son nom suit le format dans la barre. Les consignes ne font pas partie du texte et ne sont jamais exportées.
- **Format nouvelle** : des scènes sans chapitres, avec un cork board d'une seule colonne.
- **Format du texte** : retenu pour chaque fichier ; demandé à l'ouverture d'un fichier `.md` ou `.txt` inconnu, et modifiable par Fichier > Format du texte…. Un fichier `.fountain` est toujours un scénario.
- **Import** d'un document Word (`.docx`) ou OpenDocument (`.odt`) par « Ouvrir… » : il devient un nouveau texte en Markdown, le document d'origine n'est pas modifié.
- **Format vanilla** : un texte libre, d'un seul tenant, sans cork board, compté en feuillets de 1 500 signes : le pied de page donne le feuillet du curseur et le total, un repère numéroté marque chaque feuillet dans le texte. Fichier > Mise en page… règle son interligne et ses quatre marges, retenus pour chaque fichier, visibles à l'écran sur une feuille A4 et repris par les exports PDF, Word et OpenDocument. 
- **Cork board** : les scènes en fiches sur un fond en liège, à réordonner à la souris ou au clavier, d'un chapitre à l'autre.
- **Fichiers** : nouveau, ouvrir, enregistrer, enregistrer sous, et la liste des cinq derniers textes sur l'écran d'accueil.
- **Export** en PDF, Word (.docx), OpenDocument (.odt), EPUB, Markdown et texte brut.
- **Chercher et remplacer** dans le texte, avec respect de la casse, mot entier et expression régulière.
- **Page de couverture d'un scénario**, en PDF : titre, un ou plusieurs auteurs avec leurs coordonnées, agent en option.
- **Correction** par Grammalecte, sur l'ordinateur et sans connexion : Correction > Vérifier (F7) relit la sélection ou tout le texte, en commençant par le passage affiché ; en option, le paragraphe en cours est relu pendant la frappe. Les remarques de grammaire, d'orthographe et de typographie sont soulignées en outremer, et une bulle propose les suggestions, Ignorer, Ignorer cette règle et l'ajout au dictionnaire du texte ou au dictionnaire personnel. F8 et Maj+F8 passent d'une remarque à l'autre.
- **Paramètres** : thème clair ou sombre, police et taille du texte, apostrophe typographique (’) à la frappe, activée par défaut, écran affiché au lancement.
- **Plein écran**, barre de menu native, fenêtre « À propos ».

Ce qui n'existe pas encore : le format théâtre, l'export Final Draft d'un scénario, les fiches personnage et les fiches de lieu, les notes, les objectifs d'écriture, l'historique des versions, la sauvegarde vers un cloud, l'import `.epub` et Final Draft.

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
| `src/cover.ts` | page de couverture d'un scénario, page de titre Fountain |
| `src/fountain.ts` | scénario en Fountain : nature des lignes, découpage en scènes |
| `src/pagination.ts` | découpage d'un scénario en pages, d'un texte vanilla en feuillets |
| `src/dates.ts` | dates en toutes lettres, message d'enregistrement |
| `src/miseenpage.ts` | interligne et marges d'un texte vanilla, retenus pour chaque fichier |
| `src/textes.ts` | format, modèle et longueur cible retenus pour chaque fichier, nature d'un fichier d'après son extension |
| `src/templates.ts` | modèles de scénario : page de chaque étape, consignes à montrer |
| `src/consignes.ts` | les huit modèles et leurs 91 consignes |
| `src/outline.ts` | découpage du texte en chapitres et en scènes, pour le cork board |
| `src/icons.ts` | pictogrammes |
| `src/styles.css` | polices embarquées, couleurs, thèmes, toutes les règles |
| `src-tauri/src/lib.rs` | menu natif, lecture et écriture des fichiers, export, polices installées |
| `src/correction/` | correction : passages à relire, remarques, dictionnaires, client du moteur, soulignement et bulle |
| `public/correction/worker.js` | le worker qui fait tourner Grammalecte |
| `public/grammalecte/` | Grammalecte 2.3.0, embarqué |
| `scripts/fetch-grammalecte.py` | télécharge Grammalecte et vérifie son empreinte |
| `scripts/fetch-fonts.py` | télécharge les polices embarquées depuis fonts.bunny.net |
| `scripts/make-icon.py` | dessine l'icône de l'app |
| `scripts/make-cork.py` | dessine le grain du liège du cork board |
| `scripts/installer-lanceur.sh` | installe un lanceur et les icônes pour l'utilisateur |
| `scripts/check-identite.py` | contrôle de l'identité visuelle |
| `tests/` | tests des réglages, des textes récents, du découpage et des modèles de scénario |

## Identité visuelle

L'interface suit le modernisme typographique : noir, blanc et un seul bleu outremer, des angles droits, des filets, aucune ombre. Seul le cork board s'en écarte, avec son fond en liège. Elle s'applique selon deux régimes : affirmée là où l'on choisit et organise (accueil, cork board, boîtes de dialogue), calme là où l'on écrit (éditeur et plein écran). Elle existe en thème clair et en thème sombre, et vise la conformité à WCAG 2.2 niveau AA et au RGAA.

Les polices, les pictogrammes et le correcteur sont embarqués dans l'app : rien n'est chargé depuis le réseau à l'exécution.

## Pile technique

[Tauri 2](https://tauri.app/) (Rust), TypeScript, [CodeMirror 6](https://codemirror.net/), [Vite](https://vite.dev/).

## Licence

Schreibdrang est un logiciel libre, distribué sous la licence publique générale GNU, version 3 ou toute version ultérieure (GPL 3 ou ultérieure). Le texte complet de la licence se trouve dans le fichier [`LICENSE`](LICENSE).

Composants tiers embarqués, sous leurs propres licences :

- [Jost*](https://indestructibletype.com/Jost.html), police de l'interface : SIL Open Font License 1.1.
- [Courier Prime](https://quoteunquoteapps.com/courierprime/), police du texte : SIL Open Font License 1.1.
- [Literata](https://github.com/googlefonts/literata), police des exports : SIL Open Font License 1.1.
- [Lucide](https://lucide.dev/), pictogrammes : licence ISC.
- [Grammalecte](https://grammalecte.net/) 2.3.0, par Olivier R., correction : licence GPL 3. Tant qu'il en fait partie, l'app est de fait distribuée sous GPL 3.

// L'app proprement dite : éditeur, cork board, fichiers, export, dialogues et
// actions du menu. main.ts la charge une fois l'accueil affiché.

import { minimalSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, WidgetType, drawSelection, keymap } from "@codemirror/view";
import { Compartment, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { redo, selectAll, undo } from "@codemirror/commands";
import { closeSearchPanel, findNext, findPrevious, openSearchPanel } from "@codemirror/search";
import type Sortable from "sortablejs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { FORMAT_NAMES, recentsList, renderRecents } from "./home";
import { parseDocument, serializeDocument } from "./outline";
import type { Chapter, Scene } from "./outline";
import { MAX_SIZE, MIN_SIZE, applySettings, loadSettings, normalizeSettings, saveSettings } from "./settings";
import type { Settings } from "./settings";
import { addRecent, formatOf, loadRecents, removeRecent, saveRecents } from "./recents";
import type { Format, Recent } from "./recents";
import { AUTHOR_FIELDS, loadCover, missingFields, normalizeAuthor, normalizeCover, saveCover, titlePage } from "./cover";
import { classifyLines, couldBeCharacter, hasTitlePage, parseScreenplay, sceneTitle as screenplaySceneTitle } from "./fountain";
import type { LineKind } from "./fountain";
import { pageAt, paginate, printedPages } from "./pagination";
import type { PageBreak } from "./pagination";
import type { Author, AuthorField, Cover, Missing } from "./cover";

// Les réglages ont déjà été appliqués par main.ts.
let settings: Settings = loadSettings();

// ---------------------------------------------------------------------------
// Texte de test : environ 100 000 mots, avec accents et signes typographiques
// ---------------------------------------------------------------------------

const PARAGRAPHS = [
  "Élise ouvrit la fenêtre et l'air glacé de février s'engouffra dans la pièce. « Tu comptes rester là longtemps ? » demanda-t-elle sans se retourner. Derrière elle, le vieil homme haussa les épaules, l'œil rivé sur la théière.",
  "— Ça dépend, répondit-il enfin. Où veux-tu que j'aille ? Le cœur n'y est plus, tu le sais bien… Il s'interrompit, chercha ses mots, puis reprit d'une voix plus sourde : « Ton père, lui, n'aurait jamais hésité. »",
  "La ville s'étendait au-delà du fleuve, grise et têtue, hérissée de cheminées. Çà et là, une lumière s'allumait derrière un carreau ; quelqu'un, quelque part, préparait le dîner. Noël approchait — personne n'en parlait.",
  "Elle connaissait par cœur le trajet jusqu'à la gare : trois cent quarante pas jusqu'au pont, puis la côte, puis l'escalier aux marches inégales. À mi-chemin, l'épicerie de Mme Kœnig, fermée depuis l'été, où l'on vendait autrefois des bonbons à la violette.",
  "« Naïf ! » s'était-il écrié la veille, et le mot résonnait encore. Elle aurait dû répliquer, bien sûr. Elle aurait dû lui dire ce qu'elle pensait de sa prudence, de ses silences, de cette façon qu'il avait de plier sa serviette en quatre avant de quitter la table.",
  "Le train de 18 h 47 n'arriva pas. Sur le quai, les voyageurs se regardaient à la dérobée, gênés d'attendre ensemble. Un enfant pleurait ; sa mère, épuisée, fredonnait une chanson dont elle avait oublié les paroles.",
];

// Les scènes d'un roman ne sont pas numérotées : chaque titre de test combine
// un lieu et un moment, ce qui donne 256 titres distincts.
const PLACES = [
  "La fenêtre",
  "Le pont",
  "Le quai",
  "Le sommet",
  "L'épicerie",
  "L'escalier",
  "La gare",
  "Le fleuve",
  "La cuisine",
  "Le grenier",
  "La côte",
  "Le cimetière",
  "L'atelier",
  "La place",
  "Le jardin",
  "La chambre",
];

const MOMENTS = [
  "à l'aube",
  "le matin",
  "à midi",
  "l'après-midi",
  "au crépuscule",
  "le soir",
  "la nuit",
  "sous la pluie",
  "sous la neige",
  "un dimanche",
  "la veille de Noël",
  "en février",
  "au printemps",
  "en plein été",
  "à l'automne",
  "des années plus tard",
];

function sceneTitle(n: number): string {
  return `${PLACES[n % PLACES.length]}, ${MOMENTS[Math.floor(n / PLACES.length) % MOMENTS.length]}`;
}

function buildText(targetWords: number): string {
  const parts: string[] = [];
  let words = 0;
  let chapter = 0;
  let scene = 0;
  let i = 0;
  while (words < targetWords) {
    if (i % 40 === 0) {
      chapter += 1;
      parts.push(`# Chapitre ${chapter}`);
    }
    if (i % 10 === 0) {
      scene += 1;
      parts.push(`## ${sceneTitle(scene - 1)}`);
    }
    // Le décalage fait commencer chaque scène par un paragraphe différent.
    const p = PARAGRAPHS[(i + scene) % PARAGRAPHS.length];
    parts.push(p);
    words += p.split(/\s+/).length;
    i += 1;
  }
  return parts.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Pied de page : compteurs et latence de frappe
// ---------------------------------------------------------------------------

const countsEl = document.querySelector<HTMLSpanElement>("#counts")!;
const latencyEl = document.querySelector<HTMLSpanElement>("#latency")!;

const fmt = new Intl.NumberFormat("fr-FR");

let countTimer: number | undefined;

function scheduleCounts(view: EditorView) {
  window.clearTimeout(countTimer);
  countTimer = window.setTimeout(() => {
    const text = view.state.doc.toString();
    const words = text.match(/\S+/g)?.length ?? 0;
    let counts = `${fmt.format(text.length)} caractères, ${fmt.format(words)} mots`;
    // Scénario : la page où se trouve le curseur, et le nombre de pages.
    const layout = view.state.field(screenplayLayout, false);
    if (layout) {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      counts += `, page ${pageAt(layout.breaks, line.number - 1, head - line.from)} sur ${layout.breaks.length + 1}`;
    }
    countsEl.textContent = counts;
  }, 400);
}

// Temps écoulé entre l'appui sur une touche et l'affichage qui suit la modification.
const samples: number[] = [];
let keyTime = 0;

function recordLatency() {
  if (!keyTime) return;
  const start = keyTime;
  keyTime = 0;
  requestAnimationFrame(() => {
    samples.push(performance.now() - start);
    if (samples.length > 50) samples.shift();
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const max = Math.max(...samples);
    latencyEl.textContent = `Latence de frappe : moy. ${avg.toFixed(1)} ms, max ${max.toFixed(0)} ms (50 dernières touches)`;
  });
}

// ---------------------------------------------------------------------------
// Éditeur
// ---------------------------------------------------------------------------

// Les espaces insécables sont signalées par un petit « ° », comme dans les
// traitements de texte. Le caractère reste dans la page (simple marquage, pas
// de remplacement) : il garde sa largeur et empêche toujours la coupure.
const nbspDecorator = new MatchDecorator({
  // L'espace insécable et l'espace fine insécable.
  regexp: /[\u00a0\u202f]/g,
  decoration: Decoration.mark({ class: "cm-nbsp" }),
});

const showNbsp = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = nbspDecorator.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = nbspDecorator.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Vrai dès que le texte affiché a été modifié depuis son chargement ou son
// dernier enregistrement.
let dirty = false;

// Fichier associé au texte affiché ; indéfini tant qu'il n'a jamais été enregistré.
let currentPath: string | undefined;

const filenameEl = document.querySelector<HTMLSpanElement>("#filename")!;

// Format du texte affiché. Un texte vanilla est d'un seul tenant : il n'a pas
// de cork board. Un scénario est écrit en Fountain.
let currentFormat: Format = "roman";

// Titre et œuvre d'origine saisis pour la couverture du scénario affiché.
let coverTitle = "";
let coverSource = "";

const formatEl = document.querySelector<HTMLSpanElement>("#format")!;

function setFormat(format: Format) {
  currentFormat = format;
  formatEl.textContent = `Format ${FORMAT_NAMES[format]}`;
  btnBoard.disabled = format === "vanilla";
  // Le menu Scénario n'agit qu'au format scénario.
  invoke("set_menu_item_enabled", { id: "scenario-cover", enabled: format === "scenario" }).catch((error) => {
    setStatus(`le menu Scénario n'a pas pu être mis à jour (${error})`, true);
  });
}

function setDirty(value: boolean) {
  dirty = value;
  const name = currentPath ? currentPath.split(/[\\/]/).pop()! : "Sans titre";
  const label = dirty ? `${name} (modifié)` : name;
  if (filenameEl.textContent !== label) filenameEl.textContent = label;
  filenameEl.title = currentPath ?? "";
}

// Mise en valeur du Markdown sans autre couleur que celles de l'identité :
// la graisse et l'italique portent le sens, les marques passent en texte
// secondaire.
const textHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator, tags.quote], color: "var(--muted)" },
  { tag: [tags.link, tags.url], textDecoration: "underline" },
]);

// Scénario : chaque ligne reçoit une classe selon sa nature (intitulé de
// scène, personnage, dialogue…), et la mise en page d'un scénario s'ensuit.
// La nature d'une ligne dépend de ses voisines : tout le texte est relu à
// chaque modification, mais seules les lignes visibles sont décorées.
const FOUNTAIN_LINES = Object.fromEntries(
  (
    ["title", "scene", "character", "parenthetical", "dialogue", "transition", "centered", "section", "synopsis", "pagebreak"] as LineKind[]
  ).map((kind) => [kind, Decoration.line({ class: `cm-fountain-${kind}` })]),
);

// Coupure de page : un filet, et le numéro de la page qui commence, à droite
// et suivi d'un point. La première page n'en a pas.
class PageBreakWidget extends WidgetType {
  constructor(readonly page: number) {
    super();
  }
  eq(other: PageBreakWidget) {
    return other.page === this.page;
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-page-break";
    element.setAttribute("aria-label", `Page ${this.page}`);
    const rule = document.createElement("span");
    rule.className = "cm-page-rule";
    const number = document.createElement("span");
    number.className = "cm-page-number";
    number.textContent = `${this.page}.`;
    element.append(rule, number);
    return element;
  }
}

// Mise en page du scénario, recalculée à chaque modification du texte : la
// nature de chaque ligne, et les coupures de page qui en découlent.
interface ScreenplayLayout {
  kinds: LineKind[];
  breaks: PageBreak[];
  decorations: DecorationSet;
}

function computeLayout(state: EditorState): ScreenplayLayout {
  const lines = state.doc.toJSON();
  const kinds = classifyLines(lines);
  const breaks = paginate(lines, kinds);
  const decorations = Decoration.set(
    breaks.map((start, index) => {
      const widget = new PageBreakWidget(index + 2);
      const from = state.doc.line(start.line + 1).from;
      // En début de ligne, la coupure se place entre deux lignes ; au milieu
      // d'un paragraphe, elle s'insère dans le texte.
      return start.offset > 0
        ? Decoration.widget({ widget, side: -1 }).range(from + start.offset)
        : Decoration.widget({ widget, side: -1, block: true }).range(from);
    }),
  );
  return { kinds, breaks, decorations };
}

const screenplayLayout = StateField.define<ScreenplayLayout>({
  create: computeLayout,
  update: (value, tr) => (tr.docChanged ? computeLayout(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

// Saisie d'un dialogue. Tab fait de la ligne en cours un nom de personnage :
// tant que le curseur y reste, ce qu'on tape passe en capitales. Entrée ouvre
// ensuite la ligne de dialogue. Chaque repère est le début d'une ligne ; il
// tombe quand le curseur quitte cette ligne.
interface DialogueEntry {
  character: number | null;
  dialogue: number | null;
}

const NO_ENTRY: DialogueEntry = { character: null, dialogue: null };
const setDialogueEntry = StateEffect.define<DialogueEntry>();

const dialogueEntry = StateField.define<DialogueEntry>({
  create: () => NO_ENTRY,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) if (effect.is(setDialogueEntry)) next = effect.value;
    if (next === value && tr.docChanged) {
      // Les repères suivent le texte, et restent en début de ligne.
      const follow = (pos: number | null) => (pos === null ? null : tr.state.doc.lineAt(tr.changes.mapPos(pos, -1)).from);
      next = { character: follow(value.character), dialogue: follow(value.dialogue) };
    }
    const line = tr.state.doc.lineAt(tr.state.selection.main.head).from;
    const character = next.character === line ? line : null;
    const dialogue = next.dialogue === line ? line : null;
    if (character === null && dialogue === null) return NO_ENTRY;
    return character === next.character && dialogue === next.dialogue ? next : { character, dialogue };
  },
});

const fountainLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      const entryChanged = update.startState.field(dialogueEntry) !== update.state.field(dialogueEntry);
      if (update.docChanged || update.viewportChanged || entryChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const { kinds } = view.state.field(screenplayLayout);
      const entry = view.state.field(dialogueEntry);
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          let kind = kinds[line.number - 1];
          // Pendant la saisie d'un dialogue, le nom du personnage et la ligne
          // de dialogue encore vide ont déjà leur mise en page.
          if (line.from === entry.character) kind = "character";
          else if (line.from === entry.dialogue && kind !== "parenthetical") kind = "dialogue";
          else if (entry.dialogue !== null && line.to + 1 === entry.dialogue && couldBeCharacter(line.text)) kind = "character";
          const decoration = FOUNTAIN_LINES[kind];
          if (decoration) builder.add(line.from, line.from, decoration);
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Vrai si la ligne suit un nom de personnage ou une didascalie : c'est là
// que s'écrit une didascalie ou une réplique.
function afterCharacter(state: EditorState, lineNumber: number): boolean {
  if (lineNumber < 2) return false;
  const previous = state.doc.line(lineNumber - 1).text;
  if (/^\s*\(.*\)\s*$/.test(previous)) return true;
  const blankAbove = lineNumber === 2 || state.doc.line(lineNumber - 2).text.trim() === "";
  return couldBeCharacter(previous) && blankAbove;
}

const dialogueKeys = Prec.high(
  keymap.of([
    {
      // Tab : la ligne en cours devient un nom de personnage, en capitales,
      // précédé d'une ligne vide.
      key: "Tab",
      run(view) {
        const { state } = view;
        const head = state.selection.main.head;
        const line = state.doc.lineAt(head);
        const blankAbove = line.number === 1 || state.doc.line(line.number - 1).text.trim() === "";
        const start = line.from + (blankAbove ? 0 : 1);
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: (blankAbove ? "" : "\n") + line.text.toLocaleUpperCase("fr") },
          selection: { anchor: start + (head - line.from) },
          effects: setDialogueEntry.of({ character: start, dialogue: null }),
          userEvent: "input",
        });
        return true;
      },
    },
    {
      // Maj + Tab quitte la saisie d'un dialogue ; sinon, le focus sort de l'éditeur.
      key: "Shift-Tab",
      run(view) {
        if (view.state.field(dialogueEntry) === NO_ENTRY) return false;
        view.dispatch({ effects: setDialogueEntry.of(NO_ENTRY) });
        return true;
      },
    },
    {
      // Entrée après le nom du personnage, ou dans une didascalie : la ligne
      // suivante est la ligne de dialogue.
      key: "Enter",
      run(view) {
        const { state } = view;
        const selection = state.selection.main;
        if (!selection.empty) return false;
        const line = state.doc.lineAt(selection.head);
        const entry = state.field(dialogueEntry);
        const text = line.text.trim();
        const blankAbove = line.number === 1 || state.doc.line(line.number - 1).text.trim() === "";
        const name = text !== "" && (entry.character === line.from || (couldBeCharacter(text) && blankAbove && selection.head === line.to));
        const parenthetical = /^\(.*\)$/.test(text) && afterCharacter(state, line.number);
        if (!name && !parenthetical) return false;
        view.dispatch({
          changes: { from: line.to, insert: "\n" },
          selection: { anchor: line.to + 1 },
          effects: setDialogueEntry.of({ character: null, dialogue: line.to + 1 }),
          scrollIntoView: true,
          userEvent: "input",
        });
        return true;
      },
    },
  ]),
);

const dialogueInput = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  const line = state.doc.lineAt(from);
  // Le nom du personnage s'écrit en capitales.
  if (state.field(dialogueEntry).character === line.from) {
    const upper = text.toLocaleUpperCase("fr");
    view.dispatch({ changes: { from, to, insert: upper }, selection: { anchor: from + upper.length }, userEvent: "input.type" });
    return true;
  }
  // « ( » en début de ligne, sous le nom du personnage : une paire de
  // parenthèses, le curseur entre les deux, pour la didascalie.
  if (text === "(" && from === to && line.text.trim() === "" && afterCharacter(state, line.number)) {
    view.dispatch({ changes: { from, insert: "()" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
    return true;
  }
  // « ) » devant la parenthèse fermante déjà posée : le curseur la franchit.
  if (text === ")" && from === to && state.sliceDoc(from, from + 1) === ")" && /^\s*\(/.test(line.text)) {
    view.dispatch({ selection: { anchor: from + 1 } });
    return true;
  }
  return false;
});

// Mise en page d'un scénario, en caractères de la police à chasse fixe (dix au
// pouce). Le texte a la largeur de la page imprimée, pour que les lignes de
// l'éditeur soient celles de la page et que les coupures tombent juste :
// 60 caractères pour l'action, 35 pour le dialogue à partir du 10e, 25 pour
// la didascalie à partir du 16e ; le nom du personnage commence au 22e. Ce
// sont les positions habituelles, à 2,5, 3,1 et 3,7 pouces du bord de la page.
// Chaque largeur compte un caractère et demi de plus : l'espace qui suit le
// dernier mot d'une ligne y prend place, comme à l'impression où il ne compte
// pas. Les 6 et 2 pixels sont les marges que l'éditeur donne à toute ligne.
const fountainTheme = EditorView.theme({
  "& .cm-scroller .cm-content": { maxWidth: "calc(61.5ch + 4rem + 8px)" },
  ".cm-fountain-scene": { fontWeight: "700" },
  ".cm-fountain-character": { paddingLeft: "calc(22ch + 6px)" },
  ".cm-fountain-dialogue": { paddingLeft: "calc(10ch + 6px)", paddingRight: "calc(15ch + 2px)" },
  ".cm-fountain-parenthetical": { paddingLeft: "calc(16ch + 6px)", paddingRight: "calc(19ch + 2px)" },
  ".cm-fountain-transition": { textAlign: "right" },
  ".cm-fountain-centered": { textAlign: "center" },
  ".cm-fountain-section": { fontWeight: "700", color: "var(--muted)" },
  ".cm-fountain-synopsis": { fontStyle: "italic", color: "var(--muted)" },
  ".cm-fountain-title, .cm-fountain-pagebreak": { color: "var(--muted)" },
  // Coupure de page : ni marge ni animation, le filet de 1 px du régime écriture.
  ".cm-page-break": { display: "block", padding: "0.8em 2px 0.8em 6px", userSelect: "none", textIndent: "0" },
  ".cm-page-rule": { display: "block", borderTop: "1px solid var(--ink)" },
  ".cm-page-number": { display: "block", paddingTop: "0.4em", textAlign: "right", fontWeight: "400", fontStyle: "normal", color: "var(--muted)" },
});

// Libellés du panneau de recherche de l'éditeur.
const SEARCH_PHRASES = {
  Find: "Chercher",
  Replace: "Remplacer par",
  next: "Suivant",
  previous: "Précédent",
  all: "Tout sélectionner",
  "match case": "Respecter la casse",
  regexp: "Expression régulière",
  "by word": "Mot entier",
  replace: "Remplacer",
  "replace all": "Tout remplacer",
  close: "Fermer",
  "current match": "occurrence actuelle",
  "on line": "à la ligne",
  "replaced $ matches": "$ occurrences remplacées",
  "replaced match on line $": "occurrence remplacée à la ligne $",
};

// Le repère des espaces insécables s'affiche ou se masque sans recréer l'éditeur.
const nbspMarks = new Compartment();

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      minimalSetup,
      // Aucune animation : le curseur ne clignote pas.
      drawSelection({ cursorBlinkRate: 0 }),
      EditorState.phrases.of(SEARCH_PHRASES),
      // Dans le panneau de recherche comme dans le texte : Échap ferme le
      // panneau, F3 et Ctrl + G passent d'une occurrence à l'autre.
      keymap.of([
        { key: "Escape", run: closeSearchPanel, scope: "editor search-panel" },
        { key: "F3", run: findNext, shift: findPrevious, scope: "editor search-panel", preventDefault: true },
        { key: "Mod-g", run: findNext, shift: findPrevious, scope: "editor search-panel", preventDefault: true },
      ]),
      // Un scénario est mis en valeur ligne par ligne ; les autres formats
      // sont du Markdown.
      currentFormat === "scenario"
        ? [screenplayLayout, dialogueEntry, fountainLines, fountainTheme, dialogueKeys, dialogueInput]
        : [markdown(), syntaxHighlighting(textHighlight)],
      EditorView.lineWrapping,
      // Les styles de l'éditeur passent par un thème : une feuille CSS ordinaire
      // est écrasée par les règles par défaut de CodeMirror.
      EditorView.theme({
        "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--ink)" },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": {
          fontFamily: "var(--font-text)",
          fontSize: "var(--text-size)",
          lineHeight: "1.6",
          overflow: "auto",
        },
        ".cm-content": {
          maxWidth: "72ch",
          margin: "0",
          padding: "2rem 2rem 40vh",
          caretColor: "var(--ink)",
        },
        // Le curseur et la sélection de CodeMirror sont pensés pour un fond
        // clair : sans ces règles, ils disparaissent en thème sombre.
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)" },
        ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
          backgroundColor: "var(--ecr-selection)",
        },
        // Panneau de recherche : police et formes de l'interface, sans les
        // dégradés, les arrondis ni les couleurs par défaut de CodeMirror.
        ".cm-panels": { backgroundColor: "var(--bg)", color: "var(--ink)", fontSize: "0.9375rem" },
        ".cm-panels-bottom": { borderTop: "1px solid var(--ink)" },
        ".cm-panel.cm-search": { padding: "0.5rem 2.5rem 0.5rem 1rem" },
        ".cm-panel.cm-search label": { fontSize: "100%", marginRight: "0.75rem", whiteSpace: "nowrap" },
        ".cm-panel.cm-search input[type=checkbox]": { accentColor: "var(--accent)" },
        ".cm-textfield": {
          fontSize: "100%",
          minHeight: "28px",
          padding: "0.125rem 0.5rem",
          border: "1px solid var(--ink)",
          borderRadius: "0",
          backgroundColor: "var(--bg)",
          color: "var(--ink)",
        },
        ".cm-button": {
          fontSize: "100%",
          fontWeight: "700",
          minHeight: "28px",
          padding: "0.125rem 0.75rem",
          border: "1px solid var(--ink)",
          borderRadius: "0",
          backgroundImage: "none",
          backgroundColor: "transparent",
          color: "var(--ink)",
          cursor: "pointer",
        },
        ".cm-button:active": { backgroundImage: "none" },
        ".cm-panel.cm-search [name=close]": {
          top: "0.5rem",
          right: "0.5rem",
          minWidth: "28px",
          minHeight: "28px",
          fontSize: "1.25rem",
          color: "var(--ink)",
          cursor: "pointer",
        },
        // Les occurrences : un contour d'accent, jamais la couleur seule ;
        // l'occurrence actuelle est en aplat d'accent.
        ".cm-searchMatch": { backgroundColor: "var(--ecr-selection)", outline: "1px solid var(--accent)" },
        ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent)", color: "var(--on-accent)" },
        ".cm-searchMatch.cm-searchMatch-selected *": { color: "inherit" },
        ".cm-nbsp": { position: "relative" },
        ".cm-nbsp::after": {
          content: '"°"',
          position: "absolute",
          left: "0",
          width: "100%",
          textAlign: "center",
          color: "var(--muted)",
          pointerEvents: "none",
        },
      }),
      nbspMarks.of(settings.nbsp ? showNbsp : []),
      EditorView.contentAttributes.of({ spellcheck: "false", lang: "fr" }),
      EditorView.domEventHandlers({
        keydown() {
          keyTime = performance.now();
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          if (!dirty) setDirty(true);
          recordLatency();
          scheduleCounts(update.view);
        } else if (update.selectionSet && currentFormat === "scenario") {
          // Le numéro de la page en cours suit le curseur.
          scheduleCounts(update.view);
        }
      }),
    ],
  });
}

const view = new EditorView({
  parent: document.querySelector<HTMLDivElement>("#editor")!,
  state: createState(""),
});

scheduleCounts(view);

// ---------------------------------------------------------------------------
// Cork board : construit à partir du texte, et réécrit le texte à chaque dépôt
// ---------------------------------------------------------------------------

const board = document.querySelector<HTMLDivElement>("#board")!;
const chapterOf = new WeakMap<Element, Chapter>();
const sceneOf = new WeakMap<Element, Scene>();
let sortables: Sortable[] = [];
// Change à chaque reconstruction du cork board.
let boardGeneration = 0;

// Texte placé avant le premier chapitre : il n'apparaît pas sur le cork
// board, mais il est remis en tête du texte à chaque dépôt.
let boardPreamble = "";

// Titre de la dernière scène déplacée, pour la retrouver en revenant au texte.
let movedHeading: string | undefined;

function summary(body: string): string {
  const words = body.split(/\s+/);
  return words.slice(0, 14).join(" ") + (words.length > 14 ? "…" : "");
}

function applyBoardOrder(moved?: Element) {
  const chapters: Chapter[] = [];
  for (const column of board.querySelectorAll(".chapter")) {
    const chapter = chapterOf.get(column)!;
    chapter.scenes = [...column.querySelectorAll(".card")].map((card) => sceneOf.get(card)!);
    chapters.push(chapter);
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: serializeDocument({ preamble: boardPreamble, chapters }) },
  });
  const scene = moved && sceneOf.get(moved);
  if (scene) movedHeading = scene.heading;
}

function buildBoard() {
  for (const sortable of sortables) sortable.destroy();
  sortables = [];
  boardGeneration += 1;
  board.replaceChildren();

  const text = view.state.doc.toString();
  const outline = currentFormat === "scenario" ? parseScreenplay(text) : parseDocument(text);
  boardPreamble = outline.preamble;
  for (const chapter of outline.chapters) {
    const column = document.createElement("div");
    column.className = "chapter";
    chapterOf.set(column, chapter);
    const heading = document.createElement("h2");
    // Un scénario sans section n'a qu'une colonne, sans titre dans le texte.
    heading.textContent = chapter.heading.replace(/^#\s*/, "") || "Scènes";
    heading.tabIndex = 0;
    heading.setAttribute("aria-roledescription", "chapitre déplaçable");
    heading.setAttribute("aria-describedby", "board-help");
    const cards = document.createElement("div");
    cards.className = "cards";
    cards.setAttribute("role", "list");
    cards.setAttribute("aria-label", heading.textContent);
    for (const scene of chapter.scenes) {
      const card = document.createElement("article");
      card.className = "card";
      card.tabIndex = 0;
      card.setAttribute("role", "listitem");
      card.setAttribute("aria-roledescription", "fiche déplaçable");
      card.setAttribute("aria-describedby", "board-help");
      sceneOf.set(card, scene);
      const h3 = document.createElement("h3");
      h3.textContent = currentFormat === "scenario" ? screenplaySceneTitle(scene.heading) : scene.heading.replace(/^##\s*/, "");
      const p = document.createElement("p");
      p.textContent = summary(scene.body);
      card.append(h3, p);
      cards.append(card);
    }
    column.append(heading, cards);
    board.append(column);

  }

  enableDragging(boardGeneration);
}

// Le glisser-déposer (SortableJS) n'est chargé qu'à la première ouverture du
// cork board ; en attendant, les fiches se déplacent déjà au clavier.
async function enableDragging(generation: number) {
  let create: typeof Sortable.create;
  try {
    create = (await import("sortablejs")).default.create;
  } catch (error) {
    setStatus(`le glisser-déposer n'a pas pu être chargé (${error})`, true);
    return;
  }
  // Le cork board a pu être reconstruit pendant le chargement.
  if (generation !== boardGeneration) return;

  for (const cards of board.querySelectorAll<HTMLElement>(".cards")) {
    // forceFallback : le glisser-déposer passe par les événements de pointeur,
    // car Tauri intercepte le glisser-déposer HTML5 natif.
    sortables.push(
      create(cards, {
        group: "scenes",
        // Pas d'animation : dans une grille, un seul déplacement fait glisser
        // beaucoup de fiches à la fois, ce qui alourdit le geste.
        animation: 0,
        forceFallback: true,
        ghostClass: "ghost",
        dragClass: "dragging",
        onEnd: (event) => applyBoardOrder(event.item),
      }),
    );
  }

  // Les chapitres eux-mêmes se réordonnent par leur titre.
  sortables.push(
    create(board, {
      animation: 0,
      forceFallback: true,
      handle: "h2",
      onEnd: () => applyBoardOrder(),
    }),
  );
}

// ---------------------------------------------------------------------------
// Cork board au clavier : alternative au glisser-déposer
//
// Tab atteint une fiche ou un titre de chapitre ; les flèches passent de l'un
// à l'autre. Entrée ou Espace saisit l'élément, les flèches le déplacent,
// Entrée ou Espace le dépose, Échap le remet à sa place d'origine.
// ---------------------------------------------------------------------------

const boardStatus = document.querySelector<HTMLSpanElement>("#board-status")!;

type Direction = "left" | "right" | "up" | "down";

const DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

// Élément saisi (une fiche ou une colonne de chapitre) et sa place d'origine.
let grabbed: { item: HTMLElement; focus: HTMLElement; parent: Element; next: Element | null } | undefined;

function announce(message: string) {
  boardStatus.textContent = message;
}

function cardsOf(column: Element | null | undefined): HTMLElement | null {
  return column?.querySelector<HTMLElement>(".cards") ?? null;
}

function describe(focus: HTMLElement): string {
  if (focus.classList.contains("card")) {
    const column = focus.closest(".chapter")!;
    const siblings = [...focus.parentElement!.children];
    const title = focus.querySelector("h3")!.textContent;
    const chapter = column.querySelector("h2")!.textContent;
    return `« ${title} » : ${chapter}, position ${siblings.indexOf(focus) + 1} sur ${siblings.length}`;
  }
  const columns = [...board.children];
  return `${focus.textContent} : position ${columns.indexOf(focus.parentElement!) + 1} sur ${columns.length}`;
}

function moveCard(card: HTMLElement, direction: Direction): boolean {
  const column = card.closest(".chapter")!;
  const previous = cardsOf(column.previousElementSibling);
  const next = cardsOf(column.nextElementSibling);
  if (direction === "left" && card.previousElementSibling) {
    card.previousElementSibling.before(card);
  } else if (direction === "right" && card.nextElementSibling) {
    card.nextElementSibling.after(card);
  } else if ((direction === "left" || direction === "up") && previous) {
    previous.append(card);
  } else if ((direction === "right" || direction === "down") && next) {
    next.prepend(card);
  } else {
    return false;
  }
  return true;
}

function moveChapter(column: HTMLElement, direction: Direction): boolean {
  if ((direction === "up" || direction === "left") && column.previousElementSibling) {
    column.previousElementSibling.before(column);
  } else if ((direction === "down" || direction === "right") && column.nextElementSibling) {
    column.nextElementSibling.after(column);
  } else {
    return false;
  }
  return true;
}

function focusNeighbour(focus: HTMLElement, direction: Direction) {
  let target: HTMLElement | null | undefined;
  const column = focus.closest(".chapter")!;
  if (focus.classList.contains("card")) {
    const all = [...board.querySelectorAll<HTMLElement>(".card")];
    const index = all.indexOf(focus);
    if (direction === "left") target = all[index - 1];
    else if (direction === "right") target = all[index + 1];
    else if (direction === "up") target = column.querySelector("h2");
    else target = column.nextElementSibling?.querySelector("h2");
  } else {
    if (direction === "up" || direction === "left") target = column.previousElementSibling?.querySelector("h2");
    else if (direction === "right") target = column.querySelector(".card");
    else target = column.nextElementSibling?.querySelector("h2");
  }
  target?.focus();
}

function release(commit: boolean) {
  if (!grabbed) return;
  const { item, focus, parent, next } = grabbed;
  grabbed = undefined;
  item.classList.remove("grabbed");
  if (commit) {
    applyBoardOrder(focus.classList.contains("card") ? focus : undefined);
    announce(`Déposé. ${describe(focus)}.`);
  } else {
    parent.insertBefore(item, next);
    focus.focus();
    announce(`Déplacement annulé. ${describe(focus)}.`);
  }
}

board.addEventListener("keydown", (event) => {
  const focus = event.target as HTMLElement;
  const isCard = focus.classList.contains("card");
  if (!isCard && !focus.matches(".chapter > h2")) return;
  const item = isCard ? focus : focus.parentElement!;
  const direction = DIRECTIONS[event.key];

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (grabbed) {
      release(true);
    } else {
      grabbed = { item, focus, parent: item.parentElement!, next: item.nextElementSibling };
      item.classList.add("grabbed");
      announce(`Saisi. ${describe(focus)}. Flèches pour déplacer, Entrée pour déposer, Échap pour annuler.`);
    }
  } else if (event.key === "Escape" && grabbed) {
    event.preventDefault();
    release(false);
  } else if (direction) {
    event.preventDefault();
    if (!grabbed) {
      focusNeighbour(focus, direction);
    } else if (isCard ? moveCard(item, direction) : moveChapter(item, direction)) {
      // Déplacer un élément dans la page lui fait perdre le focus.
      focus.focus();
      item.scrollIntoView({ block: "nearest" });
      announce(describe(focus));
    }
  }
});

// Quitter l'élément saisi (Tab, clic ailleurs) vaut dépôt.
board.addEventListener("focusout", (event) => {
  if (grabbed && event.target === grabbed.focus && event.relatedTarget) release(true);
});

// ---------------------------------------------------------------------------
// Navigation et plein écran
// ---------------------------------------------------------------------------

const viewHome = document.querySelector<HTMLElement>("#view-home")!;
const viewText = document.querySelector<HTMLElement>("#view-text")!;
const viewBoard = document.querySelector<HTMLElement>("#view-board")!;
const btnText = document.querySelector<HTMLButtonElement>("#btn-text")!;
const btnBoard = document.querySelector<HTMLButtonElement>("#btn-board")!;
const btnFullscreen = document.querySelector<HTMLButtonElement>("#btn-fullscreen")!;

// Enregistrer et exporter n'ont pas d'objet sur l'accueil tant qu'il n'y a
// aucun texte : ni fichier ouvert, ni texte saisi.
function nothingToSave(): boolean {
  return !viewHome.hidden && !currentPath && view.state.doc.length === 0;
}

function show(which: "home" | "text" | "board") {
  release(true);
  if (which === "board") buildBoard();
  if (which === "home") renderRecents(recents);
  viewHome.hidden = which !== "home";
  viewText.hidden = which !== "text";
  viewBoard.hidden = which !== "board";
  document.body.dataset.regime = which === "text" ? "ecriture" : "affiche";
  btnText.classList.toggle("active", which === "text");
  btnBoard.classList.toggle("active", which === "board");
  for (const button of [btnSave, btnSaveAs, btnExport]) button.disabled = nothingToSave();
  if (which !== "text") view.contentDOM.blur();
  // Le focus clavier arrive sur l'action principale de l'accueil, ou sur le
  // premier chapitre du cork board.
  if (which === "home") viewHome.querySelector<HTMLElement>("#home-open")?.focus();
  if (which === "board") board.querySelector<HTMLElement>(".chapter > h2")?.focus();
  if (which === "text") {
    view.focus();
    if (movedHeading) {
      const pos = view.state.doc.toString().indexOf(movedHeading);
      movedHeading = undefined;
      if (pos >= 0) {
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: "start" }),
        });
      }
    }
  }
}

btnText.addEventListener("click", () => show("text"));
btnBoard.addEventListener("click", () => show("board"));

async function setFullscreen(on: boolean) {
  await getCurrentWindow().setFullscreen(on);
  try {
    await invoke("set_menu_visible", { visible: !on });
  } catch (error) {
    setStatus(`le menu n'a pas pu être ${on ? "masqué" : "affiché"} (${error})`, true);
  }
  document.body.classList.toggle("fullscreen", on);
  if (on) show("text");
}

async function toggleFullscreen() {
  setFullscreen(!(await getCurrentWindow().isFullscreen()));
}

btnFullscreen.addEventListener("click", () => runAction("view-fullscreen"));

// Quand l'app occupe tout l'écran, en plein écran ou dans une fenêtre
// agrandie, le texte est centré entre deux filets (voir styles.css). L'état
// est relu à chaque changement de taille de la fenêtre.
async function updateWholeScreen() {
  const appWindow = getCurrentWindow();
  try {
    const whole = (await appWindow.isFullscreen()) || (await appWindow.isMaximized());
    document.body.classList.toggle("whole-screen", whole);
  } catch {
    // État de la fenêtre illisible : le texte reste aligné à gauche.
  }
}

getCurrentWindow().onResized(updateWholeScreen);
updateWholeScreen();

window.addEventListener("keydown", (event) => {
  if (event.key === "F11") {
    event.preventDefault();
    runAction("view-fullscreen");
  } else if (event.key === "Escape" && !event.defaultPrevented && document.body.classList.contains("fullscreen")) {
    // Échap a déjà servi s'il vient de fermer le panneau de recherche.
    setFullscreen(false);
  } else if (event.ctrlKey && !event.altKey) {
    const key = event.key.toLowerCase();
    const id =
      key === "n" && !event.shiftKey ? "file-new"
      : key === "o" && !event.shiftKey ? "file-open"
      : key === "s" ? (event.shiftKey ? "file-save-as" : "file-save")
      : key === "f" && !event.shiftKey ? "file-find"
      : key === "q" && !event.shiftKey ? "file-quit"
      : undefined;
    if (id) {
      event.preventDefault();
      runAction(id);
    }
  }
});

// ---------------------------------------------------------------------------
// Fichier : nouveau, ouvrir, enregistrer, enregistrer sous
// ---------------------------------------------------------------------------

const btnNew = document.querySelector<HTMLButtonElement>("#btn-new")!;
const btnOpen = document.querySelector<HTMLButtonElement>("#btn-open")!;
const btnSave = document.querySelector<HTMLButtonElement>("#btn-save")!;
const btnSaveAs = document.querySelector<HTMLButtonElement>("#btn-save-as")!;
const newDialog = document.querySelector<HTMLDialogElement>("#new-dialog")!;
const newTitle = document.querySelector<HTMLHeadingElement>("#new-title")!;
const newConfirm = document.querySelector<HTMLButtonElement>("#new-confirm")!;
const fileStatus = document.querySelector<HTMLSpanElement>("#export-status")!;

const TEXT_FILTERS = [{ name: "Texte Markdown", extensions: ["md", "txt"] }];
const FOUNTAIN_FILTERS = [{ name: "Scénario Fountain", extensions: ["fountain", "txt"] }];
const OPEN_FILTERS = [{ name: "Texte ou scénario", extensions: ["md", "txt", "fountain"] }];

function setStatus(message: string, error = false) {
  fileStatus.textContent = error ? `Erreur : ${message}` : message;
  fileStatus.title = fileStatus.textContent;
  fileStatus.classList.toggle("error", error);
}

let recents: Recent[] = loadRecents();

function rememberRecent(path: string) {
  recents = addRecent(recents, path, currentFormat, new Date());
  saveRecents(recents);
}

function forgetRecent(path: string) {
  recents = removeRecent(recents, path);
  saveRecents(recents);
}

// Remplace le texte affiché. Un nouvel état, plutôt qu'un remplacement du
// texte : l'historique d'annulation repart de zéro et Ctrl + Z ne ramène pas
// l'ancien texte.
function loadDocument(text: string, path: string | undefined, format: Format) {
  movedHeading = undefined;
  setFormat(format);
  ({ title: coverTitle, source: coverSource } = loadCover(path));
  show("text");
  view.setState(createState(text));
  currentPath = path;
  setDirty(false);
  samples.length = 0;
  keyTime = 0;
  latencyEl.textContent = "Latence de frappe : —";
  scheduleCounts(view);
  view.focus();
}

// Action en attente de confirmation, quand le texte actuel n'est pas enregistré.
let pendingAction: (() => void) | undefined;

function confirmDiscard(title: string, confirmLabel: string, action: () => void) {
  if (document.querySelector("dialog[open]")) return;
  if (!dirty) {
    action();
    return;
  }
  pendingAction = action;
  newTitle.textContent = title;
  newConfirm.textContent = confirmLabel;
  newDialog.returnValue = "cancel";
  newDialog.showModal();
}

function requestNewDocument(format: Format) {
  confirmDiscard("Nouveau texte", "Effacer et créer", () => {
    loadDocument("", undefined, format);
    setStatus("");
  });
}

// Ouvre le fichier indiqué. Renvoie faux si la lecture a échoué ; le fichier
// sort alors de la liste des textes récents.
async function openPath(path: string): Promise<boolean> {
  try {
    const text = await invoke<string>("read_text_file", { path });
    loadDocument(text, path, formatOf(recents, path));
    rememberRecent(path);
    setStatus(`Ouvert : ${path}`);
    return true;
  } catch (error) {
    forgetRecent(path);
    setStatus(`l'ouverture de ${path} a échoué (${error})`, true);
    return false;
  }
}

async function openDocument() {
  const path = await open({ title: "Ouvrir un texte", multiple: false, filters: OPEN_FILTERS });
  if (typeof path === "string") await openPath(path);
}

function requestOpenDocument() {
  confirmDiscard("Ouvrir un texte", "Abandonner et ouvrir", openDocument);
}

async function writeDocument(path: string) {
  // Le texte est relevé avant l'écriture : une frappe pendant l'enregistrement
  // laisse le texte marqué comme modifié.
  const text = view.state.doc.toString();
  try {
    await invoke("write_text_file", { path, contents: text });
    currentPath = path;
    rememberRecent(path);
    setDirty(view.state.doc.toString() !== text);
    setStatus(`Enregistré : ${path}`);
  } catch (error) {
    setStatus(`l'enregistrement a échoué (${error})`, true);
  }
}

async function saveDocumentAs() {
  if (document.querySelector("dialog[open]")) return;
  const path = await save({
    title: "Enregistrer le texte sous",
    defaultPath: currentPath ?? (currentFormat === "scenario" ? "sans-titre.fountain" : "sans-titre.md"),
    filters: currentFormat === "scenario" ? FOUNTAIN_FILTERS : TEXT_FILTERS,
  });
  if (path) await writeDocument(path);
}

async function saveDocument() {
  if (document.querySelector("dialog[open]")) return;
  if (currentPath) await writeDocument(currentPath);
  else await saveDocumentAs();
}

btnNew.addEventListener("click", chooseNewDocument);
btnOpen.addEventListener("click", requestOpenDocument);
btnSave.addEventListener("click", saveDocument);
btnSaveAs.addEventListener("click", saveDocumentAs);

document.querySelector<HTMLButtonElement>("#new-cancel")!.addEventListener("click", () => {
  newDialog.close("cancel");
});

newDialog.addEventListener("close", () => {
  const action = pendingAction;
  pendingAction = undefined;
  if (newDialog.returnValue === "confirm") action?.();
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const FORMATS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  odt: "OpenDocument",
  epub: "EPUB",
  md: "Markdown",
  txt: "Texte brut",
  fountain: "Fountain",
};

const btnExport = document.querySelector<HTMLButtonElement>("#btn-export")!;
const exportDialog = document.querySelector<HTMLDialogElement>("#export-dialog")!;

const exportNote = document.querySelector<HTMLParagraphElement>("#export-note")!;
const exportPdfFont = document.querySelector<HTMLSpanElement>("#export-pdf-font")!;

btnExport.addEventListener("click", () => {
  // Un scénario s'exporte en PDF et en Fountain ; les autres formats de
  // texte, dans tous les formats d'export sauf ceux du scénario.
  const scenario = currentFormat === "scenario";
  let first: HTMLInputElement | undefined;
  for (const radio of exportDialog.querySelectorAll<HTMLInputElement>('input[name="format"]')) {
    const forScenario = radio.value === "fountain" || radio.value === "fdx";
    radio.disabled = radio.value === "fdx" || (radio.value !== "pdf" && forScenario !== scenario);
    radio.parentElement!.classList.toggle("disabled", radio.disabled);
    if (!radio.disabled) first ??= radio;
  }
  const checked = exportDialog.querySelector<HTMLInputElement>('input[name="format"]:checked');
  if (first && (!checked || checked.disabled)) first.checked = true;
  exportNote.hidden = !scenario;
  exportPdfFont.textContent = scenario ? "en Courier Prime" : "en Literata";
  exportDialog.returnValue = "cancel";
  exportDialog.showModal();
});

// Le nom proposé pour un export : celui du fichier, sans son extension.
function exportName(): string {
  return currentPath?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? (currentFormat === "scenario" ? "scenario" : "roman");
}

// Texte d'un export Fountain : le scénario, précédé de la page de titre tirée
// de la couverture si le texte n'en a pas déjà une et si la couverture est
// complète.
function fountainExport(): { text: string; titled: boolean } {
  const text = view.state.doc.toString();
  if (hasTitlePage(text)) return { text, titled: true };
  const cover = { ...loadCover(currentPath), title: coverTitle, source: coverSource };
  if (missingFields(cover).length) return { text, titled: false };
  return { text: `${titlePage(cover)}\n${text}`, titled: true };
}

// La couverture, si elle est complète : elle sert de page de titre au PDF.
function completeCover(): Cover | undefined {
  const cover = { ...loadCover(currentPath), title: coverTitle, source: coverSource };
  return missingFields(cover).length ? undefined : cover;
}

// PDF d'un scénario : les pages sont celles de l'éditeur, ligne pour ligne.
// Rend le message à afficher.
async function exportScreenplayPdf(path: string): Promise<string> {
  const lines = view.state.doc.toJSON();
  const cover = completeCover();
  const count = await invoke<number>("export_screenplay", { path, pages: printedPages(lines, classifyLines(lines)), cover: cover ?? null });
  const pages = count - (cover ? 1 : 0);
  const size = pages > 1 ? `${pages} pages` : "1 page";
  return cover
    ? `Exporté, ${size} et la page de titre : ${path}`
    : `Exporté sans page de titre, ${size} : ${path}. Pour en avoir une, crée d'abord la page de couverture (menu Scénario).`;
}

// « Annuler » n'est pas un bouton d'envoi : la touche Entrée dans la boîte
// de dialogue déclenche ainsi « Exporter… ».
document.querySelector<HTMLButtonElement>("#export-cancel")!.addEventListener("click", () => {
  exportDialog.close("cancel");
});

exportDialog.addEventListener("close", async () => {
  if (exportDialog.returnValue !== "export") return;
  const format = new FormData(exportDialog.querySelector("form")!).get("format") as string;
  const path = await save({
    title: "Exporter le texte",
    defaultPath: `${exportName()}.${format}`,
    filters: [{ name: FORMATS[format], extensions: [format] }],
  });
  if (!path) return;

  btnExport.disabled = true;
  setStatus(`Export ${FORMATS[format]} en cours…`);
  const start = performance.now();
  try {
    if (format === "pdf" && currentFormat === "scenario") {
      setStatus(await exportScreenplayPdf(path));
      return;
    }
    const fountain = format === "fountain" ? fountainExport() : undefined;
    await invoke("export_document", { path, format, markdown: fountain?.text ?? view.state.doc.toString() });
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    setStatus(
      fountain && !fountain.titled
        ? `Exporté sans page de titre : ${path}. Pour en avoir une, crée d'abord la page de couverture (menu Scénario).`
        : `Exporté en ${seconds} s : ${path}`,
    );
  } catch (error) {
    setStatus(`l'export a échoué (${error})`, true);
  } finally {
    btnExport.disabled = nothingToSave();
  }
});

// ---------------------------------------------------------------------------
// Écran d'accueil
// ---------------------------------------------------------------------------

// La liste des textes récents est dessinée par home.ts, dès le lancement ;
// chaque ligne porte le chemin de son fichier.
recentsList.addEventListener("click", (event) => {
  const path = (event.target as Element).closest<HTMLButtonElement>("button.recent")?.dataset.path;
  if (!path) return;
  confirmDiscard("Ouvrir un texte", "Abandonner et ouvrir", async () => {
    // Un fichier disparu sort de la liste : l'accueil est redessiné.
    if (!(await openPath(path))) renderRecents(recents);
  });
});

function loadTestText() {
  confirmDiscard("Charger le texte de test", "Abandonner et charger", () => {
    loadDocument(buildText(100_000), undefined, "roman");
    setStatus("Texte de test chargé : environ 100 000 mots.");
  });
}

// « Nouveau » propose les mêmes formats que l'accueil, dans une boîte de
// dialogue : ses cartes sont des copies de celles de l'accueil.
const homeFormats = document.querySelector<HTMLUListElement>("#formats")!;
const formatDialog = document.querySelector<HTMLDialogElement>("#format-dialog")!;
const formatChoices = document.querySelector<HTMLUListElement>("#format-choices")!;

for (const item of homeFormats.children) {
  const copy = item.cloneNode(true) as HTMLLIElement;
  copy.querySelector("button")!.removeAttribute("id");
  formatChoices.append(copy);
}

function chooseNewDocument() {
  if (document.querySelector("dialog[open]")) return;
  formatDialog.showModal();
}

function onFormatChosen(event: Event) {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-format]");
  if (!button) return;
  formatDialog.close();
  requestNewDocument(button.dataset.format as Format);
}

homeFormats.addEventListener("click", onFormatChosen);
formatChoices.addEventListener("click", onFormatChosen);

document.querySelector<HTMLButtonElement>("#format-cancel")!.addEventListener("click", () => formatDialog.close());
document.querySelector<HTMLButtonElement>("#home-open")!.addEventListener("click", requestOpenDocument);

// ---------------------------------------------------------------------------
// Paramètres : chaque réglage s'applique dès qu'il est modifié
// ---------------------------------------------------------------------------

const settingsDialog = document.querySelector<HTMLDialogElement>("#settings-dialog")!;
const settingsForm = settingsDialog.querySelector("form")!;
const fontSelect = document.querySelector<HTMLSelectElement>("#setting-font")!;
const sizeInput = document.querySelector<HTMLInputElement>("#setting-size")!;

function fillFontSelect(fonts: string[]) {
  const names = settings.font && !fonts.includes(settings.font) ? [settings.font, ...fonts] : fonts;
  fontSelect.replaceChildren(new Option("Courier Prime (par défaut)", ""), ...names.map((name) => new Option(name, name)));
  fontSelect.value = settings.font;
}

async function openSettings() {
  if (document.querySelector("dialog[open]")) return;
  for (const radio of settingsForm.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    radio.checked = radio.value === settings[radio.name as "theme" | "startup"];
  }
  sizeInput.value = String(settings.size);
  fillFontSelect([]);
  settingsDialog.showModal();
  try {
    fillFontSelect(await invoke<string[]>("list_monospace_fonts"));
  } catch (error) {
    setStatus(`la liste des polices n'a pas pu être établie (${error})`, true);
  }
}

settingsForm.addEventListener("change", () => {
  const data = new FormData(settingsForm);
  // La saisie est ramenée dans les limites ; un champ vide garde la taille actuelle.
  const typed = data.get("size") === "" ? NaN : Number(data.get("size"));
  const size = Number.isFinite(typed) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, typed)) : settings.size;
  settings = normalizeSettings({
    theme: data.get("theme"),
    font: data.get("font"),
    size,
    startup: data.get("startup"),
    nbsp: settings.nbsp,
  });
  sizeInput.value = String(settings.size);
  applySettings(settings);
  saveSettings(settings);
  // La police ou la taille ont pu changer : l'éditeur remesure ses lignes.
  view.requestMeasure();
});

// Entrée dans le champ Taille valide la saisie sans fermer la boîte.
sizeInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  sizeInput.dispatchEvent(new Event("change", { bubbles: true }));
});

// ---------------------------------------------------------------------------
// Repère des espaces insécables : affiché ou masqué depuis le menu Édition
// ---------------------------------------------------------------------------

// La case du menu suit le réglage, y compris au lancement.
function syncNbspMenu() {
  invoke("set_menu_item_checked", { id: "edit-nbsp", checked: settings.nbsp }).catch((error) => {
    setStatus(`le menu Édition n'a pas pu être mis à jour (${error})`, true);
  });
}

function toggleNbsp() {
  settings = { ...settings, nbsp: !settings.nbsp };
  saveSettings(settings);
  view.dispatch({ effects: nbspMarks.reconfigure(settings.nbsp ? showNbsp : []) });
  syncNbspMenu();
  setStatus(settings.nbsp ? "Les espaces insécables sont signalées par « ° »." : "Les espaces insécables ne sont plus signalées.");
}

syncNbspMenu();

// ---------------------------------------------------------------------------
// Recherche : le panneau de l'éditeur, ouvert sur la vue Texte
// ---------------------------------------------------------------------------

function openSearch() {
  if (viewText.hidden) show("text");
  openSearchPanel(view);
}

// ---------------------------------------------------------------------------
// Scénario : page de couverture
// ---------------------------------------------------------------------------

const coverDialog = document.querySelector<HTMLDialogElement>("#cover-dialog")!;
const coverForm = coverDialog.querySelector("form")!;
const coverError = document.querySelector<HTMLParagraphElement>("#cover-error")!;
const coverTitleInput = document.querySelector<HTMLInputElement>("#cover-field-title")!;
const coverSourceInput = document.querySelector<HTMLInputElement>("#cover-field-source")!;
const coverAuthors = document.querySelector<HTMLDivElement>("#cover-authors")!;
const coverAuthorTemplate = document.querySelector<HTMLTemplateElement>("#cover-author-template")!;
const coverAdd = document.querySelector<HTMLButtonElement>("#cover-add-author")!;

const AUTHOR_LABELS: Record<AuthorField, string> = {
  name: "le nom",
  email: "l'adresse mail",
  phone: "le numéro de téléphone",
  agentFirstName: "le prénom de l'agent",
  agentLastName: "le nom de l'agent",
  agency: "le nom de l'agence",
  agencyEmail: "l'adresse mail de l'agence",
  agencyPhone: "le numéro de téléphone de l'agence",
};

function authorInput(index: number, field: AuthorField): HTMLInputElement {
  return coverAuthors.children[index].querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;
}

// Un bloc de champs par auteur, tiré du modèle de la page ; les étiquettes
// sont reliées à leurs champs par des identifiants propres à chaque bloc.
function renderAuthors(authors: Author[]) {
  coverAuthors.replaceChildren(
    ...authors.map((author, index) => {
      const block = coverAuthorTemplate.content.firstElementChild!.cloneNode(true) as HTMLFieldSetElement;
      block.querySelector("legend")!.textContent = authors.length > 1 ? `Auteur ${index + 1}` : "Auteur";
      for (const field of AUTHOR_FIELDS) {
        const input = block.querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;
        input.id = `cover-author-${index}-${field}`;
        input.value = author[field];
        input.previousElementSibling!.setAttribute("for", input.id);
      }
      const remove = block.querySelector<HTMLButtonElement>(".cover-remove")!;
      remove.hidden = authors.length === 1;
      remove.addEventListener("click", () => {
        renderAuthors(readCover().authors.filter((_, other) => other !== index));
        showCoverError([]);
        coverAdd.focus();
      });
      return block;
    }),
  );
}

function readCover(): Cover {
  return normalizeCover({
    title: coverTitleInput.value,
    source: coverSourceInput.value,
    authors: [...coverAuthors.children].map((block) =>
      Object.fromEntries(
        [...block.querySelectorAll<HTMLInputElement>("[data-field]")].map((input) => [input.dataset.field, input.value]),
      ),
    ),
  });
}

function missingInput(missing: Missing): HTMLInputElement {
  return missing.field === "title" ? coverTitleInput : authorInput(missing.author, missing.field);
}

function showCoverError(missing: Missing[]) {
  for (const input of coverForm.querySelectorAll("input")) input.setAttribute("aria-invalid", "false");
  for (const entry of missing) missingInput(entry).setAttribute("aria-invalid", "true");

  // « il manque le titre ; pour l'auteur 2 : l'adresse mail, le numéro de téléphone »
  const several = coverAuthors.children.length > 1;
  const parts: string[] = missing.some((entry) => entry.field === "title") ? ["le titre"] : [];
  for (let index = 0; index < coverAuthors.children.length; index += 1) {
    const labels = missing
      .filter((entry) => entry.field !== "title" && entry.author === index)
      .map((entry) => AUTHOR_LABELS[entry.field as AuthorField]);
    if (labels.length) parts.push(several ? `pour l'auteur ${index + 1} : ${labels.join(", ")}` : labels.join(", "));
  }
  coverError.hidden = missing.length === 0;
  coverError.textContent = missing.length ? `Erreur : il manque ${parts.join(several ? " ; " : ", ")}.` : "";
}

function openCover() {
  if (document.querySelector("dialog[open]")) return;
  // Le titre proposé est le nom du fichier, sans son extension.
  coverTitleInput.value = coverTitle || (currentPath?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "");
  coverSourceInput.value = coverSource;
  renderAuthors(loadCover(currentPath).authors);
  showCoverError([]);
  coverDialog.returnValue = "cancel";
  coverDialog.showModal();
}

coverAdd.addEventListener("click", () => {
  const authors = [...readCover().authors, normalizeAuthor(null)];
  renderAuthors(authors);
  showCoverError([]);
  authorInput(authors.length - 1, "name").focus();
});

// Tant qu'un champ obligatoire est vide, la boîte reste ouverte et dit lequel.
coverForm.addEventListener("submit", (event) => {
  const missing = missingFields(readCover());
  showCoverError(missing);
  if (missing.length) {
    event.preventDefault();
    missingInput(missing[0]).focus();
  }
});

document.querySelector<HTMLButtonElement>("#cover-cancel")!.addEventListener("click", () => {
  coverDialog.close("cancel");
});

coverDialog.addEventListener("close", async () => {
  if (coverDialog.returnValue !== "create") return;
  const cover = readCover();
  coverTitle = cover.title;
  coverSource = cover.source;
  saveCover(cover, currentPath);
  const path = await save({
    title: "Créer la page de couverture",
    defaultPath: "couverture.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return;
  setStatus("Création de la page de couverture en cours…");
  try {
    await invoke("export_cover", { path, cover });
    setStatus(`Page de couverture créée : ${path}`);
  } catch (error) {
    setStatus(`la page de couverture n'a pas pu être créée (${error})`, true);
  }
});

// ---------------------------------------------------------------------------
// À propos
// ---------------------------------------------------------------------------

const aboutDialog = document.querySelector<HTMLDialogElement>("#about-dialog")!;

function openAbout() {
  if (document.querySelector("dialog[open]")) return;
  aboutDialog.showModal();
}

// ---------------------------------------------------------------------------
// Actions : une seule entrée pour le menu, les boutons et les raccourcis
// ---------------------------------------------------------------------------

async function editClipboard(action: "cut" | "copy" | "paste") {
  const { from, to } = view.state.selection.main;
  try {
    if (action === "paste") {
      const text = await readText();
      if (text) view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true });
    } else if (from !== to) {
      await writeText(view.state.sliceDoc(from, to));
      if (action === "cut") view.dispatch(view.state.replaceSelection(""));
    }
  } catch (error) {
    setStatus(`le presse-papiers n'a pas répondu (${error})`, true);
  }
  view.focus();
}

// Vrai quand la fermeture a été confirmée : le gestionnaire ne la retient plus.
let closing = false;

function requestQuit() {
  confirmDiscard("Quitter Schreibdrang", "Abandonner et quitter", () => {
    closing = true;
    getCurrentWindow().destroy();
  });
}

// La croix de la fenêtre et Alt+F4 passent par la même confirmation que
// « Quitter » quand le texte n'est pas enregistré.
getCurrentWindow().onCloseRequested((event) => {
  if (closing || !dirty) return;
  event.preventDefault();
  requestQuit();
});

const ACTIONS: Record<string, () => void> = {
  "file-new": chooseNewDocument,
  "file-open": requestOpenDocument,
  "file-save": saveDocument,
  "file-save-as": saveDocumentAs,
  "file-export": () => btnExport.click(),
  "file-find": openSearch,
  "file-test": loadTestText,
  "file-quit": requestQuit,
  "edit-undo": () => undo(view),
  "edit-redo": () => redo(view),
  "edit-cut": () => editClipboard("cut"),
  "edit-copy": () => editClipboard("copy"),
  "edit-paste": () => editClipboard("paste"),
  "edit-select-all": () => selectAll(view),
  "edit-nbsp": toggleNbsp,
  "edit-settings": openSettings,
  "view-home": () => show("home"),
  "view-text": () => show("text"),
  "view-board": () => show("board"),
  "view-fullscreen": toggleFullscreen,
  "scenario-cover": openCover,
  "help-about": openAbout,
};

// Actions du menu Fichier sans objet tant qu'il n'y a aucun texte ; leurs
// boutons sont alors désactivés.
const NEEDS_TEXT = new Set(["file-save", "file-save-as", "file-export"]);

// Un raccourci peut arriver deux fois, par le menu natif et par la page :
// la même action n'est exécutée qu'une fois par quart de seconde.
let lastAction = "";
let lastActionTime = 0;

function runAction(id: string) {
  const now = performance.now();
  if (id === lastAction && now - lastActionTime < 250) return;
  lastAction = id;
  lastActionTime = now;
  // Une boîte de dialogue ouverte suspend les actions du menu.
  if (document.querySelector("dialog[open]")) return;
  // Les commandes d'édition agissent sur le texte : elles n'ont de sens que
  // si la vue Texte est affichée.
  if (id.startsWith("edit-") && id !== "edit-settings" && id !== "edit-nbsp" && viewText.hidden) {
    setStatus("Cette commande agit sur le texte : affiche d'abord la vue Texte.");
    return;
  }
  if (id === "scenario-cover" && currentFormat !== "scenario") {
    setStatus("La page de couverture est propre au format scénario.");
    return;
  }
  if (id === "view-board" && currentFormat === "vanilla") {
    setStatus("Le format vanilla n'a pas de cork board : le texte est d'un seul tenant.");
    return;
  }
  if (NEEDS_TEXT.has(id) && nothingToSave()) {
    setStatus("Il n'y a pas encore de texte : crée ou ouvre d'abord un texte.");
    return;
  }
  ACTIONS[id]?.();
}

listen<string>("menu", (event) => runAction(event.payload));

// Au lancement : l'accueil, ou le dernier texte si le réglage le demande. Si
// ce texte ne peut pas être rouvert, l'accueil s'affiche avec l'erreur.
async function start() {
  const last = settings.startup === "dernier" ? recents[0] : undefined;
  if (!last || !(await openPath(last.path))) show("home");
}

start();

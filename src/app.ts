// L'app proprement dite : éditeur, cork board, fichiers, export, dialogues et
// actions du menu. main.ts la charge une fois l'accueil affiché.

import { minimalSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { BlockType, Decoration, EditorView, MatchDecorator, ViewPlugin, WidgetType, drawSelection, keymap, layer } from "@codemirror/view";
import { Compartment, Facet, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { DecorationSet, LayerMarker, ViewUpdate } from "@codemirror/view";
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
import { parseDocument, parseNovella, serializeDocument } from "./outline";
import { fileKind, importedName, knownChoice, knownFormat, loadChoices, loadTexts, saveChoices, saveTexts, withChoice, withFormat, withRecents } from "./textes";
import { NO_MODEL, TEMPLATES, choiceMessage, consignesByPage, findTemplate, normalizeChoice, shownConsignes } from "./templates";
import type { Choice, Consigne } from "./templates";
import type { Chapter, Scene } from "./outline";
import { MAX_SIZE, MIN_SIZE, applySettings, loadSettings, normalizeSettings, saveSettings } from "./settings";
import type { Settings } from "./settings";
import { addRecent, loadRecents, removeRecent, saveRecents } from "./recents";
import type { Format, Recent } from "./recents";
import { AUTHOR_FIELDS, loadCover, missingFields, normalizeAuthor, normalizeCover, saveCover, titlePage } from "./cover";
import {
  classifyLines,
  couldBeCharacter,
  hasTitlePage,
  parseScreenplay,
  sceneTitle as screenplaySceneTitle,
  upperCaseSceneHeadings,
} from "./fountain";
import type { LineKind } from "./fountain";
import { savedMessage } from "./dates";
import { DEFAULT_SETUP, formatDecimal, knownSetup, loadSetups, normalizeSetup, saveSetups, setupMessage, sheetStyle, withSetup } from "./miseenpage";
import type { PageSetup } from "./miseenpage";
import { pageAt, paginate, printedPages, printedStyles, sheets } from "./pagination";
import type { PageBreak } from "./pagination";
import type { Author, AuthorField, Cover, Missing } from "./cover";
import { correctionExtension, goToRemark } from "./correction/editeur";
import type { CorrectionActions } from "./correction/editeur";
import { Corrector } from "./correction/correcteur";
import { Engine } from "./correction/moteur";
import { isProgress } from "./correction/verification";
import { apostropheChanges, apostrophesMessage, typographicApostrophes } from "./apostrophe";
import { frenchSpacing } from "./espaces";
import { ordinalChanges, ordinalsMessage } from "./ordinaux";
import { NEW_PLAY, classifyPlay, parsePlay, playPosition, renumberChanges, renumberMessage, renumberOutline, sceneOffset } from "./theatre";
import { playLanguage, theatreExtension } from "./theatre-editeur";
import { playModel, playToPandoc } from "./theatre-pandoc";
import type { PlayLayout, PlayPage } from "./theatre-pandoc";
import { knownPlayExport, loadPlayExports, playExportKind, savePlayExports, withPlayExport } from "./theatre-exports";
import {
  emptyTextData,
  knownTextData,
  loadPersonal,
  loadTextsData,
  savePersonal,
  saveTextsData,
  withItem,
  withoutItem,
  withoutRule,
  withRule,
  withTextData,
} from "./correction/dictionnaires";
import type { TextData } from "./correction/dictionnaires";
import { emptySheetsFile, newSheetId, normalizeSheetsFile, serializeSheets, sheetNames, sidecarPath } from "./fiches";
import type { Sheet, SheetsFile } from "./fiches";
import { fold } from "./fiches-noms";
import { PROPOSAL_THRESHOLD, isGroup, isSentenceStart, mayBeCharacter, occurrences, sheetFromLabel, speakerSheet, speakers } from "./fiches-detection";
import type { Candidate, Reply, Speaker } from "./fiches-detection";
import { castChange, firstHeading, importCast, parseCast } from "./fiches-theatre";
import { activeSheet, castRewrite, nameAtCursor, peopleExtension, refreshNames } from "./fiches-editeur";
import type { PeopleHost } from "./fiches-editeur";
import { createPanel } from "./fiches-panneau";

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
    // Vanilla : le feuillet où se trouve le curseur, et le nombre de feuillets.
    const sheetBreaks = view.state.field(sheetLayout, false)?.breaks;
    if (sheetBreaks) {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      counts += `, feuillet ${pageAt(sheetBreaks, line.number - 1, head - line.from)} sur ${sheetBreaks.length + 1}`;
    }
    // Théâtre : l'acte et la scène où se trouve le curseur.
    if (currentFormat === "theatre") {
      const lines = view.state.doc.toJSON();
      const position = playPosition(lines, classifyPlay(lines), view.state.doc.lineAt(view.state.selection.main.head).number - 1);
      if (position) counts = `${position} · ${counts}`;
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
// de cork board. Une nouvelle a des scènes, sans chapitres. Un scénario est
// écrit en Fountain.
let currentFormat: Format = "roman";

// Nom, sans extension, du document Word ou OpenDocument dont le texte affiché
// a été importé : il est proposé au premier enregistrement.
let importName: string | undefined;

// Modèle et longueur cible du scénario affiché. Un texte qui n'est pas un
// scénario garde le sien en mémoire, sans l'afficher.
let currentChoice: Choice = NO_MODEL;

// Interligne et marges du texte vanilla affiché. Un texte d'un autre format
// garde les siens en mémoire, sans les appliquer.
let currentSetup: PageSetup = { ...DEFAULT_SETUP };

// Titre et œuvre d'origine saisis pour la couverture du scénario affiché.
let coverTitle = "";
let coverSource = "";

const formatEl = document.querySelector<HTMLSpanElement>("#format")!;

// La barre dit le format, suivi du nom du modèle pour un scénario qui en a un.
function refreshFormatLabel() {
  formatEl.textContent = `Format ${FORMAT_NAMES[currentFormat]}`;
  const template = currentFormat === "scenario" ? findTemplate(currentChoice.model) : undefined;
  if (!template) return;
  const name = document.createElement("em");
  name.textContent = template.name;
  formatEl.append(" · ", name);
}

function setFormat(format: Format) {
  currentFormat = format;
  refreshFormatLabel();
  btnBoard.disabled = format === "vanilla";
  // La mise en page ne se règle qu'au format vanilla.
  invoke("set_menu_item_enabled", { id: "file-layout", enabled: format === "vanilla" }).catch((error) => {
    setStatus(`le menu Fichier n'a pas pu être mis à jour (${error})`, true);
  });
  // Les menus du scénario n'agissent qu'au format scénario.
  for (const id of ["scenario-model", "scenario-cover", "view-consignes"]) {
    invoke("set_menu_item_enabled", { id, enabled: format === "scenario" }).catch((error) => {
      setStatus(`le menu n'a pas pu être mis à jour (${error})`, true);
    });
  }
  // La renumérotation n'agit que sur une pièce.
  invoke("set_menu_item_enabled", { id: "theatre-renumber", enabled: format === "theatre" }).catch((error) => {
    setStatus(`le menu Théâtre n'a pas pu être mis à jour (${error})`, true);
  });
}

// Un fichier .fountain est toujours un scénario : son format ne se change pas.
function refreshFormatMenu() {
  const fixed = currentPath !== undefined && fileKind(currentPath) === "fountain";
  invoke("set_menu_item_enabled", { id: "file-format", enabled: !fixed }).catch((error) => {
    setStatus(`le menu Fichier n'a pas pu être mis à jour (${error})`, true);
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

const TIGHT_SCENE = Decoration.line({ class: "cm-fountain-scene cm-fountain-scene-tight" });

// Consignes du modèle, par page, pour le scénario affiché. La liste est vide
// sans modèle, hors du format scénario, ou quand l'affichage est masqué.
const NO_CONSIGNES = new Map<number, Consigne[]>();
const NO_ITEMS: Consigne[] = [];

const consignesFacet = Facet.define<Map<number, Consigne[]>, Map<number, Consigne[]>>({
  combine: (values) => values[0] ?? NO_CONSIGNES,
});

// Les consignes changent sans recréer l'éditeur : l'historique d'annulation est gardé.
const consignesConf = new Compartment();

function consignesExtension() {
  return consignesFacet.of(settings.consignes && currentFormat === "scenario" ? consignesByPage(currentChoice) : NO_CONSIGNES);
}

// Les consignes d'une page : le nom de chaque étape en gras, puis son texte.
// Elles ne font pas partie du scénario.
function consignesBlock(items: Consigne[], className: string): HTMLElement {
  const block = document.createElement("span");
  block.className = `cm-consignes ${className}`;
  for (const item of items) {
    const consigne = document.createElement("span");
    consigne.className = "cm-consigne";
    const name = document.createElement("b");
    name.textContent = item.name;
    consigne.append(name, item.text);
    block.append(consigne);
  }
  return block;
}

// Les consignes sont-elles dans la marge, ou dans la page faute de place ?
// C'est un état de l'éditeur : en changer redessine les unes et retire les
// autres dans la même mise à jour. Le dernier état connu sert de départ à
// l'éditeur suivant, pour que les consignes ne changent pas de place sous les
// yeux à chaque ouverture.
let lastInMargin = true;
const setConsignesInMargin = StateEffect.define<boolean>();

const consignesInMargin = StateField.define<boolean>({
  create: () => lastInMargin,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setConsignesInMargin)) value = effect.value;
    return value;
  },
});

function refreshConsignes() {
  view.dispatch({ effects: consignesConf.reconfigure(consignesExtension()) });
}

// Coupure de page : un filet, et le numéro de la page qui commence, à droite
// et suivi d'un point. La première page n'en a pas. Quand la fenêtre n'a pas
// de marge, les consignes de la page sont dessous, centrées. Le même repère
// marque les feuillets d'un texte vanilla.
class PageBreakWidget extends WidgetType {
  constructor(
    readonly page: number,
    readonly consignes: Consigne[],
    readonly unit = "Page",
  ) {
    super();
  }
  eq(other: PageBreakWidget) {
    return other.page === this.page && other.consignes === this.consignes && other.unit === this.unit;
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-page-break";
    element.setAttribute("aria-label", `${this.unit} ${this.page}`);
    const rule = document.createElement("span");
    rule.className = "cm-page-rule";
    const number = document.createElement("span");
    number.className = "cm-page-number";
    number.textContent = `${this.page}.`;
    element.append(rule, number);
    if (this.consignes.length) element.append(consignesBlock(this.consignes, "cm-consignes-in-page"));
    return element;
  }
}

// Les consignes de la première page, en tête du texte, quand la fenêtre n'a
// pas de marge.
class FirstPageWidget extends WidgetType {
  constructor(readonly consignes: Consigne[]) {
    super();
  }
  eq(other: FirstPageWidget) {
    return other.consignes === this.consignes;
  }
  toDOM() {
    return consignesBlock(this.consignes, "cm-consignes-in-page cm-consignes-first");
  }
}

// Mise en page du scénario, recalculée à chaque modification du texte : la
// nature de chaque ligne, les coupures de page qui en découlent, et la place
// des consignes déjà atteintes.
interface ScreenplayLayout {
  kinds: LineKind[];
  breaks: PageBreak[];
  // Début de la page de chaque groupe de consignes à montrer dans la marge.
  notes: { pos: number; items: Consigne[] }[];
  decorations: DecorationSet;
}

function computeLayout(state: EditorState): ScreenplayLayout {
  const lines = state.doc.toJSON();
  const kinds = classifyLines(lines);
  const breaks = paginate(lines, kinds);
  const groups = state.facet(consignesFacet);
  const inMargin = state.field(consignesInMargin);
  const starts = breaks.map((start) => state.doc.line(start.line + 1).from + start.offset);
  const ranges = breaks.map((start, index) => {
    const widget = new PageBreakWidget(index + 2, (inMargin ? undefined : groups.get(index + 2)) ?? NO_ITEMS);
    // En début de ligne, la coupure se place entre deux lignes ; au milieu
    // d'un paragraphe, elle s'insère dans le texte.
    return start.offset > 0
      ? Decoration.widget({ widget, side: -1 }).range(starts[index])
      : Decoration.widget({ widget, side: -1, block: true }).range(starts[index]);
  });
  const first = inMargin ? undefined : groups.get(1);
  if (first) ranges.unshift(Decoration.widget({ widget: new FirstPageWidget(first), side: -1, block: true }).range(0));
  const notes = (inMargin ? shownConsignes(groups, breaks.length + 1) : []).map(([page, items]) => ({ pos: page === 1 ? 0 : starts[page - 2], items }));
  return { kinds, breaks, notes, decorations: Decoration.set(ranges) };
}

const screenplayLayout = StateField.define<ScreenplayLayout>({
  create: computeLayout,
  update: (value, tr) =>
    tr.docChanged ||
    tr.startState.facet(consignesFacet) !== tr.state.facet(consignesFacet) ||
    tr.startState.field(consignesInMargin) !== tr.state.field(consignesInMargin)
      ? computeLayout(tr.state)
      : value,
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

// Feuillets d'un texte vanilla, recalculés à chaque modification du texte :
// un repère au début de chaque feuillet, à partir du deuxième.
interface SheetLayout {
  breaks: PageBreak[];
  decorations: DecorationSet;
}

function computeSheets(state: EditorState): SheetLayout {
  const breaks = sheets(state.doc.toJSON());
  const ranges = breaks.map((start, index) => {
    const widget = new PageBreakWidget(index + 2, NO_ITEMS, "Feuillet");
    const pos = state.doc.line(start.line + 1).from + start.offset;
    return start.offset > 0 ? Decoration.widget({ widget, side: -1 }).range(pos) : Decoration.widget({ widget, side: -1, block: true }).range(pos);
  });
  return { breaks, decorations: Decoration.set(ranges) };
}

const sheetLayout = StateField.define<SheetLayout>({
  create: computeSheets,
  update: (value, tr) => (tr.docChanged ? computeSheets(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

// Dans la marge, une consigne fait 30 caractères de large, plus un caractère
// entre le filet et le texte, dans un corps réduit à 0,8.
const CONSIGNE_CHARS = 31;
const CONSIGNE_SCALE = 0.8;
// Écart entre le bord de la page et le filet de la consigne, en pixels.
const CONSIGNE_GAP = 16;
// Place laissée à la barre de défilement, pour que son apparition ne fasse
// pas basculer les consignes de la marge à la page.
const SCROLLBAR_ROOM = 28;
const HYSTERESIS = 16;

class ConsigneMarker implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly items: Consigne[],
  ) {}
  eq(other: ConsigneMarker) {
    return other.left === this.left && other.top === this.top && other.items === this.items;
  }
  draw() {
    const block = consignesBlock(this.items, "cm-consignes-margin");
    block.style.left = `${this.left}px`;
    block.style.top = `${this.top}px`;
    return block;
  }
}

// Haut de la ligne de texte qui commence à cette position, d'après les
// hauteurs que l'éditeur connaît ou estime ; le repère de coupure de page qui
// la précède n'est pas compté.
function lineTop(view: EditorView, pos: number): number {
  const block = view.lineBlockAt(pos);
  const text = Array.isArray(block.type) ? block.type.find((part) => part.type === BlockType.Text) : undefined;
  return (text ?? block).top + view.documentTop;
}

// Les consignes de la marge sont dessinées hors du texte, à droite de la
// page et à hauteur de la première ligne de leur page. Seules celles des
// pages affichées le sont.
const consignesLayer = layer({
  above: false,
  class: "cm-consignes-layer",
  update: (update) =>
    update.docChanged ||
    update.viewportChanged ||
    update.geometryChanged ||
    update.startState.field(screenplayLayout) !== update.state.field(screenplayLayout),
  markers(view) {
    const scroller = view.scrollDOM.getBoundingClientRect();
    const baseLeft = scroller.left - view.scrollDOM.scrollLeft;
    const baseTop = scroller.top - view.scrollDOM.scrollTop;
    const left = view.contentDOM.getBoundingClientRect().right - baseLeft + CONSIGNE_GAP;
    const markers: ConsigneMarker[] = [];
    for (const note of view.state.field(screenplayLayout).notes) {
      // Hors des lignes affichées, la place est celle que l'éditeur estime :
      // une consigne haute de plusieurs lignes quitte l'écran en défilant,
      // comme le texte, au lieu de disparaître d'un coup.
      const shown = note.pos >= view.viewport.from && note.pos <= view.viewport.to;
      const coords = shown ? view.coordsAtPos(note.pos, 1) : null;
      markers.push(new ConsigneMarker(left, (coords ? coords.top : lineTop(view, note.pos)) - baseTop, note.items));
    }
    return markers;
  },
});

// La marge a-t-elle la place d'une consigne ? Sinon, les consignes passent
// dans la page ; elles reviennent dans la marge dès que la fenêtre le permet.
const consignesPlace = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.measure();
    }
    update(update: ViewUpdate) {
      if (update.geometryChanged || update.viewportChanged) this.measure();
    }
    measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const inMargin = view.state.field(consignesInMargin);
          const scroller = view.scrollDOM.getBoundingClientRect();
          // Éditeur masqué (accueil, cork board) : rien à mesurer, rien ne change.
          if (scroller.width === 0) return inMargin;
          const room = scroller.right - view.contentDOM.getBoundingClientRect().right;
          const needed = CONSIGNE_CHARS * CONSIGNE_SCALE * view.defaultCharacterWidth + CONSIGNE_GAP + SCROLLBAR_ROOM;
          // Les consignes quittent la marge un peu plus tard qu'elles n'y
          // entrent : une barre de défilement qui apparaît ou disparaît ne les
          // fait pas aller et venir.
          return room >= needed - (inMargin ? HYSTERESIS : 0);
        },
        write: (margin, view) => {
          if (view.state.field(consignesInMargin) === margin) return;
          lastInMargin = margin;
          // Une mise à jour ne peut pas partir d'une mesure : elle la suit.
          window.setTimeout(() => {
            if (view.dom.isConnected && view.state.field(consignesInMargin, false) === !margin) {
              view.dispatch({ effects: setConsignesInMargin.of(margin) });
            }
          });
        },
      });
    }
  },
);

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
          // Un intitulé suivi directement de texte : la ligne vide qui le
          // suit sur la page est montrée, sans être écrite dans le texte.
          const tight = kind === "scene" && line.number < view.state.doc.lines && view.state.doc.line(line.number + 1).text.trim() !== "";
          const decoration = tight ? TIGHT_SCENE : FOUNTAIN_LINES[kind];
          if (decoration) builder.add(line.from, line.from, decoration);
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Italique et gras de Fountain : le passage entre étoiles est mis en valeur,
// et les marques qui ne s'impriment pas (étoiles, « > », « ! », « @ », point
// d'un intitulé forcé) sont masquées, de sorte que les lignes de l'éditeur
// sont celles de la page. Elles restent visibles sur la ligne du curseur,
// pour pouvoir les corriger.
const FOUNTAIN_STYLES = {
  b: Decoration.mark({ class: "cm-fountain-b" }),
  i: Decoration.mark({ class: "cm-fountain-i" }),
  bi: Decoration.mark({ class: "cm-fountain-b cm-fountain-i" }),
};
const HIDDEN_MARK = Decoration.replace({});

const fountainEmphasis = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const { state } = view;
      const { kinds } = state.field(screenplayLayout);
      const edited = new Set<number>();
      for (const range of state.selection.ranges) {
        const last = state.doc.lineAt(range.to).number;
        for (let number = state.doc.lineAt(range.from).number; number <= last; number += 1) edited.add(number);
      }
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = state.doc.lineAt(pos);
          pos = line.to + 1;
          const kind = kinds[line.number - 1];
          // Les étoiles ne mettent en valeur que ce qui s'imprime.
          if (!["scene", "action", "character", "parenthetical", "dialogue", "transition", "centered"].includes(kind)) continue;
          if (!/[*>!@.]/.test(line.text)) continue;
          const styles = printedStyles(line.text, kind);
          const first = line.text.length - line.text.trimStart().length;
          const end = line.text.trimEnd().length;
          for (let at = first; at < end; ) {
            const style = styles[at];
            let next = at + 1;
            while (next < end && styles[next] === style) next += 1;
            if (style === undefined) {
              if (!edited.has(line.number)) builder.add(line.from + at, line.from + next, HIDDEN_MARK);
            } else if (style !== "") {
              builder.add(line.from + at, line.from + next, FOUNTAIN_STYLES[style]);
            }
            at = next;
          }
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
        // Entrée à la fin d'un intitulé de scène : une ligne vide le sépare
        // de ce qui suit, comme le demande Fountain.
        if (state.field(screenplayLayout).kinds[line.number - 1] === "scene" && selection.head === line.to) {
          view.dispatch({
            changes: { from: line.to, insert: "\n\n" },
            selection: { anchor: line.to + 2 },
            scrollIntoView: true,
            userEvent: "input",
          });
          return true;
        }
        // Entrée à la fin d'une réplique : le dialogue est terminé. Une ligne
        // vide le sépare de la suite, qui est de l'action ; Tab en fait le
        // nom du personnage qui répond.
        const kind = state.field(screenplayLayout).kinds[line.number - 1];
        const reply = !name && !parenthetical && text !== "" && (kind === "dialogue" || entry.dialogue === line.from);
        if (reply && selection.head === line.to) {
          view.dispatch({
            changes: { from: line.to, insert: "\n\n" },
            selection: { anchor: line.to + 2 },
            effects: setDialogueEntry.of(NO_ENTRY),
            scrollIntoView: true,
            userEvent: "input",
          });
          return true;
        }
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
    {
      // Maj + Entrée dans une réplique : à la ligne, sans quitter le dialogue.
      key: "Shift-Enter",
      run(view) {
        const { state } = view;
        const selection = state.selection.main;
        if (!selection.empty) return false;
        const line = state.doc.lineAt(selection.head);
        const kind = state.field(screenplayLayout).kinds[line.number - 1];
        const inReply = kind === "dialogue" || (state.field(dialogueEntry).dialogue === line.from && line.text.trim() !== "");
        if (!inReply || selection.head !== line.to) return false;
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

// Typographie à la frappe, selon les réglages : l'apostrophe droite devient
// l'apostrophe typographique, et l'espace tapée devant ou après certains
// signes devient insécable (voir espaces.ts). Avant les autres saisies :
// « ’ » n'a pas de capitale, et le nom d'un personnage la garde telle quelle.
const typographyInput = Prec.high(
  EditorView.inputHandler.of((view, from, to, text) => {
    const typed = settings.apostrophe ? typographicApostrophes(text) : text;
    const line = view.state.doc.lineAt(from);
    const spacing = settings.spaces && from === to ? frenchSpacing(line.text.slice(Math.max(0, from - line.from - 8), from - line.from), typed) : null;
    if (!spacing && typed === text) return false;
    const start = from - (spacing?.back ?? 0);
    const insert = spacing?.insert ?? typed;
    view.dispatch({ changes: { from: start, to, insert }, selection: { anchor: start + insert.length }, userEvent: "input.type" });
    return true;
  }),
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

// La feuille d'un texte vanilla : une feuille A4 bordée d'un filet à gauche
// et à droite, avec l'interligne et les marges choisis pour ce texte.
const sheetConf = new Compartment();

function sheetExtension() {
  if (currentFormat !== "vanilla") return [];
  const { lineHeight, ...sheet } = sheetStyle(currentSetup);
  // Plus précis que le thème de l'éditeur, qui fixe la largeur et l'interligne.
  return EditorView.theme({
    "&.cm-editor .cm-scroller": { lineHeight },
    "& .cm-scroller .cm-content": { ...sheet, boxSizing: "border-box", borderLeft: "1px solid var(--ink)", borderRight: "1px solid var(--ink)" },
  });
}

// Coupure de page ou début de feuillet : ni marge ni animation, le filet de
// 1 px du régime écriture.
const pageBreakTheme = EditorView.theme({
  ".cm-page-break": { display: "block", padding: "0.8em 2px 0.8em 6px", userSelect: "none", textIndent: "0" },
  ".cm-page-rule": { display: "block", borderTop: "1px solid var(--ink)" },
  ".cm-page-number": { display: "block", paddingTop: "0.4em", textAlign: "right", fontWeight: "400", fontStyle: "normal", color: "var(--muted)" },
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
  // Un intitulé de scène s'affiche en majuscules, quoi qu'on ait tapé ; le
  // texte lui-même n'est pas modifié.
  ".cm-fountain-scene": { fontWeight: "700", textTransform: "uppercase" },
  // Une ligne de l'éditeur : son interligne est de 1,6.
  ".cm-fountain-scene-tight": { paddingBottom: "1.6em" },
  ".cm-fountain-b": { fontWeight: "700" },
  ".cm-fountain-i": { fontStyle: "italic" },
  ".cm-fountain-character": { paddingLeft: "calc(22ch + 6px)" },
  ".cm-fountain-dialogue": { paddingLeft: "calc(10ch + 6px)", paddingRight: "calc(15ch + 2px)" },
  ".cm-fountain-parenthetical": { paddingLeft: "calc(16ch + 6px)", paddingRight: "calc(19ch + 2px)" },
  ".cm-fountain-transition": { textAlign: "right" },
  ".cm-fountain-centered": { textAlign: "center" },
  ".cm-fountain-section": { fontWeight: "700", color: "var(--muted)" },
  ".cm-fountain-synopsis": { fontStyle: "italic", color: "var(--muted)" },
  ".cm-fountain-title, .cm-fountain-pagebreak": { color: "var(--muted)" },
  // Consignes du modèle : texte secondaire, hors du scénario, sans animation.
  ".cm-consignes": {
    display: "block",
    color: "var(--muted)",
    fontWeight: "400",
    fontStyle: "normal",
    textTransform: "none",
    textIndent: "0",
    userSelect: "none",
  },
  ".cm-consigne": { display: "block" },
  ".cm-consigne + .cm-consigne": { marginTop: "0.8em" },
  ".cm-consigne b": { display: "block", fontWeight: "700" },
  // Dans la page : centrées, sous le filet et le numéro.
  ".cm-consignes-in-page": { textAlign: "center", padding: "0.8em 4ch" },
  ".cm-consignes-first": { padding: "0 4ch 1.6em" },
  // Dans la marge : 30 caractères de large, un filet fin à gauche.
  ".cm-consignes-margin": {
    position: "absolute",
    width: "31ch",
    boxSizing: "border-box",
    paddingLeft: "1ch",
    borderLeft: "1px solid var(--muted)",
    fontSize: "0.8em",
    lineHeight: "1.45",
    pointerEvents: "none",
  },
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

// ---------------------------------------------------------------------------
// Correction : Grammalecte, à la demande (F7) ou pendant la frappe
// ---------------------------------------------------------------------------

// Pour tous les textes : le dictionnaire personnel et les règles coupées.
// Pour le texte affiché : son dictionnaire et ses remarques ignorées,
// retenus par son chemin dès qu'il en a un.
let personal = loadPersonal();
let textsData = loadTextsData();
let currentTextData: TextData = emptyTextData();

function rememberTextData() {
  if (!currentPath) return;
  textsData = withTextData(textsData, currentPath, currentTextData);
  saveTextsData(textsData);
}

const CORRECTION_ITEMS = [
  "correction-check",
  "correction-next",
  "correction-previous",
  "correction-clear",
  "correction-apostrophes",
  "correction-ordinals",
  "correction-typing",
  "correction-dictionaries",
];

const correctionStatus = document.querySelector<HTMLSpanElement>("#correction-status")!;

// Pied de page de la correction : avancement, nombre de remarques ou erreur.
function setCorrectionStatus(message: string, error = false) {
  correctionStatus.textContent = error ? `Erreur : ${message}` : message;
  correctionStatus.classList.toggle("error", error);
  correctionStatus.classList.toggle("progress", !error && isProgress(message));
}

const correctionActions: CorrectionActions = {
  suggest: (word) => corrector.suggest(word),
  stop: () => corrector.stop(),
  ignore(remark) {
    currentTextData = { ...currentTextData, ignored: withItem(currentTextData.ignored, remark.key) };
    rememberTextData();
    corrector.refresh();
  },
  ignoreRule(remark) {
    personal = { ...personal, rules: withRule(personal.rules, { rule: remark.rule, label: remark.label }) };
    savePersonal(personal);
    corrector.refresh();
  },
  addToText(word) {
    currentTextData = { ...currentTextData, words: withItem(currentTextData.words, word) };
    rememberTextData();
    corrector.refresh();
  },
  addToPersonal(word) {
    personal = { ...personal, words: withItem(personal.words, word) };
    savePersonal(personal);
    corrector.refresh();
  },
};

// ---------------------------------------------------------------------------
// Fiches personnage : rangées à côté du texte, dans <nom>.fiches.json
// ---------------------------------------------------------------------------

let currentFiches: SheetsFile = emptySheetsFile();
// Le fichier des fiches existe mais ne se lit pas : il ne sera pas écrasé, et
// les fiches sont désactivées pour ce texte, pour qu'aucune ne soit créée en
// vain. « Enregistrer sous » vers un autre nom les rétablit.
let fichesBlocked = false;
let blockedSidecar = "";
// Le fichier des fiches existait à l'ouverture, ou les fiches ont changé
// depuis : il faut l'écrire à l'enregistrement, même vide.
let fichesToWrite = false;

const PROTECTED_MESSAGE = "La liste des personnages se modifie par les fiches : Personnages > Liste des personnages.";

// Rien des fiches n'agit au format page blanche.
function peopleEnabled(): boolean {
  return currentFormat !== "vanilla" && !fichesBlocked;
}

// Au théâtre, l'app tient la liste en tête de pièce quand l'auteur l'a accepté.
function castManaged(): boolean {
  return currentFormat === "theatre" && currentFiches.listeTenue === true;
}

// La partie protégée de la liste, recalculée seulement quand le texte change.
let protectedCache: { doc: unknown; range: { from: number; to: number } | undefined } | undefined;

function protectedRange(): { from: number; to: number } | undefined {
  if (!castManaged()) return undefined;
  const doc = view.state.doc;
  if (protectedCache?.doc !== doc) {
    const block = parseCast(doc.toString(), true);
    protectedCache = { doc, range: block ? { from: block.from, to: block.generatedTo } : undefined };
  }
  return protectedCache.range;
}

const peopleHost: PeopleHost = {
  sheets: () => (peopleEnabled() ? currentFiches.personnages : []),
  format: () => currentFormat,
  enabled: peopleEnabled,
  completion: () => settings.nameCompletion,
  open: (ids) => openSheets(ids, false),
  typedWord: (candidate) => void proposeForWord(candidate),
  protectedRange,
  refused: () => setStatus(PROTECTED_MESSAGE),
};

// Au théâtre et au scénario : quand le curseur change de ligne, les
// personnages qui parlent sans fiche sont proposés.
let lastPeopleLine = -1;
let speakerTimer: number | undefined;
const peopleWatcher = EditorView.updateListener.of((update) => {
  if (currentFormat !== "theatre" && currentFormat !== "scenario") return;
  if (!update.selectionSet && !update.docChanged) return;
  const line = update.state.doc.lineAt(update.state.selection.main.head).number;
  if (line === lastPeopleLine) return;
  lastPeopleLine = line;
  window.clearTimeout(speakerTimer);
  speakerTimer = window.setTimeout(proposeForSpeakers, 400);
});

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
        ? [consignesInMargin, screenplayLayout, consignesLayer, consignesPlace, dialogueEntry, fountainLines, fountainEmphasis, fountainTheme, pageBreakTheme, dialogueKeys, dialogueInput]
        : [currentFormat === "theatre" ? playLanguage() : markdown(), syntaxHighlighting(textHighlight)],
      // Une pièce : mise en forme de chaque ligne, saisie guidée, bandeau.
      currentFormat === "theatre" ? theatreExtension() : [],
      // Un texte vanilla se compte en feuillets, sur une feuille à sa mise en page.
      currentFormat === "vanilla" ? [sheetLayout, pageBreakTheme] : [],
      sheetConf.of(sheetExtension()),
      // Présent dans tous les formats, pour être réglé sans condition.
      consignesConf.of(consignesExtension()),
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
      typographyInput,
      correctionExtension(correctionActions),
      peopleExtension(peopleHost),
      peopleWatcher,
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
          corrector.typed();
        } else if (update.selectionSet && (currentFormat === "scenario" || currentFormat === "vanilla" || currentFormat === "theatre")) {
          // Le numéro de la page, du feuillet, ou l'acte et la scène en cours suivent le curseur.
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

const corrector = new Corrector({
  view,
  format: () => currentFormat,
  settings: () => settings,
  personal: () => personal,
  textData: () => currentTextData,
  // Les noms des fiches personnage sont acceptés par l'orthographe.
  names: () => (peopleEnabled() ? currentFiches.personnages.flatMap(sheetNames) : []),
  status: setCorrectionStatus,
  // Le worker n'est créé qu'à la première vérification.
  createEngine: () => new Engine(() => new Worker("/correction/worker.js")),
});

scheduleCounts(view);

// ---------------------------------------------------------------------------
// Fiches personnage : panneau, propositions, liste en tête de pièce
// ---------------------------------------------------------------------------

const peopleRoot = document.querySelector<HTMLElement>("#people")!;
const proposalEl = document.querySelector<HTMLSpanElement>("#people-proposal")!;
// La fiche affichée dans le panneau, pour Personnages > Afficher les répliques.
let shownSheet: string | undefined;

const panel = createPanel(peopleRoot, {
  file: () => currentFiches,
  changed(file, cast) {
    currentFiches = file;
    fichesToWrite = true;
    sheetsAdded();
    setDirty(true);
    view.dispatch({ effects: refreshNames.of(null) });
    if (cast) rewriteCast();
  },
  replies: (sheet) => repliesOf(sheet),
  castOffer: () => (currentFormat === "theatre" && currentFiches.listeTenue === false ? () => offerCastImport() : undefined),
  async save() {
    const saved = await saveDocument();
    if (saved) setStatus("Personnage enregistré");
    return saved;
  },
  goTo(pos) {
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
  },
  shown(id) {
    shownSheet = id;
    view.dispatch({ effects: activeSheet.of(id) });
  },
  closed: () => view.focus(),
});

// Les personnages qui parlent, gardés tant que le texte ne change pas : la
// liste sert à chaque changement de ligne du curseur.
let speakersCache: { text: string; format: "scenario" | "theatre"; list: Speaker[] } | undefined;

function speakersOf(text: string, format: "scenario" | "theatre"): Speaker[] {
  if (speakersCache?.text !== text || speakersCache.format !== format) speakersCache = { text, format, list: speakers(text, format) };
  return speakersCache.list;
}

// Les répliques d'un personnage, au scénario et au théâtre.
function repliesOf(sheet: Sheet): Reply[] | undefined {
  if (currentFormat !== "theatre" && currentFormat !== "scenario") return undefined;
  const sheets = currentFiches.personnages;
  return speakersOf(view.state.doc.toString(), currentFormat)
    .filter((speaker) => speakerSheet(speaker, sheets)?.id === sheet.id)
    .flatMap((speaker) => speaker.replies)
    .sort((a, b) => a.from - b.from);
}

// Un double-clic ou une commande : une fiche, ou le choix entre plusieurs.
function openSheets(ids: string[], focus: boolean) {
  if (ids.length > 1) panel.showChoice(ids);
  else if (ids.length === 1) panel.showSheet(ids[0], focus);
}

// Une pièce sans liste écrite à la main : l'app la tient dès la première fiche.
function sheetsAdded() {
  if (currentFormat !== "theatre" || currentFiches.listeTenue !== null || currentFiches.personnages.length === 0) return;
  const text = view.state.doc.toString();
  // Une pièce sans acte ni scène ne reçoit pas encore de liste.
  if (firstHeading(text) === undefined) return;
  const block = parseCast(text);
  if (!block || block.entries.length === 0) currentFiches.listeTenue = true;
}

// Refait la liste en tête de pièce à partir des fiches, si l'app la tient.
// Une réécriture s'annule par Ctrl + Z comme une modification du texte.
// `handwritten` : la liste est encore celle écrite à la main (juste après
// l'import), dont les lignes libres sont reconnues comme telles.
function rewriteCast(handwritten = false) {
  if (!castManaged()) return;
  const text = view.state.doc.toString();
  const change = castChange(text, currentFiches.personnages, speakersOf(text, "theatre"), !handwritten);
  if (change) view.dispatch({ changes: change, annotations: castRewrite.of(true) });
}

// Une proposition dans le pied de page : du texte, et des actions au clavier.
interface Proposal {
  text: string;
  actions: { label: string; run: () => void }[];
}

function proposeInFooter(proposal: Proposal | undefined) {
  proposalEl.replaceChildren();
  proposalEl.hidden = !proposal;
  if (!proposal) return;
  proposalEl.append(proposal.text);
  for (const action of proposal.actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      proposeInFooter(undefined);
      action.run();
      if (!panel.isOpen() || !peopleRoot.contains(document.activeElement)) view.focus();
    });
    proposalEl.append(button);
  }
}

// Ajoute des fiches, sans ouvrir le panneau.
function addSheets(sheets: Sheet[]) {
  if (sheets.length === 0) return;
  currentFiches.personnages.push(...sheets);
  fichesToWrite = true;
  sheetsAdded();
  setDirty(true);
  view.dispatch({ effects: refreshNames.of(null) });
  rewriteCast();
  panel.refresh();
}

function ignoreWord(word: string) {
  if (!currentFiches.ecartes.some((item) => fold(item) === fold(word))) currentFiches.ecartes.push(word);
  fichesToWrite = true;
  setDirty(true);
  panel.refresh();
}

// Le nombre d'occurrences d'un mot quand il a été proposé sans réponse : il
// n'est reproposé qu'à son occurrence suivante.
const proposedWords = new Map<string, number>();

// Roman et nouvelle : à la troisième apparition d'un mot qui ressemble à un
// nom de personnage, sans fiche.
async function proposeForWord(candidate: Candidate) {
  if (currentFormat !== "roman" && currentFormat !== "nouvelle") return;
  const { word } = candidate;
  if (!mayBeCharacter(word, currentFiches.personnages, currentFiches.ecartes)) return;
  const text = view.state.doc.toString();
  if (isSentenceStart(text, candidate.from)) return;
  const count = occurrences(text, word);
  if (count < PROPOSAL_THRESHOLD || count <= (proposedWords.get(word) ?? 0)) return;
  const nature = await corrector.nature(word);
  if (nature !== "prenom" && nature !== "inconnu") return;
  // Le temps de la réponse du moteur, la fiche a pu être créée ou le mot écarté.
  if (!mayBeCharacter(word, currentFiches.personnages, currentFiches.ecartes)) return;
  proposedWords.set(word, count);
  proposeInFooter({
    text: `“${word}” ressemble à un personnage.`,
    actions: [
      { label: "Créer sa fiche", run: () => panel.newSheet(word, false) },
      { label: "Ignorer", run: () => ignoreWord(word) },
    ],
  });
}

// Les personnages qui parlent sans fiche et que l'auteur n'a ni écartés ni
// remis à plus tard.
const deferredSpeakers = new Set<string>();

function speakersWithoutSheet(): Speaker[] {
  if (currentFormat !== "theatre" && currentFormat !== "scenario") return [];
  const sheets = currentFiches.personnages;
  const ignored = new Set(currentFiches.ecartes.map(fold));
  const all = speakersOf(view.state.doc.toString(), currentFormat);
  return all.filter(
    (speaker) =>
      !speakerSheet(speaker, sheets) && !isGroup(speaker, sheets, all) && !ignored.has(fold(speaker.label)) && !deferredSpeakers.has(fold(speaker.label)),
  );
}

// Le texte au dernier examen : sans changement, rien à proposer de neuf.
let speakersCheckedDoc: unknown;

function proposeForSpeakers() {
  if (!proposalEl.hidden || speakersCheckedDoc === view.state.doc) return;
  speakersCheckedDoc = view.state.doc;
  const speaker = speakersWithoutSheet()[0];
  if (!speaker) return;
  proposeInFooter({
    text: `“${speaker.label}” n'a pas de fiche.`,
    actions: [
      {
        label: "Créer sa fiche",
        run: () => {
          addSheets([sheetFromLabel(speaker.label, newSheetId(), Date.now())]);
          speakersCheckedDoc = undefined;
          proposeForSpeakers();
        },
      },
      {
        label: "Ignorer",
        run: () => {
          ignoreWord(speaker.label);
          speakersCheckedDoc = undefined;
          proposeForSpeakers();
        },
      },
    ],
  });
}

// Au théâtre : faire des fiches d'une liste écrite à la main, ou non.
function offerCastImport() {
  const block = parseCast(view.state.doc.toString());
  if (!block || block.entries.length === 0) {
    currentFiches.listeTenue = true;
    fichesToWrite = true;
    setDirty(true);
    rewriteCast();
    panel.refresh();
    return;
  }
  proposeInFooter({
    text: "Faire des fiches de la liste des personnages ?",
    actions: [
      {
        label: "Oui",
        run: () => {
          // Les entrées qui ont déjà une fiche n'en reçoivent pas une seconde.
          const missing = { ...block, entries: block.entries.filter((entry) => !speakerSheet({ label: entry.name, words: 0, first: 0, replies: [] }, currentFiches.personnages)) };
          currentFiches.listeTenue = true;
          currentFiches.personnages.push(...importCast(missing, newSheetId, Date.now()));
          fichesToWrite = true;
          setDirty(true);
          view.dispatch({ effects: refreshNames.of(null) });
          rewriteCast(true);
          panel.refresh();
          proposeGrouped();
        },
      },
      {
        label: "Non",
        run: () => {
          currentFiches.listeTenue = false;
          fichesToWrite = true;
          setDirty(true);
          panel.refresh();
          proposeGrouped();
        },
      },
    ],
  });
}

// À l'ouverture d'une pièce ou d'un scénario : une seule proposition pour
// tous les personnages qui parlent sans fiche.
function proposeGrouped() {
  const missing = speakersWithoutSheet();
  if (missing.length < 2) {
    proposeForSpeakers();
    return;
  }
  proposeInFooter({
    text: missing.length === 1 ? "1 personnage n'a pas de fiche." : `${missing.length} personnages n'ont pas de fiche.`,
    actions: [
      { label: "Les créer", run: () => addSheets(missing.map((speaker, i) => sheetFromLabel(speaker.label, newSheetId(), Date.now() + i))) },
      { label: "Plus tard", run: () => missing.forEach((speaker) => deferredSpeakers.add(fold(speaker.label))) },
    ],
  });
}

// Les propositions à l'ouverture d'un texte.
function openingProposals() {
  if (currentFormat === "theatre" && currentFiches.listeTenue === null && currentFiches.personnages.length === 0) {
    const block = parseCast(view.state.doc.toString());
    if (block && block.entries.length > 0) {
      offerCastImport();
      return;
    }
  }
  if (currentFormat === "theatre" || currentFormat === "scenario") proposeGrouped();
}

// Lit les fiches d'un texte, à côté de lui. Un fichier illisible n'est pas
// écrasé : les fiches de ce texte restent alors en lecture seule.
let fichesGeneration = 0;

async function loadFiches(path: string | undefined) {
  const generation = ++fichesGeneration;
  currentFiches = emptySheetsFile();
  fichesBlocked = false;
  fichesToWrite = false;
  proposedWords.clear();
  deferredSpeakers.clear();
  proposeInFooter(undefined);
  if (panel.isOpen()) panel.close();
  if (path) {
    const sidecar = sidecarPath(path);
    try {
      const raw = await invoke<string | null>("read_optional_text_file", { path: sidecar });
      if (generation !== fichesGeneration) return;
      if (raw !== null) {
        const file = normalizeSheetsFile(raw);
        if (file) {
          currentFiches = file;
          fichesToWrite = true;
        } else {
          fichesBlocked = true;
          blockedSidecar = sidecar;
          setStatus(`le fichier des fiches (${sidecar}) est illisible : il ne sera pas modifié, et les fiches sont désactivées pour ce texte`, true);
        }
      }
    } catch (error) {
      if (generation !== fichesGeneration) return;
      fichesBlocked = true;
      blockedSidecar = sidecar;
      setStatus(`le fichier des fiches (${sidecar}) n'a pas pu être lu (${error}) : il ne sera pas modifié, et les fiches sont désactivées pour ce texte`, true);
    }
  }
  view.dispatch({ effects: refreshNames.of(null) });
  refreshPeopleMenu();
  if (peopleEnabled()) openingProposals();
}

// Écrit les fiches à côté du texte ; une erreur ne défait pas l'enregistrement du texte.
// Renvoie false si les fiches n'ont pas été écrites alors qu'elles devaient l'être.
async function writeFiches(path: string): Promise<boolean> {
  // Enregistré sous un autre nom : le fichier illisible reste où il est, et
  // les fiches sont rétablies pour le nouveau texte.
  if (fichesBlocked && sidecarPath(path) !== blockedSidecar) {
    fichesBlocked = false;
    refreshPeopleMenu();
  }
  if (fichesBlocked) return false;
  const file = currentFiches;
  if (!fichesToWrite && file.personnages.length === 0 && file.ecartes.length === 0 && file.listeTenue === null) return true;
  const sidecar = sidecarPath(path);
  try {
    await invoke("write_text_file", { path: sidecar, contents: serializeSheets(file) });
    fichesToWrite = true;
    return true;
  } catch (error) {
    setStatus(`les fiches n'ont pas pu être enregistrées dans ${sidecar} (${error})`, true);
    return false;
  }
}

// Menu Personnages : inactif au format page blanche ; les répliques
// n'existent qu'au scénario et au théâtre.
function refreshPeopleMenu() {
  const enabled = peopleEnabled();
  for (const id of ["people-list", "people-new", "people-open"]) {
    invoke("set_menu_item_enabled", { id, enabled }).catch((error) => setStatus(`le menu Personnages n'a pas pu être mis à jour (${error})`, true));
  }
  invoke("set_menu_item_enabled", { id: "people-replies", enabled: currentFormat === "theatre" || currentFormat === "scenario" }).catch((error) =>
    setStatus(`le menu Personnages n'a pas pu être mis à jour (${error})`, true),
  );
  if (!enabled) {
    if (panel.isOpen()) panel.close();
    proposeInFooter(undefined);
  }
}

// Le mot sélectionné, ou celui sous le curseur, pour préremplir une fiche.
function wordForNewSheet(): string | undefined {
  const { from, to, head } = view.state.selection.main;
  if (from !== to) {
    const selected = view.state.sliceDoc(from, to).trim();
    return selected && !selected.includes("\n") ? selected : undefined;
  }
  const range = view.state.wordAt(head);
  return range ? view.state.sliceDoc(range.from, range.to) : undefined;
}

const PEOPLE_ACTIONS: Record<string, () => void> = {
  "people-list": () => panel.showList(),
  "people-new": () => panel.newSheet(wordForNewSheet(), true),
  "people-open": () => {
    const hit = nameAtCursor(view, currentFiches.personnages);
    if (!hit) setStatus("Aucun nom de personnage sous le curseur.");
    else openSheets(hit.ids, true);
  },
  "people-replies": () => {
    const id = shownSheet ?? nameAtCursor(view, currentFiches.personnages)?.ids[0];
    if (!id) setStatus("Ouvre d'abord une fiche, ou place le curseur sur un nom de personnage.");
    else panel.showReplies(id);
  },
};

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

// Dans une pièce, « Scène 1 » se répète d'un acte à l'autre : la scène
// déplacée est retrouvée par sa place dans le texte.
let movedAt: number | undefined;

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
  // Une pièce est renumérotée après chaque déplacement, fiches comprises.
  if (currentFormat === "theatre") {
    renumberOutline({ preamble: boardPreamble, chapters });
    for (const column of board.querySelectorAll(".chapter")) {
      const chapter = chapterOf.get(column)!;
      if (chapter.heading) column.querySelector("h2")!.textContent = chapter.heading.replace(/^#\s*/, "");
      for (const card of column.querySelectorAll(".card")) card.querySelector("h3")!.textContent = sceneOf.get(card)!.heading.replace(/^##?\s*/, "");
    }
  }
  const text = serializeDocument({ preamble: boardPreamble, chapters });
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  const scene = moved && sceneOf.get(moved);
  if (scene && currentFormat === "theatre") {
    const at = sceneOffset(text, chapters.flatMap((chapter) => chapter.scenes).indexOf(scene));
    movedAt = at >= 0 ? at : undefined;
  } else if (scene) {
    movedHeading = scene.heading;
  }
}

function buildBoard() {
  for (const sortable of sortables) sortable.destroy();
  sortables = [];
  boardGeneration += 1;
  board.replaceChildren();

  const text = view.state.doc.toString();
  const outline =
    currentFormat === "scenario"
      ? parseScreenplay(text)
      : currentFormat === "nouvelle"
        ? parseNovella(text)
        : currentFormat === "theatre"
          ? parsePlay(text)
          : parseDocument(text);
  boardPreamble = outline.preamble;
  for (const chapter of outline.chapters) {
    const column = document.createElement("div");
    column.className = "chapter";
    chapterOf.set(column, chapter);
    const heading = document.createElement("h2");
    // Un scénario sans section n'a qu'une colonne, sans titre dans le texte ;
    // dans une pièce, ce sont les scènes écrites avant le premier acte.
    heading.textContent = chapter.heading.replace(/^#\s*/, "") || (currentFormat === "theatre" ? "Avant le premier acte" : "Scènes");
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
      h3.textContent = currentFormat === "scenario" ? screenplaySceneTitle(scene.heading) : scene.heading.replace(/^##?\s*/, "");
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
  // La correction n'agit que sur la vue Texte.
  for (const id of CORRECTION_ITEMS) {
    invoke("set_menu_item_enabled", { id, enabled: which === "text" }).catch((error) => {
      setStatus(`le menu Correction n'a pas pu être mis à jour (${error})`, true);
    });
  }
  for (const button of [btnSave, btnSaveAs, btnExport]) button.disabled = nothingToSave();
  if (which !== "text") view.contentDOM.blur();
  // Le focus clavier arrive sur l'action principale de l'accueil, ou sur le
  // premier chapitre du cork board.
  if (which === "home") viewHome.querySelector<HTMLElement>("#home-open")?.focus();
  if (which === "board") board.querySelector<HTMLElement>(".chapter > h2")?.focus();
  if (which === "text") {
    view.focus();
    const pos = movedAt ?? (movedHeading ? view.state.doc.toString().indexOf(movedHeading) : -1);
    movedHeading = undefined;
    movedAt = undefined;
    if (pos >= 0) {
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
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
  } else if (event.key === "F7" && !event.shiftKey && !event.ctrlKey) {
    event.preventDefault();
    runAction("correction-check");
  } else if (event.key === "F8" && !event.ctrlKey) {
    event.preventDefault();
    runAction(event.shiftKey ? "correction-previous" : "correction-next");
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
      : key === "p" && event.shiftKey ? "people-list"
      : key === "f" && event.shiftKey ? "people-open"
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
const OPEN_FILTERS = [{ name: "Texte, scénario ou document", extensions: ["md", "txt", "fountain", "odt", "docx"] }];

function setStatus(message: string, error = false) {
  fileStatus.textContent = error ? `Erreur : ${message}` : message;
  fileStatus.title = fileStatus.textContent;
  fileStatus.classList.toggle("error", error);
}

let recents: Recent[] = loadRecents();

// Format retenu pour chaque fichier ; ceux des textes récents sont repris.
let texts = withRecents(loadTexts(), recents);
saveTexts(texts);

// Modèle et longueur cible retenus pour chaque scénario.
let choices = loadChoices();

function rememberChoice(path: string) {
  choices = withChoice(choices, path, currentChoice);
  saveChoices(choices);
}

// Mise en page retenue pour chaque texte vanilla.
let setups = loadSetups();

function rememberSetup(path: string) {
  setups = withSetup(setups, path, currentSetup);
  saveSetups(setups);
}

function rememberRecent(path: string) {
  recents = addRecent(recents, path, currentFormat, new Date());
  saveRecents(recents);
  texts = withFormat(texts, path, currentFormat);
  saveTexts(texts);
}

function forgetRecent(path: string) {
  recents = removeRecent(recents, path);
  saveRecents(recents);
}

// Remplace le texte affiché. Un nouvel état, plutôt qu'un remplacement du
// texte : l'historique d'annulation repart de zéro et Ctrl + Z ne ramène pas
// l'ancien texte.
function loadDocument(text: string, path: string | undefined, format: Format, choice?: Choice) {
  movedHeading = undefined;
  movedAt = undefined;
  // Le choix d'un fichier est celui que l'app a retenu ; un texte neuf apporte le sien.
  currentChoice = choice ?? (path ? knownChoice(choices, path) : NO_MODEL);
  currentSetup = path ? knownSetup(setups, path) : { ...DEFAULT_SETUP };
  // Les remarques du texte précédent disparaissent avec lui.
  corrector.clear();
  currentTextData = path ? knownTextData(textsData, path) : emptyTextData();
  setFormat(format);
  ({ title: coverTitle, source: coverSource } = loadCover(path));
  show("text");
  view.setState(createState(text));
  currentPath = path;
  importName = undefined;
  refreshFormatMenu();
  refreshPeopleMenu();
  lastPeopleLine = -1;
  void loadFiches(path);
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

// Un scénario neuf choisit d'abord son modèle ; « Annuler » ne crée rien.
// Une pièce neuve commence par un acte et une scène, le curseur dessous.
function requestNewDocument(format: Format) {
  const create = (choice: Choice) =>
    confirmDiscard("Nouveau texte", "Effacer et créer", () => {
      loadDocument(format === "theatre" ? NEW_PLAY : "", undefined, format, choice);
      if (format === "theatre") view.dispatch({ selection: { anchor: view.state.doc.length } });
      setStatus(format === "scenario" && choice.model ? choiceMessage(choice, modelTarget.value) : "");
    });
  if (format === "scenario") askModel("Créer", NO_MODEL, create);
  else create(NO_MODEL);
}

// Ouvre le fichier indiqué. Renvoie faux si la lecture a échoué ; le fichier
// sort alors de la liste des textes récents.
async function openPath(path: string, format?: Format): Promise<boolean> {
  try {
    const text = await invoke<string>("read_text_file", { path });
    loadDocument(text, path, knownFormat(texts, path) ?? format ?? "roman");
    rememberRecent(path);
    // Le dernier enregistrement du fichier : son heure, ou sa date s'il a
    // plus de 24 heures. Le chemin complet reste lisible au survol.
    try {
      const modified = await invoke<number>("file_modified", { path });
      setStatus(savedMessage(new Date(modified), new Date(), path));
      fileStatus.title = path;
    } catch {
      setStatus(`Ouvert : ${path}`);
    }
    return true;
  } catch (error) {
    forgetRecent(path);
    setStatus(`l'ouverture de ${path} a échoué (${error})`, true);
    return false;
  }
}

// Importe un document Word ou OpenDocument : son texte, converti en Markdown,
// devient un nouveau texte, pas encore enregistré. Le document n'est pas modifié.
async function importPath(path: string, format: Format) {
  const name = path.split(/[\\/]/).pop() ?? path;
  setStatus(`Import de ${name} en cours…`);
  try {
    const text = await invoke<string>("import_document", { path });
    loadDocument(text, undefined, format);
    importName = importedName(path);
    setDirty(true);
    setStatus(`Importé de ${name} : enregistre ce texte pour le garder.`);
    fileStatus.title = path;
  } catch (error) {
    setStatus(`l'import de ${name} a échoué (${error})`, true);
  }
}

async function openDocument() {
  const path = await open({ title: "Ouvrir un texte", multiple: false, filters: OPEN_FILTERS });
  if (typeof path !== "string") return;
  const name = path.split(/[\\/]/).pop() ?? path;
  if (fileKind(path) === "import") {
    askFormat("Importer un document", `« ${name} » va être converti en texte. Choisis son format.`, "roman", (format) => importPath(path, format));
  } else if (knownFormat(texts, path)) {
    await openPath(path);
  } else {
    // Un fichier .md ou .txt que l'app ne connaît pas ne dit pas son format.
    askFormat("Format du texte", `Schreibdrang ne connaît pas encore « ${name} ». Choisis son format.`, "roman", (format) => openPath(path, format));
  }
}

function requestOpenDocument() {
  confirmDiscard("Ouvrir un texte", "Abandonner et ouvrir", openDocument);
}

// Renvoie true si le texte et ses fiches ont été écrits.
async function writeDocument(path: string): Promise<boolean> {
  // La liste en tête de pièce est mise à jour avant d'être enregistrée.
  rewriteCast();
  // Le texte est relevé avant l'écriture : une frappe pendant l'enregistrement
  // laisse le texte marqué comme modifié.
  const text = view.state.doc.toString();
  try {
    await invoke("write_text_file", { path, contents: text });
    currentPath = path;
    importName = undefined;
    refreshFormatMenu();
    rememberRecent(path);
    // Le choix d'un scénario pas encore enregistré s'attache ici à son fichier,
    // et suit « Enregistrer sous… ». Un texte qui n'est plus un scénario garde
    // le sien, et n'hérite pas de celui d'un fichier qu'il remplace.
    rememberChoice(path);
    // De même pour la mise en page d'un texte vanilla.
    rememberSetup(path);
    // De même pour le dictionnaire et les remarques ignorées du texte.
    rememberTextData();
    setDirty(view.state.doc.toString() !== text);
    const now = new Date();
    setStatus(savedMessage(now, now, path));
    // Le chemin complet reste lisible au survol.
    fileStatus.title = path;
    // Les fiches suivent le texte, dans un fichier à côté de lui.
    return await writeFiches(path);
  } catch (error) {
    setStatus(`l'enregistrement a échoué (${error})`, true);
    return false;
  }
}

async function saveDocumentAs(): Promise<boolean> {
  if (document.querySelector("dialog[open]")) return false;
  const path = await save({
    title: "Enregistrer le texte sous",
    defaultPath: currentPath ?? `${importName ?? "sans-titre"}${currentFormat === "scenario" ? ".fountain" : ".md"}`,
    filters: currentFormat === "scenario" ? FOUNTAIN_FILTERS : TEXT_FILTERS,
  });
  return path ? await writeDocument(path) : false;
}

async function saveDocument(): Promise<boolean> {
  if (document.querySelector("dialog[open]")) return false;
  if (currentPath) return await writeDocument(currentPath);
  return await saveDocumentAs();
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
const exportFonts = exportDialog.querySelectorAll<HTMLSpanElement>(".export-font");
const exportPlay = document.querySelector<HTMLFieldSetElement>("#export-play")!;
let playExports = loadPlayExports();

// Le format de page ne se choisit que pour l'édition.
function syncPlayPage() {
  const edition = exportDialog.querySelector<HTMLInputElement>('input[name="play-layout"]:checked')?.value === "edition";
  for (const radio of exportDialog.querySelectorAll<HTMLInputElement>('input[name="play-page"]')) {
    radio.disabled = !edition;
    radio.parentElement!.classList.toggle("disabled", !edition);
  }
}

for (const radio of exportDialog.querySelectorAll<HTMLInputElement>('input[name="play-layout"]')) radio.addEventListener("change", syncPlayPage);

// Mise en page et format de page choisis dans la boîte d'export.
function chosenPlayExport(): { layout: PlayLayout; page: PlayPage } {
  const data = new FormData(exportDialog.querySelector("form")!);
  return { layout: data.get("play-layout") === "edition" ? "edition" : "manuscrit", page: data.get("play-page") === "a5" ? "a5" : "a4" };
}


btnExport.addEventListener("click", () => {
  // Un scénario s'exporte en PDF et en Fountain ; les autres formats de
  // texte, dans tous les formats d'export sauf ceux du scénario.
  const scenario = currentFormat === "scenario";
  const theatre = currentFormat === "theatre";
  let first: HTMLInputElement | undefined;
  for (const radio of exportDialog.querySelectorAll<HTMLInputElement>('input[name="format"]')) {
    const forScenario = radio.value === "fountain" || radio.value === "fdx";
    radio.disabled = radio.value === "fdx" || (radio.value !== "pdf" && forScenario !== scenario) || (theatre && radio.value === "epub");
    radio.parentElement!.classList.toggle("disabled", radio.disabled);
    if (!radio.disabled) first ??= radio;
  }
  const checked = exportDialog.querySelector<HTMLInputElement>('input[name="format"]:checked');
  if (first && (!checked || checked.disabled)) first.checked = true;
  exportNote.hidden = !scenario;
  for (const font of exportFonts) font.textContent = scenario && font === exportFonts[0] ? "en Courier Prime" : theatre ? "selon la mise en page" : "en Literata";
  // Une pièce : sa mise en page et son format de page, retenus pour chaque fichier.
  exportPlay.hidden = !theatre;
  if (theatre) {
    const known = knownPlayExport(playExports, currentPath);
    for (const radio of exportDialog.querySelectorAll<HTMLInputElement>('input[name="play-layout"], input[name="play-page"]')) {
      radio.checked = radio.value === known.layout || radio.value === known.page;
    }
    syncPlayPage();
  }
  exportDialog.returnValue = "cancel";
  exportDialog.showModal();
});

// Le nom proposé pour un export : celui du fichier, sans son extension.
function exportName(): string {
  return currentPath?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? importName ?? (currentFormat === "scenario" ? "scenario" : currentFormat === "theatre" ? "piece" : "roman");
}

// Texte d'un export Fountain : le scénario, précédé de la page de titre tirée
// de la couverture si le texte n'en a pas déjà une et si la couverture est
// complète.
function fountainExport(): { text: string; titled: boolean } {
  const text = upperCaseSceneHeadings(view.state.doc.toString());
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
    // La liste en tête de pièce est mise à jour avant l'export.
    if (currentFormat === "theatre") rewriteCast();
    if (currentFormat === "theatre" && playExportKind(format) === "layout") {
      const choice = chosenPlayExport();
      if (currentPath) {
        playExports = withPlayExport(playExports, currentPath, choice);
        savePlayExports(playExports);
      }
      const markdown = playToPandoc(view.state.doc.toString(), choice.layout);
      await invoke("export_play", { path, format, markdown, model: playModel(choice.layout, choice.page) });
      setStatus(`Exporté en ${((performance.now() - start) / 1000).toFixed(1)} s : ${path}`);
      return;
    }
    if (format === "pdf" && currentFormat === "scenario") {
      setStatus(await exportScreenplayPdf(path));
      return;
    }
    const fountain = format === "fountain" ? fountainExport() : undefined;
    // Un texte vanilla s'exporte avec son interligne et ses marges. Une pièce
    // en texte brut est écrite telle quelle, comme en Markdown.
    const layout = currentFormat === "vanilla" ? currentSetup : null;
    const route = currentFormat === "theatre" ? "md" : format;
    await invoke("export_document", { path, format: route, markdown: fountain?.text ?? view.state.doc.toString(), layout });
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

const formatTitle = document.querySelector<HTMLHeadingElement>("#format-title")!;
const formatMessage = document.querySelector<HTMLParagraphElement>("#format-message")!;

// La boîte de choix du format sert à créer un texte, à dire le format d'un
// fichier que l'app ne connaît pas ou d'un document importé, et à changer le
// format du texte affiché. La carte du format proposé reçoit le focus :
// Entrée suffit.
let formatAction: ((format: Format) => void) | undefined;

function askFormat(title: string, message: string, proposed: Format | undefined, action: (format: Format) => void) {
  if (document.querySelector("dialog[open]")) return;
  formatTitle.textContent = title;
  formatMessage.textContent = message;
  formatAction = action;
  for (const button of formatChoices.querySelectorAll<HTMLButtonElement>("button[data-format]")) {
    if (button.dataset.format === proposed) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
  formatDialog.showModal();
  formatChoices.querySelector<HTMLButtonElement>(`button[data-format="${proposed}"]`)?.focus();
}

function chooseNewDocument() {
  askFormat("Nouveau texte", "Choisis le format de ton texte.", undefined, requestNewDocument);
}

// Fichier > Format du texte… : le format du texte affiché change, le texte
// lui-même reste tel quel. L'historique d'annulation repart de zéro.
function chooseFormat() {
  if (currentPath !== undefined && fileKind(currentPath) === "fountain") {
    setStatus("Un fichier .fountain est toujours un scénario : son format ne se change pas.");
    return;
  }
  askFormat("Format du texte", "Choisis le format de ce texte. Le texte lui-même ne change pas.", currentFormat, (format) => {
    if (format === currentFormat) return;
    const text = view.state.doc.toString();
    const modified = dirty;
    setFormat(format);
    show("text");
    view.setState(createState(text));
    setDirty(modified);
    scheduleCounts(view);
    refreshPeopleMenu();
    if (peopleEnabled()) openingProposals();
    if (currentPath) rememberRecent(currentPath);
    setStatus(`Ce texte est maintenant au format ${FORMAT_NAMES[format]}.`);
    view.focus();
  });
}

// Une carte de l'accueil crée un texte ; une carte de la boîte de dialogue
// répond à la question posée.
homeFormats.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-format]");
  if (button) requestNewDocument(button.dataset.format as Format);
});

formatChoices.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-format]");
  if (!button) return;
  const action = formatAction;
  formatAction = undefined;
  formatDialog.close();
  action?.(button.dataset.format as Format);
});



document.querySelector<HTMLButtonElement>("#format-cancel")!.addEventListener("click", () => formatDialog.close());

// ---------------------------------------------------------------------------
// Modèle du scénario : choisi à la création, changé par Scénario > Modèle…
// ---------------------------------------------------------------------------

const modelDialog = document.querySelector<HTMLDialogElement>("#model-dialog")!;
const modelChoices = document.querySelector<HTMLDivElement>("#model-choices")!;
const modelTarget = document.querySelector<HTMLInputElement>("#model-target")!;
const modelConfirm = document.querySelector<HTMLButtonElement>("#model-confirm")!;

function modelOption(id: string, name: string, detail: string) {
  const label = document.createElement("label");
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "model";
  radio.value = id;
  // Le nom et sa présentation forment un seul bloc : une présentation qui
  // passe à la ligne reste alignée sous le nom.
  const text = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = name;
  text.append(strong);
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    text.append(" ", small);
  }
  label.append(radio, text);
  modelChoices.append(label);
}

modelOption("", "Sans modèle", "");
for (const template of TEMPLATES) modelOption(template.id, template.name, `${template.line} ${template.steps.length} étapes.`);

let modelAction: ((choice: Choice) => void) | undefined;

// Le choix proposé est coché et reçoit le focus : Entrée suffit.
function askModel(confirmLabel: string, current: Choice, action: (choice: Choice) => void) {
  if (document.querySelector("dialog[open]")) return;
  modelAction = action;
  modelConfirm.textContent = confirmLabel;
  for (const radio of modelChoices.querySelectorAll<HTMLInputElement>("input")) radio.checked = radio.value === current.model;
  modelTarget.value = String(current.target);
  modelDialog.returnValue = "cancel";
  modelDialog.showModal();
  modelChoices.querySelector<HTMLInputElement>("input:checked")?.focus();
}

document.querySelector<HTMLButtonElement>("#model-cancel")!.addEventListener("click", () => modelDialog.close("cancel"));

modelDialog.addEventListener("close", () => {
  const action = modelAction;
  modelAction = undefined;
  if (modelDialog.returnValue !== "confirm") return;
  const model = modelChoices.querySelector<HTMLInputElement>("input:checked")?.value ?? "";
  action?.(normalizeChoice({ model, target: modelTarget.value }));
});

// Scénario > Modèle… : le modèle du scénario affiché change, le texte reste tel quel.
function chooseModel() {
  askModel("Appliquer", currentChoice, (choice) => {
    currentChoice = choice;
    if (currentPath) rememberChoice(currentPath);
    refreshFormatLabel();
    refreshConsignes();
    setStatus(choiceMessage(choice, modelTarget.value));
    view.focus();
  });
}

// ---------------------------------------------------------------------------
// Mise en page d'un texte vanilla : Fichier > Mise en page…
// ---------------------------------------------------------------------------

const layoutDialog = document.querySelector<HTMLDialogElement>("#layout-dialog")!;
const layoutForm = layoutDialog.querySelector("form")!;
const LAYOUT_FIELDS = ["spacing", "top", "bottom", "left", "right"] as const;

function layoutInput(field: (typeof LAYOUT_FIELDS)[number]) {
  return layoutForm.elements.namedItem(field) as HTMLInputElement;
}

// Les champs montrent la mise en page du texte ; l'interligne reçoit le focus.
function chooseLayout() {
  if (document.querySelector("dialog[open]")) return;
  for (const field of LAYOUT_FIELDS) layoutInput(field).value = formatDecimal(currentSetup[field]);
  layoutDialog.returnValue = "cancel";
  layoutDialog.showModal();
  layoutInput("spacing").select();
}

document.querySelector<HTMLButtonElement>("#layout-cancel")!.addEventListener("click", () => layoutDialog.close("cancel"));

layoutDialog.addEventListener("close", () => {
  if (layoutDialog.returnValue !== "confirm") return;
  const typed = Object.fromEntries(LAYOUT_FIELDS.map((field) => [field, layoutInput(field).value])) as Record<(typeof LAYOUT_FIELDS)[number], string>;
  currentSetup = normalizeSetup(typed);
  if (currentPath) rememberSetup(currentPath);
  view.dispatch({ effects: sheetConf.reconfigure(sheetExtension()) });
  setStatus(setupMessage(typed));
  view.focus();
});

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

const CORRECTION_SETTINGS = ["checkWhileTyping", "grammar", "spelling", "typography"] as const;
const rulesList = document.querySelector<HTMLUListElement>("#setting-rules")!;

// Une liste de la correction : chaque entrée a son bouton. Après un retrait,
// le focus passe au bouton suivant, ou à « Fermer » s'il n'en reste aucun.
function renderEntries(list: HTMLUListElement, entries: { label: string; action: () => void }[], buttonLabel: string, empty: string) {
  if (!entries.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = empty;
    list.replaceChildren(item);
    return;
  }
  list.replaceChildren(
    ...entries.map(({ label, action }) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = label;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = buttonLabel;
      button.addEventListener("click", () => {
        action();
        (list.querySelector<HTMLButtonElement>("button") ?? list.closest("form")?.querySelector<HTMLButtonElement>("button.primary"))?.focus();
      });
      item.append(text, button);
      return item;
    }),
  );
}

function renderIgnoredRules() {
  renderEntries(
    rulesList,
    personal.rules.map((rule) => ({
      label: rule.label,
      action: () => {
        personal = { ...personal, rules: withoutRule(personal.rules, rule.rule) };
        savePersonal(personal);
        renderIgnoredRules();
        corrector.refresh();
      },
    })),
    "Rétablir",
    "Aucune règle ignorée.",
  );
}

async function openSettings() {
  if (document.querySelector("dialog[open]")) return;
  for (const radio of settingsForm.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
    radio.checked = radio.value === settings[radio.name as "theme" | "startup" | "reference"];
  }
  for (const name of CORRECTION_SETTINGS) {
    settingsForm.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.checked = settings[name];
  }
  settingsForm.querySelector<HTMLInputElement>('input[name="apostrophe"]')!.checked = settings.apostrophe;
  settingsForm.querySelector<HTMLInputElement>('input[name="spaces"]')!.checked = settings.spaces;
  settingsForm.querySelector<HTMLInputElement>('input[name="nameCompletion"]')!.checked = settings.nameCompletion;
  renderIgnoredRules();
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
  const previous = settings;
  settings = normalizeSettings({
    theme: data.get("theme"),
    font: data.get("font"),
    size,
    startup: data.get("startup"),
    nbsp: settings.nbsp,
    consignes: settings.consignes,
    apostrophe: data.get("apostrophe") === "on",
    spaces: data.get("spaces") === "on",
    nameCompletion: data.get("nameCompletion") === "on",
    checkWhileTyping: data.get("checkWhileTyping") === "on",
    grammar: data.get("grammar") === "on",
    spelling: data.get("spelling") === "on",
    typography: data.get("typography") === "on",
    reference: data.get("reference"),
  });
  sizeInput.value = String(settings.size);
  applySettings(settings);
  saveSettings(settings);
  // La police ou la taille ont pu changer : l'éditeur remesure ses lignes.
  view.requestMeasure();
  // Un autre dictionnaire oublie les réponses gardées ; une sorte cochée ou
  // décochée change seulement ce qui est montré.
  if (settings.reference !== previous.reference) corrector.setReference(settings.reference);
  else corrector.refresh();
  syncTypingMenu();
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
// Consignes du modèle : affichées ou masquées depuis le menu Affichage
// ---------------------------------------------------------------------------

// La case du menu suit le réglage, y compris au lancement.
function syncConsignesMenu() {
  invoke("set_menu_item_checked", { id: "view-consignes", checked: settings.consignes }).catch((error) => {
    setStatus(`le menu Affichage n'a pas pu être mis à jour (${error})`, true);
  });
}

function toggleConsignes() {
  settings = { ...settings, consignes: !settings.consignes };
  saveSettings(settings);
  refreshConsignes();
  syncConsignesMenu();
  setStatus(settings.consignes ? "Les consignes du modèle sont affichées." : "Les consignes du modèle sont masquées.");
}

syncConsignesMenu();

// ---------------------------------------------------------------------------
// Correction : case du menu, Dictionnaires…, remarque suivante ou précédente
// ---------------------------------------------------------------------------

// La case du menu suit le réglage, y compris au lancement.
function syncTypingMenu() {
  invoke("set_menu_item_checked", { id: "correction-typing", checked: settings.checkWhileTyping }).catch((error) => {
    setStatus(`le menu Correction n'a pas pu être mis à jour (${error})`, true);
  });
}

function toggleCheckWhileTyping() {
  settings = { ...settings, checkWhileTyping: !settings.checkWhileTyping };
  saveSettings(settings);
  syncTypingMenu();
  setCorrectionStatus(settings.checkWhileTyping ? "Le paragraphe en cours est vérifié pendant la frappe." : "Le texte n'est plus vérifié pendant la frappe.");
}

syncTypingMenu();

const dictionariesDialog = document.querySelector<HTMLDialogElement>("#dictionaries-dialog")!;
const textWords = document.querySelector<HTMLUListElement>("#dictionary-text")!;
const personalWords = document.querySelector<HTMLUListElement>("#dictionary-personal")!;

function renderDictionaries() {
  renderEntries(
    textWords,
    currentTextData.words.map((word) => ({
      label: word,
      action: () => {
        currentTextData = { ...currentTextData, words: withoutItem(currentTextData.words, word) };
        rememberTextData();
        renderDictionaries();
        corrector.refresh();
      },
    })),
    "Retirer",
    "Aucun mot ajouté à ce texte.",
  );
  renderEntries(
    personalWords,
    personal.words.map((word) => ({
      label: word,
      action: () => {
        personal = { ...personal, words: withoutItem(personal.words, word) };
        savePersonal(personal);
        renderDictionaries();
        corrector.refresh();
      },
    })),
    "Retirer",
    "Aucun mot ajouté à ton dictionnaire.",
  );
}

function openDictionaries() {
  if (document.querySelector("dialog[open]")) return;
  renderDictionaries();
  dictionariesDialog.showModal();
}

// Correction > Utiliser l'apostrophe typographique : toutes les apostrophes
// droites du texte, remplacées en une seule modification que Ctrl+Z annule.
function useTypographicApostrophes() {
  const changes = apostropheChanges(view.state.doc.toString());
  if (changes.length) view.dispatch({ changes, userEvent: "input.replace.all" });
  setStatus(apostrophesMessage(changes.length));
}

// Correction > Mettre en forme les nombres ordinaux : « 1er », « XIXe »
// deviennent « 1ᵉʳ », « XIXᵉ », en une seule modification que Ctrl+Z annule.
function formatOrdinals() {
  const changes = ordinalChanges(view.state.doc.toString());
  if (changes.length) view.dispatch({ changes, userEvent: "input.replace.all" });
  setStatus(ordinalsMessage(changes.length));
}

// Théâtre > Renuméroter les actes et les scènes : en une seule modification,
// que Ctrl+Z annule.
function renumberActsAndScenes() {
  const changes = renumberChanges(view.state.doc.toString());
  if (changes.length) view.dispatch({ changes, userEvent: "input.replace.all" });
  setStatus(renumberMessage(changes.length));
}

function goToNextRemark(direction: 1 | -1) {
  if (!goToRemark(view, direction)) setCorrectionStatus("Aucune remarque affichée : lance d'abord la vérification (F7).");
}

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
  "file-format": chooseFormat,
  "file-layout": chooseLayout,
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
  "view-consignes": toggleConsignes,
  "correction-check": () => corrector.check(),
  "correction-next": () => goToNextRemark(1),
  "correction-previous": () => goToNextRemark(-1),
  "correction-clear": () => corrector.clear(),
  "correction-apostrophes": useTypographicApostrophes,
  "correction-ordinals": formatOrdinals,
  "correction-typing": toggleCheckWhileTyping,
  "correction-dictionaries": openDictionaries,
  "scenario-cover": openCover,
  "scenario-model": chooseModel,
  "theatre-renumber": renumberActsAndScenes,
  "help-about": openAbout,
  ...PEOPLE_ACTIONS,
};

// Actions du menu Fichier sans objet tant qu'il n'y a aucun texte ; leurs
// boutons sont alors désactivés.
const NEEDS_TEXT = new Set(["file-save", "file-save-as", "file-export", "file-format", "file-layout"]);

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
  if (document.querySelector("dialog[open]")) {
    // Le menu a déjà basculé sa case : elle reprend l'état de l'app.
    if (id === "edit-nbsp") syncNbspMenu();
    if (id === "view-consignes") syncConsignesMenu();
    if (id === "correction-typing") syncTypingMenu();
    return;
  }
  // Les commandes d'édition agissent sur le texte : elles n'ont de sens que
  // si la vue Texte est affichée.
  if (id.startsWith("edit-") && id !== "edit-settings" && id !== "edit-nbsp" && viewText.hidden) {
    setStatus("Cette commande agit sur le texte : affiche d'abord la vue Texte.");
    return;
  }
  // La correction agit sur le texte : elle n'a de sens que sur la vue Texte.
  if (id.startsWith("correction-") && viewText.hidden) {
    setStatus("La correction agit sur le texte : affiche d'abord la vue Texte.");
    if (id === "correction-typing") syncTypingMenu();
    return;
  }
  if (id === "scenario-cover" && currentFormat !== "scenario") {
    setStatus("La page de couverture est propre au format scénario.");
    return;
  }
  if (id === "scenario-model" && currentFormat !== "scenario") {
    setStatus("Les modèles sont propres au format scénario.");
    return;
  }
  if (id === "theatre-renumber" && currentFormat !== "theatre") {
    setStatus("La renumérotation est propre au format théâtre.");
    return;
  }
  if (id === "theatre-renumber" && viewText.hidden) {
    setStatus("La renumérotation agit sur le texte : affiche d'abord la vue Texte.");
    return;
  }
  if (id === "file-layout" && currentFormat !== "vanilla") {
    setStatus("La mise en page se règle au format page blanche.");
    return;
  }
  if (id === "view-board" && currentFormat === "vanilla") {
    setStatus("Le format page blanche n'a pas de cork board : le texte est d'un seul tenant.");
    return;
  }
  if (id.startsWith("people-")) {
    if (nothingToSave()) {
      setStatus("Il n'y a pas encore de texte : crée ou ouvre d'abord un texte.");
      return;
    }
    if (currentFormat === "vanilla") {
      setStatus("Les fiches personnage n'existent pas au format page blanche.");
      return;
    }
    if (fichesBlocked) {
      setStatus("Le fichier des fiches de ce texte est illisible : les fiches sont désactivées. Enregistre le texte sous un autre nom pour en créer.");
      return;
    }
    if (id === "people-replies" && currentFormat !== "theatre" && currentFormat !== "scenario") {
      setStatus("Les répliques sont propres au scénario et au théâtre.");
      return;
    }
    if (viewText.hidden) show("text");
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

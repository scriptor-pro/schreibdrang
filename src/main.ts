import { minimalSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, MatchDecorator, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { redo, selectAll, undo } from "@codemirror/commands";
import Sortable from "sortablejs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { fillIcons } from "./icons";
import { MAX_SIZE, MIN_SIZE, applySettings, loadSettings, normalizeSettings, saveSettings } from "./settings";
import type { Settings } from "./settings";
import { addRecent, loadRecents, removeRecent, saveRecents } from "./recents";
import type { Recent } from "./recents";

// Les réglages s'appliquent avant la création de l'éditeur.
let settings: Settings = loadSettings();
applySettings(settings);

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
    countsEl.textContent = `${fmt.format(text.length)} caractères, ${fmt.format(words)} mots`;
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
  regexp: /\u00a0/g,
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

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      minimalSetup,
      markdown(),
      syntaxHighlighting(textHighlight),
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
      showNbsp,
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

interface Scene {
  heading: string;
  body: string;
}

interface Chapter {
  heading: string;
  scenes: Scene[];
}

function parseDocument(text: string): Chapter[] {
  const chapters: Chapter[] = [];
  let scene: Scene | undefined;
  const lines: string[] = [];

  const closeScene = () => {
    if (scene) scene.body = lines.join("\n").trim();
    lines.length = 0;
  };

  for (const line of text.split("\n")) {
    if (line.startsWith("# ")) {
      closeScene();
      scene = undefined;
      chapters.push({ heading: line, scenes: [] });
    } else if (line.startsWith("## ") && chapters.length) {
      closeScene();
      scene = { heading: line, body: "" };
      chapters[chapters.length - 1].scenes.push(scene);
    } else {
      lines.push(line);
    }
  }
  closeScene();
  return chapters;
}

function serializeDocument(chapters: Chapter[]): string {
  const parts: string[] = [];
  for (const chapter of chapters) {
    parts.push(chapter.heading);
    for (const scene of chapter.scenes) {
      parts.push(scene.heading);
      if (scene.body) parts.push(scene.body);
    }
  }
  return parts.join("\n\n") + "\n";
}

const board = document.querySelector<HTMLDivElement>("#board")!;
const chapterOf = new WeakMap<Element, Chapter>();
const sceneOf = new WeakMap<Element, Scene>();
let sortables: Sortable[] = [];

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
    changes: { from: 0, to: view.state.doc.length, insert: serializeDocument(chapters) },
  });
  const scene = moved && sceneOf.get(moved);
  if (scene) movedHeading = scene.heading;
}

function buildBoard() {
  for (const sortable of sortables) sortable.destroy();
  sortables = [];
  board.replaceChildren();

  for (const chapter of parseDocument(view.state.doc.toString())) {
    const column = document.createElement("div");
    column.className = "chapter";
    chapterOf.set(column, chapter);
    const heading = document.createElement("h2");
    heading.textContent = chapter.heading.replace(/^#\s*/, "");
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
      h3.textContent = scene.heading.replace(/^##\s*/, "");
      const p = document.createElement("p");
      p.textContent = summary(scene.body);
      card.append(h3, p);
      cards.append(card);
    }
    column.append(heading, cards);
    board.append(column);

    // forceFallback : le glisser-déposer passe par les événements de pointeur,
    // car Tauri intercepte le glisser-déposer HTML5 natif.
    sortables.push(
      Sortable.create(cards, {
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
    Sortable.create(board, {
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

function show(which: "home" | "text" | "board") {
  release(true);
  if (which === "board") buildBoard();
  if (which === "home") renderRecents();
  viewHome.hidden = which !== "home";
  viewText.hidden = which !== "text";
  viewBoard.hidden = which !== "board";
  document.body.dataset.regime = which === "text" ? "ecriture" : "affiche";
  btnText.classList.toggle("active", which === "text");
  btnBoard.classList.toggle("active", which === "board");
  if (which !== "text") view.contentDOM.blur();
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

window.addEventListener("keydown", (event) => {
  if (event.key === "F11") {
    event.preventDefault();
    runAction("view-fullscreen");
  } else if (event.key === "Escape" && document.body.classList.contains("fullscreen")) {
    setFullscreen(false);
  } else if (event.ctrlKey && !event.altKey) {
    const key = event.key.toLowerCase();
    const id =
      key === "n" && !event.shiftKey ? "file-new"
      : key === "o" && !event.shiftKey ? "file-open"
      : key === "s" ? (event.shiftKey ? "file-save-as" : "file-save")
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

function setStatus(message: string, error = false) {
  fileStatus.textContent = error ? `Erreur : ${message}` : message;
  fileStatus.title = fileStatus.textContent;
  fileStatus.classList.toggle("error", error);
}

let recents: Recent[] = loadRecents();

function rememberRecent(path: string) {
  recents = addRecent(recents, path, new Date());
  saveRecents(recents);
}

function forgetRecent(path: string) {
  recents = removeRecent(recents, path);
  saveRecents(recents);
}

// Remplace le texte affiché. Un nouvel état, plutôt qu'un remplacement du
// texte : l'historique d'annulation repart de zéro et Ctrl + Z ne ramène pas
// l'ancien texte.
function loadDocument(text: string, path: string | undefined) {
  movedHeading = undefined;
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

function requestNewDocument() {
  confirmDiscard("Nouveau texte", "Effacer et créer", () => {
    loadDocument("", undefined);
    setStatus("");
  });
}

// Ouvre le fichier indiqué. Renvoie faux si la lecture a échoué ; le fichier
// sort alors de la liste des textes récents.
async function openPath(path: string): Promise<boolean> {
  try {
    const text = await invoke<string>("read_text_file", { path });
    loadDocument(text, path);
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
  const path = await open({ title: "Ouvrir un texte", multiple: false, filters: TEXT_FILTERS });
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
    defaultPath: currentPath ?? "sans-titre.md",
    filters: TEXT_FILTERS,
  });
  if (path) await writeDocument(path);
}

async function saveDocument() {
  if (document.querySelector("dialog[open]")) return;
  if (currentPath) await writeDocument(currentPath);
  else await saveDocumentAs();
}

btnNew.addEventListener("click", requestNewDocument);
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
  md: "Markdown",
  txt: "Texte brut",
};

const btnExport = document.querySelector<HTMLButtonElement>("#btn-export")!;
const exportDialog = document.querySelector<HTMLDialogElement>("#export-dialog")!;

btnExport.addEventListener("click", () => {
  exportDialog.returnValue = "cancel";
  exportDialog.showModal();
});

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
    defaultPath: `roman.${format}`,
    filters: [{ name: FORMATS[format], extensions: [format] }],
  });
  if (!path) return;

  btnExport.disabled = true;
  setStatus(`Export ${FORMATS[format]} en cours…`);
  const start = performance.now();
  try {
    await invoke("export_document", { path, format, markdown: view.state.doc.toString() });
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    setStatus(`Exporté en ${seconds} s : ${path}`);
  } catch (error) {
    setStatus(`l'export a échoué (${error})`, true);
  } finally {
    btnExport.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Écran d'accueil
// ---------------------------------------------------------------------------

const recentsList = document.querySelector<HTMLUListElement>("#recents")!;
const recentsEmpty = document.querySelector<HTMLParagraphElement>("#recents-empty")!;
const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

function renderRecents() {
  recentsList.replaceChildren(
    ...recents.map((recent) => {
      const parts = recent.path.split(/[\\/]/);
      const name = document.createElement("strong");
      name.textContent = parts.pop() ?? recent.path;
      const folder = document.createElement("small");
      folder.textContent = parts.join("/") || "/";
      const time = document.createElement("time");
      time.dateTime = recent.date;
      time.textContent = dateFormat.format(new Date(recent.date));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "recent";
      button.append(name, " ", time, " ", folder);
      button.addEventListener("click", () => {
        confirmDiscard("Ouvrir un texte", "Abandonner et ouvrir", async () => {
          // Un fichier disparu sort de la liste : l'accueil est redessiné.
          if (!(await openPath(recent.path))) renderRecents();
        });
      });
      const item = document.createElement("li");
      item.append(button);
      return item;
    }),
  );
  recentsEmpty.hidden = recents.length > 0;
}

function loadTestText() {
  confirmDiscard("Charger le texte de test", "Abandonner et charger", () => {
    loadDocument(buildText(100_000), undefined);
    setStatus("Texte de test chargé : environ 100 000 mots.");
  });
}

document.querySelector<HTMLButtonElement>("#format-roman")!.addEventListener("click", requestNewDocument);
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
  });
  sizeInput.value = String(settings.size);
  applySettings(settings);
  saveSettings(settings);
  // La police ou la taille ont pu changer : l'éditeur remesure ses lignes.
  view.requestMeasure();
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
  "file-new": requestNewDocument,
  "file-open": requestOpenDocument,
  "file-save": saveDocument,
  "file-save-as": saveDocumentAs,
  "file-export": () => btnExport.click(),
  "file-test": loadTestText,
  "file-quit": requestQuit,
  "edit-undo": () => undo(view),
  "edit-redo": () => redo(view),
  "edit-cut": () => editClipboard("cut"),
  "edit-copy": () => editClipboard("copy"),
  "edit-paste": () => editClipboard("paste"),
  "edit-select-all": () => selectAll(view),
  "edit-settings": openSettings,
  "view-home": () => show("home"),
  "view-text": () => show("text"),
  "view-board": () => show("board"),
  "view-fullscreen": toggleFullscreen,
  "help-about": openAbout,
};

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
  if (id.startsWith("edit-") && id !== "edit-settings" && viewText.hidden) {
    setStatus("Cette commande agit sur le texte : affiche d'abord la vue Texte.");
    return;
  }
  ACTIONS[id]?.();
}

listen<string>("menu", (event) => runAction(event.payload));

fillIcons(document);

// Au lancement : l'accueil, ou le dernier texte si le réglage le demande. Si
// ce texte ne peut pas être rouvert, l'accueil s'affiche avec l'erreur.
async function start() {
  const last = settings.startup === "dernier" ? recents[0] : undefined;
  if (!last || !(await openPath(last.path))) show("home");
}

start();

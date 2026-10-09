// Format scénario : le texte est écrit en Fountain (syntaxe de fountain.io).
// Ce module reconnaît la nature de chaque ligne, pour la mise en valeur dans
// l'éditeur, et découpe le scénario en scènes, pour le cork board.

import type { Chapter, Outline, Scene } from "./outline.ts";

export type LineKind =
  | "blank"
  | "title" // page de titre, en tête du fichier
  | "scene" // intitulé de scène
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition"
  | "centered"
  | "section"
  | "synopsis"
  | "pagebreak"
  | "action";

// « EST. », que Fountain admet aussi, n'ouvre pas un intitulé : « est » est
// un mot courant en français.
const SCENE = /^(INT\.?\/EXT|INT|EXT|I\/E)[. ]/i;
const FORCED_SCENE = /^\.[^.\s]/;
// Clés usuelles d'une page de titre. Une phrase qui se termine par « : »
// (« Elle lit : ») n'en ouvre pas une.
const TITLE_KEY = /^(title|credit|authors?|source|draft date|date|contact|notes|copyright|revision):/i;

function isUpperCase(text: string): boolean {
  return text === text.toUpperCase() && /\p{Lu}/u.test(text);
}

// Un nom de personnage est en capitales ; une mention entre parenthèses peut
// le suivre (« ÉLISE (V.O.) »), ainsi que « ^ » pour un dialogue simultané.
function isCharacter(line: string): boolean {
  if (line.startsWith("@")) return true;
  return isUpperCase(line.replace(/\^$/, "").replace(/\([^)]*\)\s*$/, ""));
}

// Vrai si la ligne peut être un nom de personnage : en capitales, et ni un
// intitulé de scène, ni une transition, ni une ligne forcée.
export function couldBeCharacter(line: string): boolean {
  const text = line.trim();
  if (text === "" || /^[>#=.!]/.test(text) || /:$/.test(text)) return false;
  return isCharacter(text) && !isSceneHeading(text);
}

export function isSceneHeading(line: string): boolean {
  return SCENE.test(line) || FORCED_SCENE.test(line);
}

// Le texte d'un intitulé de scène, sans le point qui le force. Un intitulé
// est toujours montré en majuscules, quoi qu'on ait tapé.
export function sceneTitle(heading: string): string {
  return (FORCED_SCENE.test(heading) ? heading.slice(1) : heading).toUpperCase();
}

// Le scénario, ses intitulés de scène mis en majuscules : le texte exporté.
// Le fichier enregistré garde, lui, ce qui a été tapé.
export function upperCaseSceneHeadings(text: string): string {
  const lines = text.split("\n");
  const kinds = classifyLines(lines);
  return lines.map((line, index) => (kinds[index] === "scene" ? line.toUpperCase() : line)).join("\n");
}

export function hasTitlePage(text: string): boolean {
  return TITLE_KEY.test(text);
}

export function classifyLines(lines: string[]): LineKind[] {
  const kinds: LineKind[] = [];
  const blank = (index: number) => index < 0 || index >= lines.length || lines[index].trim() === "";
  let inTitle = lines.length > 0 && TITLE_KEY.test(lines[0]);
  let inDialogue = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "") {
      kinds.push("blank");
      inTitle = false;
      inDialogue = false;
    } else if (inTitle) {
      kinds.push("title");
    } else if (inDialogue) {
      kinds.push(line.startsWith("(") ? "parenthetical" : "dialogue");
    } else if (/^={3,}$/.test(line)) {
      kinds.push("pagebreak");
    } else if (line.startsWith("#")) {
      kinds.push("section");
    } else if (line.startsWith("=")) {
      kinds.push("synopsis");
    } else if (line.startsWith(">") && line.endsWith("<")) {
      kinds.push("centered");
    } else if (line.startsWith(">")) {
      kinds.push("transition");
    } else if (line.startsWith("!")) {
      kinds.push("action");
    } else if (isSceneHeading(line) && blank(index - 1)) {
      // Fountain demande aussi une ligne vide après l'intitulé ; ici, l'action
      // tapée juste dessous ne lui retire pas sa nature.
      kinds.push("scene");
    } else if (isUpperCase(line) && /:$/.test(line) && blank(index - 1) && blank(index + 1)) {
      // « CUT TO: », « COUPE À : », « FONDU ENCHAÎNÉ : ».
      kinds.push("transition");
    } else if (isCharacter(line) && blank(index - 1) && !blank(index + 1)) {
      kinds.push("character");
      inDialogue = true;
    } else {
      kinds.push("action");
    }
  }
  return kinds;
}

// Découpe un scénario pour le cork board, dans la même forme qu'un roman :
// une colonne par section de premier niveau (« # »), une fiche par scène. Un
// scénario sans section n'a qu'une colonne, sans titre.
export function parseScreenplay(text: string): Outline {
  const outline: Outline = { preamble: "", chapters: [] };
  let chapter: Chapter | undefined;
  let scene: Scene | undefined;
  const block: string[] = [];

  const flush = () => {
    const content = block.join("\n").trim();
    block.length = 0;
    if (scene) scene.body = content;
    else if (chapter) chapter.intro = content;
    else outline.preamble = content;
  };

  const lines = text.split("\n");
  const kinds = classifyLines(lines);
  lines.forEach((line, index) => {
    if (kinds[index] === "section" && /^#(?!#)/.test(line.trim())) {
      flush();
      scene = undefined;
      chapter = { heading: line.trim(), intro: "", scenes: [] };
      outline.chapters.push(chapter);
    } else if (kinds[index] === "scene") {
      flush();
      if (!chapter) {
        chapter = { heading: "", intro: "", scenes: [] };
        outline.chapters.push(chapter);
      }
      scene = { heading: line.trim(), body: "" };
      chapter.scenes.push(scene);
    } else {
      block.push(line);
    }
  });
  flush();
  return outline;
}

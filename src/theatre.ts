// Format théâtre : une pièce découpée en actes (« # ») et en scènes (« ## »),
// avec une liste des personnages facultative en tête. Ce module reconnaît la
// nature de chaque ligne, numérote les actes et les scènes, découpe la pièce
// pour le cork board et dit où se trouve une ligne. Il n'accède pas à la page.

import { couldBeCharacter } from "./fountain.ts";
import { serializeDocument } from "./outline.ts";
import type { Chapter, Outline, Scene } from "./outline.ts";

export type PlayLine =
  | "blank"
  | "cast-title" // « PERSONNAGES », qui ouvre la liste des personnages
  | "cast" // une entrée de la liste des personnages
  | "act"
  | "scene"
  | "character" // le nom au-dessus d'une réplique
  | "dialogue"
  | "stage" // une didascalie, seule ou dans une réplique
  | "text"; // ce que rien ne reconnaît

// Une pièce neuve : un acte, avec une scène.
export const NEW_PLAY = "# ACTE I\n\n## Scène 1\n\n";

export const ACT = /^#[ \t]/;
export const SCENE = /^##[ \t]/;
const STAGE = /^\(.*\)$/;

export function classifyPlay(lines: string[]): PlayLine[] {
  const kinds: PlayLine[] = [];
  const blank = (index: number) => index < 0 || index >= lines.length || lines[index].trim() === "";
  // Vrai dès le premier titre d'acte ou de scène : la liste des personnages
  // ne peut plus commencer.
  let headingSeen = false;
  let inCast = false;
  let inReply = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    if (line === "") {
      kinds.push("blank");
      inReply = false;
    } else if (SCENE.test(raw) || ACT.test(raw)) {
      kinds.push(SCENE.test(raw) ? "scene" : "act");
      headingSeen = true;
      inCast = false;
      inReply = false;
    } else if (inCast) {
      kinds.push("cast");
    } else if (!headingSeen && line === "PERSONNAGES" && blank(index - 1)) {
      kinds.push("cast-title");
      inCast = true;
    } else if (inReply) {
      kinds.push(STAGE.test(line) ? "stage" : "dialogue");
    } else if (couldBeCharacter(line) && blank(index - 1) && !blank(index + 1)) {
      kinds.push("character");
      inReply = true;
    } else {
      kinds.push(STAGE.test(line) ? "stage" : "text");
    }
  }
  return kinds;
}

// Un titre d'acte ou de scène numéroté : le mot, tel qu'il est écrit, puis le
// numéro, en chiffres arabes ou romains, ou « premier », « première » selon
// la numérotation classique. Le reste du titre est gardé.
const NUMERAL = "([IVXLCDM]+|\\d+|PREMIER|PREMIÈRE|Premier|Première|premier|première)";
const NUMBERED_ACT = new RegExp(`^(#[ \\t]+)(ACTE|Acte|acte)([ \\t]+)${NUMERAL}(?![\\p{L}\\p{N}])`, "u");
const NUMBERED_SCENE = new RegExp(`^(##[ \\t]+)(SCÈNE|Scène|scène|SCENE|Scene|scene)([ \\t]+)${NUMERAL}(?![\\p{L}\\p{N}])`, "u");
const FIRST = /^premi(er|ère)$/iu;

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function toRoman(value: number): string {
  let rest = value;
  let roman = "";
  for (const [amount, letters] of ROMAN) {
    while (rest >= amount) {
      roman += letters;
      rest -= amount;
    }
  }
  return roman;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

// Les numéros à changer pour que les actes se suivent en chiffres romains et
// que les scènes soient numérotées dans chaque acte. Un titre sans numéro
// n'est pas modifié et ne compte pas ; un acte sans numéro recommence
// pourtant la numérotation des scènes.
export function renumberChanges(text: string): TextChange[] {
  const lines = text.split("\n");
  const numerals = (pattern: RegExp) => lines.map((line) => pattern.exec(line)?.[4]).filter((numeral) => numeral !== undefined);
  // Les scènes en chiffres romains si la première scène numérotée en
  // chiffres l'est ; « premier », « première » reste au rang 1 s'il est employé.
  const firstFigure = numerals(NUMBERED_SCENE).find((numeral) => !FIRST.test(numeral));
  const romanScenes = firstFigure !== undefined && !/^\d+$/.test(firstFigure);
  const firstAct = numerals(NUMBERED_ACT).find((numeral) => FIRST.test(numeral));
  const firstScene = numerals(NUMBERED_SCENE).find((numeral) => FIRST.test(numeral));
  const changes: TextChange[] = [];
  let offset = 0;
  let act = 0;
  let scene = 0;
  const renumber = (match: RegExpExecArray, value: string) => {
    if (match[4] === value) return;
    const from = offset + match[1].length + match[2].length + match[3].length;
    changes.push({ from, to: from + match[4].length, insert: value });
  };
  for (const line of lines) {
    const numberedAct = NUMBERED_ACT.exec(line);
    const numberedScene = NUMBERED_SCENE.exec(line);
    if (numberedAct) {
      act += 1;
      scene = 0;
      renumber(numberedAct, act === 1 && firstAct ? firstAct : toRoman(act));
    } else if (ACT.test(line)) {
      scene = 0;
    } else if (numberedScene) {
      scene += 1;
      renumber(numberedScene, scene === 1 && firstScene ? firstScene : romanScenes ? toRoman(scene) : String(scene));
    }
    offset += line.length + 1;
  }
  return changes;
}

export function renumberPlay(text: string): string {
  let result = text;
  for (const change of [...renumberChanges(text)].reverse()) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

export function renumberMessage(count: number): string {
  return count ? "Actes et scènes renumérotés." : "Les numéros des actes et des scènes étaient déjà justes.";
}

// Découpe une pièce pour le cork board, dans la même forme qu'un roman : une
// colonne par acte, une fiche par scène. La liste des personnages et ce qui
// précède le premier titre restent en tête du texte. Des scènes écrites avant
// le premier acte forment une colonne sans titre.
export function parsePlay(text: string): Outline {
  const outline: Outline = { preamble: "", chapters: [] };
  let chapter: Chapter | undefined;
  let scene: Scene | undefined;
  const lines: string[] = [];

  const flush = () => {
    const block = lines.join("\n").trim();
    lines.length = 0;
    if (scene) scene.body = block;
    else if (chapter) chapter.intro = block;
    else outline.preamble = block;
  };

  for (const line of text.split("\n")) {
    if (SCENE.test(line)) {
      flush();
      if (!chapter) {
        chapter = { heading: "", intro: "", scenes: [] };
        outline.chapters.push(chapter);
      }
      scene = { heading: line, body: "" };
      chapter.scenes.push(scene);
    } else if (ACT.test(line)) {
      flush();
      scene = undefined;
      chapter = { heading: line, intro: "", scenes: [] };
      outline.chapters.push(chapter);
    } else {
      lines.push(line);
    }
  }
  flush();
  return outline;
}

// Renumérote le plan du cork board lui-même, après un déplacement : chaque
// acte et chaque scène reçoit le titre qu'il a dans la pièce renumérotée,
// dans l'ordre, pour que les fiches affichent les nouveaux numéros.
export function renumberOutline(outline: Outline): void {
  const fresh = parsePlay(renumberPlay(serializeDocument(outline))).chapters;
  const acts = fresh.filter((chapter) => chapter.heading);
  const scenes = fresh.flatMap((chapter) => chapter.scenes);
  for (const chapter of outline.chapters) if (chapter.heading) chapter.heading = acts.shift()?.heading ?? chapter.heading;
  for (const scene of outline.chapters.flatMap((chapter) => chapter.scenes)) scene.heading = scenes.shift()?.heading ?? scene.heading;
}

// La place dans le texte du titre de la scène de ce rang (0 pour la
// première), ou -1. Toutes les lignes « ## » sont des scènes.
export function sceneOffset(text: string, index: number): number {
  let offset = 0;
  let rank = 0;
  for (const line of text.split("\n")) {
    if (SCENE.test(line)) {
      if (rank === index) return offset;
      rank += 1;
    }
    offset += line.length + 1;
  }
  return -1;
}

// Où se trouve une ligne : la liste des personnages, l'acte et la scène en
// cours, avec leur ligne de titre et le rang de la scène dans l'acte.
interface Place {
  cast: number;
  act: number;
  scene: number;
  rank: number;
}

function placeOf(kinds: readonly PlayLine[], index: number): Place {
  const place: Place = { cast: -1, act: -1, scene: -1, rank: 0 };
  for (let line = 0; line <= index && line < kinds.length; line += 1) {
    const kind = kinds[line];
    if (kind === "cast-title") {
      place.cast = line;
    } else if (kind === "act") {
      place.act = line;
      place.scene = -1;
      place.rank = 0;
      place.cast = -1;
    } else if (kind === "scene") {
      place.scene = line;
      place.rank += 1;
      place.cast = -1;
    }
  }
  return place;
}

const strip = (heading: string) => heading.replace(/^#+[ \t]+/, "").trim();

// Pied de page : « Acte II, scène 3 », « Personnages », ou rien avant le
// premier acte. Le numéro est celui du titre ; sans numéro, le rang.
export function playPosition(lines: readonly string[], kinds: readonly PlayLine[], index: number): string {
  const place = placeOf(kinds, index);
  if (place.cast >= 0) return "Personnages";
  const numberedAct = place.act >= 0 ? NUMBERED_ACT.exec(lines[place.act]) : null;
  const act = place.act < 0 ? "" : numberedAct ? `Acte ${FIRST.test(numberedAct[4]) ? "I" : numberedAct[4]}` : strip(lines[place.act]);
  if (place.scene < 0) return act;
  const numberedScene = NUMBERED_SCENE.exec(lines[place.scene]);
  const scene = numberedScene ? (FIRST.test(numberedScene[4]) ? "1" : numberedScene[4]) : String(place.rank);
  return act ? `${act}, scène ${scene}` : `Scène ${scene}`;
}

export interface Banner {
  // Les titres de l'acte et de la scène, sans les « # » ; vide avant le premier acte.
  title: string;
  // La ligne du titre le plus proche (scène, acte ou liste), ou -1.
  heading: number;
}

// Bandeau de l'éditeur, pour la première ligne affichée.
export function bannerAt(lines: readonly string[], kinds: readonly PlayLine[], top: number): Banner {
  const place = placeOf(kinds, top);
  if (place.cast >= 0) return { title: "Personnages", heading: place.cast };
  const parts: string[] = [];
  if (place.act >= 0) parts.push(strip(lines[place.act]));
  if (place.scene >= 0) parts.push(strip(lines[place.scene]));
  if (!parts.length) return { title: "", heading: -1 };
  return { title: parts.join(" — "), heading: place.scene >= 0 ? place.scene : place.act };
}

// Noms des personnages, en capitales, entiers et mot par mot : ceux qui
// parlent, et ceux qui ouvrent une entrée de la liste (avant la virgule).
export function playCharacterNames(text: string): Set<string> {
  const lines = text.split("\n");
  const kinds = classifyPlay(lines);
  const names = new Set<string>();
  const add = (raw: string) => {
    const name = raw.trim().replace(/^@/, "").replace(/\([^)]*\)\s*$/, "").trim().toLocaleUpperCase("fr");
    if (!name) return;
    names.add(name);
    for (const part of name.split(/[\s\-‑'’]+/)) if (part) names.add(part);
  };
  lines.forEach((line, index) => {
    if (kinds[index] === "character") add(line);
    if (kinds[index] === "cast") {
      const head = line.split(",")[0].trim();
      if (head && head === head.toLocaleUpperCase("fr") && /\p{Lu}/u.test(head)) add(head);
    }
  });
  return names;
}

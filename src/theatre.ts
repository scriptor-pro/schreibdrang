// Format théâtre : une pièce découpée en actes (« # ») et en scènes (« ## »),
// avec une liste des personnages facultative en tête. Ce module reconnaît la
// nature de chaque ligne, numérote les actes et les scènes, découpe la pièce
// pour le cork board et dit où se trouve une ligne. Il n'accède pas à la page.

import { couldBeCharacter } from "./fountain.ts";

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
// numéro, en chiffres arabes ou romains. Le reste du titre est gardé.
const NUMBERED_ACT = /^(#[ \t]+)(ACTE|Acte|acte)([ \t]+)([IVXLCDM]+|\d+)(?![\p{L}\p{N}])/u;
const NUMBERED_SCENE = /^(##[ \t]+)(SCÈNE|Scène|scène|SCENE|Scene|scene)([ \t]+)([IVXLCDM]+|\d+)(?![\p{L}\p{N}])/u;

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
  const firstScene = lines.map((line) => NUMBERED_SCENE.exec(line)).find((match) => match !== null);
  const romanScenes = firstScene !== undefined && firstScene !== null && !/^\d+$/.test(firstScene[4]);
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
      renumber(numberedAct, toRoman(act));
    } else if (ACT.test(line)) {
      scene = 0;
    } else if (numberedScene) {
      scene += 1;
      renumber(numberedScene, romanScenes ? toRoman(scene) : String(scene));
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

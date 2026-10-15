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

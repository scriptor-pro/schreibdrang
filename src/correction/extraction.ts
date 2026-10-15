// Correction : ce que Grammalecte relit dans un texte, passage par passage,
// selon son format. Les marques d'italique et de gras sont retirées du texte
// relu, sans être remplacées : une espace à leur place ferait signaler à tort
// « qu' elle » comme un guillemet fermant. Chaque caractère relu garde sa
// place dans le document.

import { classifyLines } from "../fountain.ts";
import type { LineKind } from "../fountain.ts";
import type { Format } from "../recents.ts";
import { classifyPlay } from "../theatre.ts";
import type { PlayLine } from "../theatre.ts";

// Un passage, relu d'un seul tenant : un paragraphe, un titre, une réplique,
// une didascalie. `from` et `to` le situent dans le document. Le texte relu
// est fait de tronçons copiés du document : `starts[k]` est la place dans
// `text` du tronçon k, `places[k]` celle de son premier caractère dans le
// document (voir toDocument).
export interface Passage {
  from: number;
  to: number;
  text: string;
  starts: number[];
  places: number[];
}

// Une ligne à relire : son texte, sans ce qui la précède et ne s'imprime pas,
// la place de son premier caractère et celle de sa fin.
interface Line {
  text: string;
  from: number;
  end: number;
}

// Natures de ligne relues dans un scénario. Les intitulés de scène, les noms
// des personnages, les transitions, la page de titre ne le sont pas.
const SCREENPLAY_READ: ReadonlySet<LineKind> = new Set<LineKind>(["action", "dialogue", "parenthetical"]);

// Natures de ligne relues dans une pièce. Les titres d'actes et de scènes,
// les noms des personnages et le titre de la liste ne le sont pas.
const PLAY_READ: ReadonlySet<PlayLine> = new Set<PlayLine>(["cast", "dialogue", "stage", "text"]);

const WORD_CHAR = /[\p{L}\p{N}]/u;
const HEADING = /^#{1,6}(?:[ \t]+|$)/;
const MARK = /[*_]/g;

// Le texte d'un passage en construction, tronçon par tronçon.
interface Builder {
  parts: string[];
  length: number;
  starts: number[];
  places: number[];
}

function pushPiece(builder: Builder, piece: string, place: number) {
  if (!piece) return;
  builder.parts.push(piece);
  builder.starts.push(builder.length);
  builder.places.push(place);
  builder.length += piece.length;
}

// Ajoute une ligne au passage, sans ses marques : toute étoile, et tout « _ »
// qui n'est pas entre deux lettres ou chiffres (« mot_clé » le garde). Une
// ligne sans marque, le cas courant, est copiée d'un bloc.
function pushLine(builder: Builder, line: Line) {
  const text = line.text;
  if (!text.includes("*") && !text.includes("_")) {
    pushPiece(builder, text, line.from);
    return;
  }
  let pieceStart = 0;
  for (const match of text.matchAll(MARK)) {
    const i = match.index;
    if (match[0] === "_" && WORD_CHAR.test(text[i - 1] ?? "") && WORD_CHAR.test(text[i + 1] ?? "")) continue;
    pushPiece(builder, text.slice(pieceStart, i), line.from + pieceStart);
    pieceStart = i + 1;
  }
  pushPiece(builder, text.slice(pieceStart), line.from + pieceStart);
}

// Les lignes d'un même passage sont jointes par une espace, placée sur le
// retour à la ligne qui les sépare. Un passage sans lettre n'est pas gardé.
function makePassage(lines: Line[]): Passage | undefined {
  const builder: Builder = { parts: [], length: 0, starts: [], places: [] };
  lines.forEach((line, index) => {
    if (index > 0) pushPiece(builder, " ", lines[index - 1].end);
    pushLine(builder, line);
  });
  const text = builder.parts.join("");
  if (!text.trim()) return undefined;
  return { from: lines[0].from, to: lines[lines.length - 1].end, text, starts: builder.starts, places: builder.places };
}

export function extractPassages(doc: string, format: Format): Passage[] {
  const raw = doc.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of raw) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const lineAt = (index: number, skip = 0): Line => ({
    text: raw[index].slice(skip),
    from: starts[index] + skip,
    end: starts[index] + raw[index].length,
  });

  const passages: Passage[] = [];
  let group: Line[] = [];
  const flush = () => {
    if (!group.length) return;
    const passage = makePassage(group);
    if (passage) passages.push(passage);
    group = [];
  };

  if (format === "scenario") {
    // Les lignes voisines d'une même action ou d'une même réplique forment un
    // passage ; une didascalie est relue seule.
    const kinds = classifyLines(raw);
    let previous: LineKind | undefined;
    raw.forEach((line, index) => {
      const kind = kinds[index];
      if (kind !== previous || kind === "parenthetical") flush();
      previous = kind;
      if (!SCREENPLAY_READ.has(kind)) return;
      // « ! » force une action ; il ne s'imprime pas.
      const skip = kind === "action" && line.trimStart().startsWith("!") ? line.indexOf("!") + 1 : 0;
      group.push(lineAt(index, skip));
    });
  } else if (format === "theatre") {
    // Les lignes d'une même réplique, ou d'un même paragraphe de texte,
    // forment un passage ; une didascalie et une entrée de la liste sont
    // relues seules.
    const kinds = classifyPlay(raw);
    let previous: PlayLine | undefined;
    raw.forEach((_, index) => {
      const kind = kinds[index];
      if (kind !== previous || (kind !== "dialogue" && kind !== "text")) flush();
      previous = kind;
      if (PLAY_READ.has(kind)) group.push(lineAt(index));
    });
  } else {
    // Roman, nouvelle, vanilla : un titre est relu seul, sans ses « # » ; un
    // paragraphe va jusqu'à la ligne vide suivante.
    raw.forEach((line, index) => {
      if (line.trim() === "") {
        flush();
        return;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        flush();
        group.push(lineAt(index, heading[0].length));
        flush();
        return;
      }
      group.push(lineAt(index));
    });
  }
  flush();
  return passages;
}

// La place dans le document du caractère `text[index]` du passage.
function placeOf(passage: Passage, index: number): number {
  const { starts, places } = passage;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= index) low = middle;
    else high = middle - 1;
  }
  return places[low] + index - starts[low];
}

// La place dans le document de ce que le moteur a relevé entre `start` et
// `end` (exclu) dans le texte du passage.
export function toDocument(passage: Passage, start: number, end: number): { from: number; to: number } {
  const from = start < passage.text.length ? placeOf(passage, start) : passage.to;
  const to = end > start ? placeOf(passage, end - 1) + 1 : from;
  return { from, to };
}

// Noms des personnages qui parlent, en capitales, entiers et mot par mot :
// « JEAN-PIERRE (V.O.) » donne « JEAN-PIERRE », « JEAN » et « PIERRE ».
export function characterNames(doc: string): Set<string> {
  const lines = doc.split("\n");
  const kinds = classifyLines(lines);
  const names = new Set<string>();
  lines.forEach((line, index) => {
    if (kinds[index] !== "character") return;
    const name = line
      .trim()
      .replace(/^@/, "")
      .replace(/\^$/, "")
      .replace(/\([^)]*\)\s*$/, "")
      .trim()
      .toLocaleUpperCase("fr");
    if (!name) return;
    names.add(name);
    for (const part of name.split(/[\s\-‑'’]+/)) if (part) names.add(part);
  });
  return names;
}

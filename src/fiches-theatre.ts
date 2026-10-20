// La liste des personnages en tête d'une pièce (bloc « PERSONNAGES ») : la
// lire, la refaire à partir des fiches, et faire des fiches d'une liste écrite
// à la main. Module pur.

import { displayName } from "./fiches.ts";
import type { Sheet } from "./fiches.ts";
import { sheetFromLabel, speakerSheet } from "./fiches-detection.ts";
import type { Speaker } from "./fiches-detection.ts";
import { classifyPlay } from "./theatre.ts";

export interface CastEntry {
  name: string;
  presentation: string;
}

export interface CastBlock {
  // Du début de « PERSONNAGES » au début du premier acte (ou de la fin du texte).
  from: number;
  to: number;
  // Fin de la dernière entrée : la partie que l'app tient à jour s'arrête là ;
  // les lignes libres viennent après.
  generatedTo: number;
  entries: CastEntry[];
  free: string[];
}

// Une entrée : un nom en capitales, suivi d'une virgule ou de la fin de la ligne.
function entryOf(line: string): CastEntry | undefined {
  const comma = line.indexOf(",");
  const head = (comma < 0 ? line : line.slice(0, comma)).trim();
  if (!head || /\p{Ll}/u.test(head) || !/\p{Lu}/u.test(head)) return undefined;
  return { name: head, presentation: comma < 0 ? "" : line.slice(comma + 1).trim() };
}

export function parseCast(text: string): CastBlock | undefined {
  const lines = text.split("\n");
  const kinds = classifyPlay(lines);
  const title = kinds.indexOf("cast-title");
  if (title < 0) return undefined;
  let offset = 0;
  const starts = lines.map((line) => {
    const start = offset;
    offset += line.length + 1;
    return start;
  });
  const block: CastBlock = { from: starts[title], to: text.length, generatedTo: starts[title] + lines[title].length, entries: [], free: [] };
  for (let i = title + 1; i < lines.length; i++) {
    if (kinds[i] === "act" || kinds[i] === "scene") {
      block.to = starts[i];
      break;
    }
    if (kinds[i] !== "cast") continue;
    const entry = entryOf(lines[i]);
    if (entry) {
      block.entries.push(entry);
      block.generatedTo = starts[i] + lines[i].length;
    } else {
      block.free.push(lines[i].trim());
    }
  }
  return block;
}

// « NOM, présentation. », ou le nom seul.
export function castLine(sheet: Sheet): string {
  const name = displayName(sheet).toLocaleUpperCase("fr");
  const presentation = sheet.castLine.trim();
  if (!presentation) return name;
  return `${name}, ${presentation}${/[.!?…]$/.test(presentation) ? "" : "."}`;
}

// Le personnage qui parle le plus d'abord (en mots prononcés), puis l'ordre
// d'entrée en scène ; ceux qui ne parlent pas ensuite, par ordre de création.
export function orderedSheets(sheets: Sheet[], speakers: Speaker[]): Sheet[] {
  const spoken = new Map<string, { words: number; first: number }>();
  for (const speaker of speakers) {
    const sheet = speakerSheet(speaker, sheets);
    if (!sheet) continue;
    const known = spoken.get(sheet.id);
    spoken.set(sheet.id, known ? { words: known.words + speaker.words, first: Math.min(known.first, speaker.first) } : { words: speaker.words, first: speaker.first });
  }
  return [...sheets].sort((a, b) => {
    const sa = spoken.get(a.id);
    const sb = spoken.get(b.id);
    if (sa && sb) return sb.words - sa.words || sa.first - sb.first;
    if (sa || sb) return sa ? -1 : 1;
    return a.created - b.created;
  });
}

export function castText(sheets: Sheet[], speakers: Speaker[], free: string[]): string {
  const lines = orderedSheets(sheets, speakers).map(castLine);
  return `PERSONNAGES\n\n${lines.join("\n")}\n${free.length ? `\n${free.join("\n")}\n` : ""}\n`;
}

// Le changement qui refait la liste à partir des fiches, ou la crée en tête
// de la pièce ; undefined si elle est déjà à jour.
export function castChange(text: string, sheets: Sheet[], speakers: Speaker[]): { from: number; to: number; insert: string } | undefined {
  const block = parseCast(text);
  const insert = castText(sheets, speakers, block?.free ?? []);
  if (!block) return { from: 0, to: 0, insert };
  if (text.slice(block.from, block.to) === insert) return undefined;
  return { from: block.from, to: block.to, insert };
}

// Une fiche par entrée d'une liste écrite à la main, dans l'ordre de la liste.
export function importCast(block: CastBlock, newId: () => string, now: number): Sheet[] {
  return block.entries.map((entry, index) => ({ ...sheetFromLabel(entry.name, newId(), now + index), castLine: entry.presentation }));
}

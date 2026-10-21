// Une pièce traduite en Markdown de Pandoc pour l'export : chaque élément est
// placé dans un bloc qui porte un style nommé. Les modèles Word et
// OpenDocument définissent ces styles ; le filtre theatre.lua les traduit pour
// le PDF. Le texte de chaque élément est déjà celui de la mise en page.

import { classifyPlay } from "./theatre.ts";
import type { PlayLine } from "./theatre.ts";

export type PlayLayout = "manuscrit" | "edition";
export type PlayPage = "a4" | "a5";
export type PlayModel = "manuscrit" | "edition-a4" | "edition-a5";

const STYLE_OF: Partial<Record<PlayLine, string>> = {
  act: "Acte",
  scene: "Scene",
  "cast-title": "Personnages",
  cast: "Distribution",
  character: "Personnage",
  dialogue: "Replique",
  stage: "Didascalie",
  text: "Texte",
};

// Les styles nommés, dans l'ordre où les modèles les définissent.
export const PLAY_STYLES = ["Acte", "Scene", "Personnages", "Distribution", "Personnage", "Replique", "Didascalie", "Texte"];

export function playModel(layout: PlayLayout, page: PlayPage): PlayModel {
  return layout === "manuscrit" ? "manuscrit" : page === "a5" ? "edition-a5" : "edition-a4";
}

// Une ligne qui ouvrirait un bloc de Markdown (titre, citation, liste, fin
// de bloc) reste du texte.
function escapeLine(text: string): string {
  return text
    .replace(/^(\s*)([#>+\-*]|:{3,})(?=\s|$)/, "$1\\$2")
    .replace(/^(\s*\d+)([.)])(?=\s|$)/, "$1\\$2");
}

function shown(kind: PlayLine, line: string, layout: PlayLayout): string {
  const manuscript = layout === "manuscrit";
  switch (kind) {
    case "act":
    case "scene": {
      const title = line.replace(/^#+[ \t]+/, "");
      return manuscript ? title.toLocaleUpperCase("fr") : title;
    }
    case "cast-title":
      return manuscript ? "PERSONNAGES" : "Personnages";
    case "stage":
      // À l'édition, l'italique suffit à distinguer la didascalie.
      return manuscript ? line : line.replace(/^\((.*)\)$/, "$1").trim();
    default:
      return line;
  }
}

// Un élément de la pièce à l'export : son style nommé, et ses lignes telles
// que la mise en page les montre. Les lignes d'une même réplique, ou d'un même
// paragraphe de texte, forment un seul élément ; chaque autre ligne a le sien.
export interface PlayBlock {
  style: string;
  lines: string[];
}

export function playBlocks(text: string, layout: PlayLayout): PlayBlock[] {
  const lines = text.split("\n");
  const kinds = classifyPlay(lines);
  const blocks: PlayBlock[] = [];
  let group: PlayBlock | undefined;
  lines.forEach((line, index) => {
    const kind = kinds[index];
    const style = STYLE_OF[kind];
    if (!style) {
      group = undefined;
      return;
    }
    const joins = (kind === "dialogue" || kind === "text") && group?.style === style;
    if (!joins) {
      group = { style, lines: [] };
      blocks.push(group);
    }
    group!.lines.push(shown(kind, line.trim(), layout));
  });
  return blocks;
}

export function playToPandoc(text: string, layout: PlayLayout): string {
  // Les lignes d'une réplique sont séparées par un saut de ligne forcé (« \ »
  // en fin de ligne) : un vers reste un vers. Celles d'un paragraphe de texte
  // se suivent, comme dans un roman.
  const blocks = playBlocks(text, layout).map((block) => {
    const separator = block.style === "Replique" ? "\\\n" : "\n";
    return `::: {custom-style="${block.style}"}\n${block.lines.map(escapeLine).join(separator)}\n:::`;
  });
  return blocks.join("\n\n") + "\n";
}

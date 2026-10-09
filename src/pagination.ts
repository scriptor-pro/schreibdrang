// Découpage d'un scénario en pages, selon sa mise en page habituelle : police
// à chasse fixe de dix caractères au pouce, 55 lignes par page, et une
// largeur propre à chaque élément. La page de titre ne compte pas.

import { sceneTitle } from "./fountain.ts";
import type { LineKind } from "./fountain.ts";

export const LINES_PER_PAGE = 55;

// Largeur de la page, en caractères, et retrait de chaque élément : les
// positions habituelles, à 3,7, 3,1 et 2,5 pouces du bord de la page.
const PAGE_WIDTH = 60;
const INDENTS: Partial<Record<LineKind, number>> = {
  character: 22,
  parenthetical: 16,
  dialogue: 10,
};

// Largeur de chaque élément, en caractères. Les sections, les synopsis et la
// page de titre ne s'impriment pas.
const WIDTHS: Partial<Record<LineKind, number>> = {
  scene: 60,
  action: 60,
  transition: 60,
  centered: 60,
  character: 38,
  parenthetical: 25,
  dialogue: 35,
};

// Une page commence à cette ligne du texte (comptée à partir de 0), au
// caractère indiqué : 0 si elle commence avec la ligne, davantage si la
// coupure tombe au milieu d'un paragraphe.
export interface PageBreak {
  line: number;
  offset: number;
}

// Début de chaque ligne imprimée d'un paragraphe composé à cette largeur. La
// coupure se fait entre deux mots, ou après un trait d'union ; un mot plus
// long que la ligne est coupé à la largeur.
export function wrapOffsets(text: string, width: number): number[] {
  const starts = [0];
  let lineStart = 0;
  // Seules l'espace ordinaire et la tabulation séparent les mots : une espace
  // insécable ne permet pas de couper la ligne.
  for (const token of text.matchAll(/[^ \t-]*-+|[^ \t-]+/g)) {
    const start = token.index;
    const end = start + token[0].length;
    if (end - lineStart <= width) continue;
    if (start > lineStart) {
      lineStart = start;
      starts.push(lineStart);
    }
    while (end - lineStart > width) {
      lineStart += width;
      starts.push(lineStart);
    }
  }
  return starts;
}

interface Item {
  line: number;
  kind: LineKind;
  // Débuts des lignes imprimées ; vide pour une ligne vide.
  starts: number[];
}

export function paginate(lines: string[], kinds: LineKind[], perPage = LINES_PER_PAGE): PageBreak[] {
  // Ce qui s'imprime, dans l'ordre : plusieurs lignes vides n'en font qu'une,
  // et il n'y en a pas avant le premier élément.
  const items: Item[] = [];
  lines.forEach((text, line) => {
    const kind = kinds[line];
    if (kind === "blank") {
      const last = items[items.length - 1];
      if (last && last.kind !== "blank" && last.kind !== "pagebreak") items.push({ line, kind, starts: [] });
    } else if (kind === "pagebreak") {
      items.push({ line, kind, starts: [] });
    } else if (WIDTHS[kind]) {
      items.push({ line, kind, starts: wrapOffsets(text, WIDTHS[kind]) });
    }
  });

  const breaks: PageBreak[] = [];
  let used = 0;
  const breakBefore = (item: Item, offset = 0) => {
    breaks.push({ line: item.line, offset });
    used = 0;
  };

  // Un nom de personnage, ses didascalies et sa réplique : fin du bloc, et
  // nombre de lignes imprimées.
  const dialogueBlock = (index: number) => {
    let end = index + 1;
    while (end < items.length && (items[end].kind === "dialogue" || items[end].kind === "parenthetical")) end += 1;
    return { end, needed: items.slice(index, end).reduce((sum, part) => sum + part.starts.length, 0) };
  };

  // Nombre de lignes d'un élément qui tiennent dans la place restante : tout
  // l'élément, une partie, ou rien (0) s'il doit commencer la page suivante.
  const linesThatFit = (index: number, room: number): number => {
    const item = items[index];
    const count = item.kind === "character" ? dialogueBlock(index).needed : item.starts.length;
    if (count <= room) return count;
    // Un dialogue n'est pas séparé de son personnage, sauf s'il dépasse une
    // page à lui seul. Les autres éléments passent d'une page à l'autre ligne
    // par ligne, sans laisser une ligne isolée en bas ou en haut de page.
    if (item.kind === "character" && count <= perPage) return 0;
    if (item.kind === "scene") return 0;
    return room >= 2 && count - room >= 2 ? room : 0;
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === "blank") {
      // Pas de ligne vide en haut de page.
      if (used > 0 && used < perPage) used += 1;
      continue;
    }
    if (item.kind === "pagebreak") {
      // Saut de page demandé (« === ») : la page suivante commence au
      // prochain élément.
      const next = items.slice(index + 1).find((other) => other.kind !== "blank" && other.kind !== "pagebreak");
      if (next && used > 0) breakBefore(next);
      continue;
    }

    if (item.kind === "scene") {
      // Un intitulé de scène n'est pas laissé seul en bas de page : s'il ne
      // reste pas, après lui et une ligne vide, de quoi commencer l'élément
      // suivant, l'intitulé passe lui aussi à la page suivante.
      const next = items.findIndex((other, at) => at > index && other.kind !== "blank" && other.kind !== "pagebreak");
      const room = perPage - used - item.starts.length - 1;
      if (used > 0 && (room < 0 || (next !== -1 && linesThatFit(next, room) === 0))) breakBefore(item);
      used += item.starts.length;
      continue;
    }

    const block = item.kind === "character" ? dialogueBlock(index) : undefined;
    const count = block ? block.needed : item.starts.length;
    const fit = linesThatFit(index, perPage - used);
    if (block && count <= perPage) {
      if (fit === 0) breakBefore(item);
      used += count;
      index = block.end - 1;
      continue;
    }
    if (fit === count) {
      used += count;
      continue;
    }
    // L'élément est coupé : `fit` lignes restent sur cette page (aucune s'il
    // commence la suivante), puis une page pleine à la fois.
    let done = fit;
    breakBefore(item, item.starts[done]);
    while (item.starts.length - done > perPage) {
      done += perPage;
      breakBefore(item, item.starts[done]);
    }
    used = item.starts.length - done;
  }
  return breaks;
}

// Numéro de la page qui contient cette position (ligne comptée à partir de 0).
export function pageAt(breaks: PageBreak[], line: number, offset: number): number {
  let page = 1;
  for (const start of breaks) {
    if (start.line < line || (start.line === line && start.offset <= offset)) page += 1;
    else break;
  }
  return page;
}

// Un passage d'une ligne imprimée, dans une seule graisse : maigre (""),
// gras ("b"), italique ("i") ou gras italique ("bi").
export interface PrintedRun {
  text: string;
  style: "" | "b" | "i" | "bi";
}

// Une ligne imprimée, retrait compris ; vide pour une ligne vide.
export type PrintedLine = PrintedRun[];

// Ce qui s'imprime de chaque caractère d'une ligne : sa graisse, ou rien
// (`undefined`) pour une marque Fountain, qui fixe la nature de la ligne ou
// met un passage en valeur.
function printedStyles(text: string, kind: LineKind): (PrintedRun["style"] | undefined)[] {
  const styles: (PrintedRun["style"] | undefined)[] = new Array(text.length).fill(undefined);
  let from = text.length - text.trimStart().length;
  let to = text.trimEnd().length;
  const first = text[from];
  if (
    (kind === "scene" && sceneTitle(text.trim()) !== text.trim()) ||
    (kind === "action" && first === "!") ||
    (kind === "character" && first === "@") ||
    ((kind === "transition" || kind === "centered") && first === ">")
  ) {
    from += 1;
  }
  const last = text[to - 1];
  if (to > from && ((kind === "character" && last === "^") || (kind === "centered" && last === "<"))) to -= 1;

  // Longueur de la suite d'étoiles qui commence ici.
  const stars = (at: number, end: number) => {
    let count = 0;
    while (at + count < end && text[at + count] === "*") count += 1;
    return count;
  };
  // « *italique* », « **gras** », « ***gras italique*** » : les étoiles
  // collent au passage qu'elles entourent, et se ferment sur la même ligne.
  const mark = (start: number, end: number, bold: boolean, italic: boolean) => {
    const style = `${bold ? "b" : ""}${italic ? "i" : ""}` as PrintedRun["style"];
    let at = start;
    while (at < end) {
      if (text[at] === "\\" && text[at + 1] === "*" && at + 1 < end) {
        styles[at + 1] = style;
        at += 2;
        continue;
      }
      const count = Math.min(stars(at, end), 3);
      if (count > 0 && at + count < end && !/\s/.test(text[at + count])) {
        let close = at + count + 1;
        while (close < end) {
          if (text[close] === "\\") close += 2;
          else if (text[close] !== "*") close += 1;
          else if (stars(close, end) === count && !/\s/.test(text[close - 1])) break;
          else close += stars(close, end);
        }
        if (close < end) {
          mark(at + count, close, bold || count >= 2, italic || count !== 2);
          at = close + count;
          continue;
        }
      }
      const literal = Math.max(1, stars(at, end));
      for (let index = at; index < at + literal; index += 1) styles[index] = style;
      at += literal;
    }
  };
  mark(from, to, kind === "scene", false);
  return styles;
}

// Les pages du scénario telles qu'elles s'impriment, ligne par ligne, avec
// leur retrait. Les lignes et les coupures sont celles de l'éditeur.
export function printedPages(lines: string[], kinds: LineKind[], perPage = LINES_PER_PAGE): PrintedLine[][] {
  const breaks = paginate(lines, kinds, perPage);
  const pages: PrintedLine[][] = [[]];
  let next = 0;
  lines.forEach((text, line) => {
    const kind = kinds[line];
    const page = pages[pages.length - 1];
    if (kind === "blank") {
      // Ni ligne vide en haut de page, ni deux lignes vides de suite.
      if (page.length > 0 && page[page.length - 1].length > 0) page.push([]);
      return;
    }
    const width = WIDTHS[kind];
    if (!width) return;
    const styles = printedStyles(text, kind);
    const starts = wrapOffsets(text, width);
    starts.forEach((start, index) => {
      if (next < breaks.length && breaks[next].line === line && breaks[next].offset === start) {
        next += 1;
        pages.push([]);
      }
      // Les caractères imprimés de cette ligne, sans espace au début ni à la fin.
      let from = start;
      let to = index === starts.length - 1 ? text.length : starts[index + 1];
      const skipped = (at: number) => styles[at] === undefined || /\s/.test(text[at]);
      while (from < to && skipped(from)) from += 1;
      while (to > from && skipped(to - 1)) to -= 1;
      const runs: PrintedLine = [];
      let length = 0;
      for (let at = from; at < to; at += 1) {
        const style = styles[at];
        if (style === undefined) continue;
        length += 1;
        const last = runs[runs.length - 1];
        if (last && last.style === style) last.text += text[at];
        else runs.push({ text: text[at], style });
      }
      let indent = INDENTS[kind] ?? 0;
      if (kind === "transition") indent = Math.max(0, PAGE_WIDTH - length);
      else if (kind === "centered") indent = Math.max(0, Math.floor((PAGE_WIDTH - length) / 2));
      // Le retrait est en maigre.
      if (indent > 0 && runs[0]?.style === "") runs[0].text = " ".repeat(indent) + runs[0].text;
      else if (indent > 0 && runs.length > 0) runs.unshift({ text: " ".repeat(indent), style: "" });
      pages[pages.length - 1].push(runs);
    });
  });
  // Une page ne se termine pas par une ligne vide.
  for (const page of pages) while (page.length > 0 && page[page.length - 1].length === 0) page.pop();
  return pages;
}

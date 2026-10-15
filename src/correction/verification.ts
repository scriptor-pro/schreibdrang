// Correction : l'ordre dans lequel les passages sont relus, et les messages
// du pied de page.

import type { Passage } from "./extraction.ts";

// Les passages affichés à l'écran d'abord, puis ceux qui les suivent, puis
// ceux qui les précèdent.
export function readingOrder(passages: Passage[], viewFrom: number, viewTo: number): Passage[] {
  const shown: Passage[] = [];
  const after: Passage[] = [];
  const before: Passage[] = [];
  for (const passage of passages) {
    if (passage.to < viewFrom) before.push(passage);
    else if (passage.from > viewTo) after.push(passage);
    else shown.push(passage);
  }
  return [...shown, ...after, ...before];
}

// Les passages touchés par la sélection, entiers.
export function passagesIn(passages: Passage[], from: number, to: number): Passage[] {
  return passages.filter((passage) => passage.to > from && passage.from < to);
}

export function progressMessage(done: number, total: number): string {
  return `Vérification : ${total ? Math.floor((done * 100) / total) : 100} %`;
}

const fmt = new Intl.NumberFormat("fr-FR");

export function remarksMessage(count: number): string {
  if (count === 0) return "Aucune remarque";
  if (count === 1) return "1 remarque";
  return `${fmt.format(count)} remarques`;
}

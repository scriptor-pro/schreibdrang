// Correction : les remarques affichées et la bulle ouverte, dans l'état de
// l'éditeur. Les remarques suivent les modifications du texte ; celles d'un
// passage modifié disparaissent jusqu'à sa prochaine relecture.

import { StateEffect, StateField } from "@codemirror/state";
import type { ChangeSet } from "@codemirror/state";
import type { Remark } from "./remarques.ts";

// Remplace toutes les remarques affichées.
export const setRemarks = StateEffect.define<Remark[]>();
// Ouvre la bulle d'une remarque, ou la ferme.
export const openBubble = StateEffect.define<Remark | null>();

export interface Correction {
  remarks: Remark[];
  bubble: Remark | null;
}

function mapRemarks(remarks: Remark[], changes: ChangeSet): Remark[] {
  return remarks
    .filter((remark) => !changes.touchesRange(remark.passage.from, remark.passage.to))
    .map((remark) => ({
      ...remark,
      from: changes.mapPos(remark.from, 1),
      to: changes.mapPos(remark.to, -1),
      passage: { from: changes.mapPos(remark.passage.from, 1), to: changes.mapPos(remark.passage.to, -1) },
    }));
}

// Un seul champ pour les remarques et la bulle : la bulle se ferme quand sa
// remarque disparaît, ce qu'un champ séparé ne pourrait pas voir.
export const correctionField = StateField.define<Correction>({
  create: () => ({ remarks: [], bubble: null }),
  update(value, tr) {
    let { remarks, bubble } = value;
    // La bulle se ferme quand le texte change ou quand le curseur part ailleurs.
    if (tr.docChanged) {
      bubble = null;
      if (remarks.length) remarks = mapRemarks(remarks, tr.changes);
    } else if (tr.selection) {
      bubble = null;
    }
    for (const effect of tr.effects) {
      if (effect.is(setRemarks)) remarks = effect.value;
      if (effect.is(openBubble)) bubble = effect.value;
    }
    // Les remarques redessinées sont de nouveaux objets : la bulle garde le
    // sien tant qu'une remarque de même clé commence au même endroit.
    const open = bubble;
    if (open && !remarks.some((remark) => remark.key === open.key && remark.from === open.from)) bubble = null;
    return remarks === value.remarks && bubble === value.bubble ? value : { remarks, bubble };
  },
});

// La remarque suivante (1) ou précédente (-1), en revenant au début ou à la
// fin du texte. Les remarques sont dans l'ordre du document.
export function nextRemark(remarks: Remark[], pos: number, direction: 1 | -1): Remark | undefined {
  if (!remarks.length) return undefined;
  if (direction === 1) return remarks.find((remark) => remark.from > pos) ?? remarks[0];
  for (let index = remarks.length - 1; index >= 0; index -= 1) if (remarks[index].from < pos) return remarks[index];
  return remarks[remarks.length - 1];
}

export function remarkAt(remarks: Remark[], pos: number): Remark | undefined {
  return remarks.find((remark) => remark.to > remark.from && remark.from <= pos && pos <= remark.to);
}

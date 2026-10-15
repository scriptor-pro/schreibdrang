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
// Avec openBubble, au clavier (F8, Maj+F8) : la bulle prend le focus. Ouverte
// par un clic, elle le laisse au texte, où l'on continue d'écrire.
export const focusBubble = StateEffect.define<boolean>();

export interface Correction {
  remarks: Remark[];
  bubble: Remark | null;
  // Vrai si la bulle ouverte prend le focus.
  focus: boolean;
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
  create: () => ({ remarks: [], bubble: null, focus: false }),
  update(value, tr) {
    let { remarks, bubble, focus } = value;
    // La bulle se ferme quand le texte change ou quand le curseur part ailleurs.
    if (tr.docChanged) {
      bubble = null;
      if (remarks.length) remarks = mapRemarks(remarks, tr.changes);
    } else if (tr.selection) {
      bubble = null;
    }
    for (const effect of tr.effects) {
      if (effect.is(setRemarks)) remarks = effect.value;
      if (effect.is(openBubble)) {
        bubble = effect.value;
        focus = false;
      }
    }
    // Les remarques redessinées sont de nouveaux objets : la bulle garde le
    // sien tant qu'une remarque de même clé commence au même endroit.
    const open = bubble;
    if (open && !remarks.some((remark) => remark.key === open.key && remark.from === open.from)) bubble = null;
    for (const effect of tr.effects) if (effect.is(focusBubble)) focus = effect.value;
    if (!bubble) focus = false;
    return remarks === value.remarks && bubble === value.bubble && focus === value.focus ? value : { remarks, bubble, focus };
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

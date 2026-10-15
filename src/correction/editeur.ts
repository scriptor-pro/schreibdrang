// Correction dans l'éditeur : le soulignement des remarques, leur bulle, le
// clic sur un passage souligné, Échap et le passage d'une remarque à l'autre.

import { Facet, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, showTooltip } from "@codemirror/view";
import type { Tooltip } from "@codemirror/view";
import { correctionField, focusBubble, nextRemark, openBubble, remarkAt } from "./etat.ts";
import type { Kind, Remark } from "./remarques.ts";
import { bubbleView } from "./bulle.ts";

// Ce que la bulle et Échap demandent à l'app.
export interface CorrectionActions {
  suggest(word: string): Promise<string[]>;
  ignore(remark: Remark): void;
  ignoreRule(remark: Remark): void;
  addToText(word: string): void;
  addToPersonal(word: string): void;
  // Arrête une vérification en cours ; faux s'il n'y en a pas.
  stop(): boolean;
}

const actionsFacet = Facet.define<CorrectionActions, CorrectionActions | undefined>({
  combine: (values) => values[0],
});

// Toutes en outremer ; la forme du trait dit la sorte (voir styles.css).
const MARKS: Record<Kind, Decoration> = {
  grammaire: Decoration.mark({ class: "cm-remarque cm-remarque-grammaire" }),
  orthographe: Decoration.mark({ class: "cm-remarque cm-remarque-orthographe" }),
  typographie: Decoration.mark({ class: "cm-remarque cm-remarque-typographie" }),
};

const underline = EditorView.decorations.compute([correctionField], (state) =>
  Decoration.set(
    state
      .field(correctionField)
      .remarks.filter((remark) => remark.to > remark.from)
      .map((remark) => MARKS[remark.kind].range(remark.from, remark.to)),
    true,
  ),
);

// Une bulle par remarque : tant que la remarque est la même, l'infobulle
// n'est pas recréée, et garde son focus et ses suggestions.
const tooltips = new WeakMap<Remark, Tooltip>();

function tooltipFor(remark: Remark): Tooltip {
  let tooltip = tooltips.get(remark);
  if (!tooltip) {
    tooltip = {
      pos: remark.from,
      end: remark.to,
      above: false,
      create: (view) => bubbleView(view, remark, view.state.facet(actionsFacet)!),
    };
    tooltips.set(remark, tooltip);
  }
  return tooltip;
}

const bubble = showTooltip.compute([correctionField], (state) => {
  const remark = state.field(correctionField).bubble;
  return remark ? tooltipFor(remark) : null;
});

// Un clic sur un passage souligné ouvre sa bulle, sans quitter le texte.
const clickToOpen = EditorView.domEventHandlers({
  click(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const remark = pos === null ? undefined : remarkAt(view.state.field(correctionField).remarks, pos);
    if (remark) view.dispatch({ effects: openBubble.of(remark) });
    return false;
  },
});

// Échap dans le texte arrête une vérification en cours, ou ferme la bulle
// ouverte ; sinon, il garde ses autres usages (fermer la recherche, quitter
// le plein écran).
const escape = Prec.high(
  keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (view.state.facet(actionsFacet)?.stop()) return true;
        if (!view.state.field(correctionField).bubble) return false;
        view.dispatch({ effects: openBubble.of(null) });
        return true;
      },
    },
  ]),
);

export function correctionExtension(actions: CorrectionActions): Extension {
  return [correctionField, underline, bubble, clickToOpen, escape, actionsFacet.of(actions)];
}

// F8 et Maj+F8 : le curseur va sur la remarque suivante ou précédente, et sa
// bulle s'ouvre et prend le focus.
export function goToRemark(view: EditorView, direction: 1 | -1): boolean {
  const remarks = view.state.field(correctionField, false)?.remarks ?? [];
  const remark = nextRemark(remarks, view.state.selection.main.head, direction);
  if (!remark) return false;
  view.dispatch({
    selection: { anchor: remark.from },
    effects: [openBubble.of(remark), focusBubble.of(true), EditorView.scrollIntoView(remark.from, { y: "center" })],
  });
  return true;
}

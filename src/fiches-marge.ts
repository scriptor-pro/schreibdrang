// L'invitation à créer une fiche, dans la marge de gauche, à la hauteur du
// nom qui l'a fait naître. Elle suit le texte quand on le modifie ou qu'on le
// fait défiler. Si la marge est trop étroite, l'app la montre dans le pied de
// page ; elle y reste aussi, invisible, pour les lecteurs d'écran.

import { StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, layer } from "@codemirror/view";
import type { EditorView, LayerMarker, ViewUpdate } from "@codemirror/view";

export interface MarginAction {
  label: string;
  run(): void;
}

export interface MarginProposal {
  // Change à chaque nouvelle invitation, pour la redessiner.
  id: number;
  // Début du nom dans le texte.
  pos: number;
  text: string;
  actions: MarginAction[];
}

export const setMarginProposal = StateEffect.define<MarginProposal | null>();

export const marginProposal = StateField.define<MarginProposal | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setMarginProposal)) return effect.value;
    if (!value || !tr.docChanged) return value;
    const pos = tr.changes.mapPos(value.pos, 1);
    return pos === value.pos ? value : { ...value, pos };
  },
});

// Écart entre l'invitation et le texte, et entre l'invitation et le bord de
// l'éditeur, en pixels.
export const MARGIN_GAP = 16;
// Largeur de l'invitation, en rem : au plus 16, au moins 12, sinon elle va
// dans le pied de page.
const MAX_REM = 16;
const MIN_REM = 12;

// La place de l'invitation dans une marge de `room` pixels, comptés depuis le
// bord gauche de l'éditeur : son bord gauche et sa largeur, ou rien si la
// marge est trop étroite. Elle est calée contre le texte.
export function marginBox(room: number, rem: number): { left: number; width: number } | null {
  const width = Math.min(room - 2 * MARGIN_GAP, MAX_REM * rem);
  if (width < MIN_REM * rem) return null;
  return { left: room - MARGIN_GAP - width, width };
}

function rootRem(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

// La marge de gauche, mesurée ; rien si l'éditeur est masqué (accueil, cork
// board).
function measureBox(view: EditorView): { left: number; width: number } | null | undefined {
  const scroller = view.scrollDOM.getBoundingClientRect();
  if (scroller.width === 0) return undefined;
  return marginBox(view.contentDOM.getBoundingClientRect().left - scroller.left, rootRem());
}

class ProposalMarker implements LayerMarker {
  readonly proposal: MarginProposal;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  constructor(proposal: MarginProposal, left: number, top: number, width: number) {
    this.proposal = proposal;
    this.left = left;
    this.top = top;
    this.width = width;
  }
  eq(other: ProposalMarker) {
    return other.proposal.id === this.proposal.id && other.left === this.left && other.top === this.top && other.width === this.width;
  }
  draw() {
    const box = document.createElement("div");
    box.className = "cm-people-margin";
    box.style.left = `${this.left}px`;
    box.style.top = `${this.top}px`;
    box.style.width = `${this.width}px`;
    box.append(this.proposal.text);
    for (const action of this.proposal.actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => action.run());
      box.append(" ", button);
    }
    // Un clic dans l'invitation ne place pas le curseur dans le texte.
    box.addEventListener("mousedown", (event) => event.stopPropagation());
    return box;
  }
}

const proposalLayer = layer({
  above: true,
  class: "cm-people-margin-layer",
  update: (update) =>
    update.docChanged || update.viewportChanged || update.geometryChanged || update.startState.field(marginProposal) !== update.state.field(marginProposal),
  markers(view) {
    const proposal = view.state.field(marginProposal);
    if (!proposal || proposal.pos < view.viewport.from || proposal.pos > view.viewport.to) return [];
    const box = measureBox(view);
    if (!box) return [];
    const coords = view.coordsAtPos(proposal.pos, 1);
    if (!coords) return [];
    const scroller = view.scrollDOM.getBoundingClientRect();
    const top = coords.top - scroller.top + view.scrollDOM.scrollTop;
    return [new ProposalMarker(proposal, box.left + view.scrollDOM.scrollLeft, top, box.width)];
  },
});

// `onRoom` apprend à l'app, à chaque changement de taille, si la marge a la
// place d'une invitation.
export function marginProposals(onRoom: (room: boolean) => void): Extension {
  const place = ViewPlugin.fromClass(
    class {
      readonly view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        this.measure();
      }
      update(update: ViewUpdate) {
        if (update.geometryChanged) this.measure();
      }
      measure() {
        this.view.requestMeasure({
          key: this,
          read: (view) => measureBox(view),
          write: (box) => {
            if (box !== undefined) onRoom(box !== null);
          },
        });
      }
    },
  );
  return [marginProposal, proposalLayer, place];
}

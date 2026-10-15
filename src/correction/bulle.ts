// La bulle d'une remarque : sa sorte, le message, les suggestions et les
// actions. Ouverte au clavier (F8), elle prend le focus : il arrive sur la première
// suggestion, Tab passe d'un bouton à l'autre, Entrée ou Espace active le
// bouton, Échap ferme la bulle et rend le focus au texte.

import type { EditorView, TooltipView } from "@codemirror/view";
import { correctionField, openBubble } from "./etat.ts";
import { KIND_LABELS } from "./remarques.ts";
import type { Remark } from "./remarques.ts";
import type { CorrectionActions } from "./editeur.ts";

function element(tag: string, className: string, text = ""): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  node.addEventListener("click", action);
  return node;
}

export function bubbleView(view: EditorView, remark: Remark, actions: CorrectionActions): TooltipView {
  const dom = element("div", "cm-bulle");
  dom.tabIndex = -1;
  dom.setAttribute("role", "dialog");
  dom.setAttribute("aria-label", KIND_LABELS[remark.kind]);
  const suggestions = element("div", "cm-bulle-suggestions");
  const buttons = element("div", "cm-bulle-actions");

  const close = () => {
    view.dispatch({ effects: openBubble.of(null) });
    view.focus();
  };
  // Remplacer le passage efface les remarques de son paragraphe : il sera
  // relu à la prochaine vérification.
  const replace = (text: string) => {
    view.dispatch({
      changes: { from: remark.from, to: remark.to, insert: text },
      selection: { anchor: remark.from + text.length },
      userEvent: "input.complete",
    });
    view.focus();
  };
  const fill = (list: string[]) => {
    if (list.length) suggestions.replaceChildren(...list.map((text) => button(text, () => replace(text))));
    else suggestions.replaceChildren(element("p", "cm-bulle-attente", "Aucune suggestion."));
  };

  if (remark.kind === "orthographe") {
    // Les suggestions d'un mot inconnu sont cherchées maintenant : elles
    // prennent du temps.
    suggestions.append(element("p", "cm-bulle-attente", "Recherche de suggestions…"));
    actions.suggest(remark.excerpt).then(
      (list) => {
        if (!dom.isConnected) return;
        const waiting = document.activeElement === dom;
        fill(list);
        if (waiting) (suggestions.querySelector("button") ?? buttons.querySelector("button"))?.focus();
      },
      () => fill([]),
    );
  } else {
    fill(remark.suggestions);
  }

  // Chaque action retire la remarque ; la bulle se ferme et le focus revient au texte.
  const then = (action: () => void) => () => {
    action();
    close();
  };
  buttons.append(button("Ignorer", then(() => actions.ignore(remark))));
  if (remark.kind === "orthographe") {
    buttons.append(
      button("Ajouter au dictionnaire du texte", then(() => actions.addToText(remark.excerpt))),
      button("Ajouter à mon dictionnaire", then(() => actions.addToPersonal(remark.excerpt))),
    );
  } else {
    buttons.append(button("Ignorer cette règle", then(() => actions.ignoreRule(remark))));
  }

  dom.append(element("p", "cm-bulle-sorte", KIND_LABELS[remark.kind]), element("p", "cm-bulle-message", remark.message), suggestions, buttons);
  dom.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // Échap ferme la bulle, et ne quitte pas le plein écran.
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  return {
    dom,
    mount() {
      // Ouverte par un clic, la bulle laisse le focus au texte : on y continue
      // d'écrire. Ouverte au clavier, elle le prend ; pour un mot inconnu, il
      // attend sur la bulle que les suggestions arrivent.
      if (!view.state.field(correctionField).focus) return;
      const first = remark.kind === "orthographe" ? dom : (suggestions.querySelector("button") ?? buttons.querySelector("button"));
      first?.focus();
    },
  };
}

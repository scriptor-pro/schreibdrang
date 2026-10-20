// Les fiches personnage dans l'éditeur : les noms soulignés, le double-clic
// qui ouvre une fiche, l'autocomplétion des noms, la protection de la liste
// en tête de pièce quand l'app la tient, et le signal d'un mot qui vient
// d'être tapé (pour proposer une fiche).

import { Annotation, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { Extension, StateEffectType } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { acceptCompletion, autocompletion, closeCompletion } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import type { Sheet } from "./fiches.ts";
import { completionsFor, findNames, hitAt } from "./fiches-noms.ts";
import type { NameHit } from "./fiches-noms.ts";
import { wordBefore } from "./fiches-detection.ts";
import type { Candidate } from "./fiches-detection.ts";
import type { Format } from "./recents.ts";

export interface PeopleHost {
  sheets(): Sheet[];
  format(): Format;
  // Faux au format page blanche : rien de ce module n'agit.
  enabled(): boolean;
  // Le réglage « Proposer les noms des personnages pendant la frappe ».
  completion(): boolean;
  // Double-clic sur un nom, ou commande : les fiches qui portent ce nom.
  open(ids: string[]): void;
  // Un mot vient d'être terminé à la frappe.
  typedWord(candidate: Candidate): void;
  // La partie de la liste en tête de pièce que l'app tient à jour.
  protectedRange(): { from: number; to: number } | undefined;
  // Une écriture dans cette partie a été refusée.
  refused(): void;
}

// À envoyer quand les fiches changent : les noms soulignés sont recalculés.
export const refreshNames: StateEffectType<null> = StateEffect.define<null>();
// La fiche ouverte dans le panneau : ses noms sont surlignés.
export const activeSheet: StateEffectType<string | undefined> = StateEffect.define<string | undefined>();
// Marque une réécriture de la liste par l'app, que la protection laisse passer.
export const castRewrite = Annotation.define<boolean>();

const activeField = StateField.define<string | undefined>({
  create: () => undefined,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(activeSheet)) value = effect.value;
    return value;
  },
});

const WORD = /[\p{L}\p{M}]+(?:[-‑][\p{L}\p{M}]+)*/gu;
const GAP = /^[ \t  ]+$/;

// La source de l'autocomplétion : le dernier mot tapé, ou les deux ou trois
// derniers pour un surnom de plusieurs mots (« le p » → « le père Gaston »).
export function nameSource(host: PeopleHost): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!host.enabled() || !host.completion()) return null;
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const tokens = [...before.matchAll(WORD)];
    const last = tokens[tokens.length - 1];
    if (!last || last.index + last[0].length !== before.length) return null;
    const sheets = host.sheets();
    // Sur une ligne de nom (en capitales), au théâtre et au scénario.
    const format = host.format();
    const upper = (format === "theatre" || format === "scenario") && !/\p{Ll}/u.test(before);
    for (let count = Math.min(3, tokens.length); count >= 1; count--) {
      const first = tokens.length - count;
      let joined = true;
      for (let i = first + 1; i < tokens.length; i++) {
        const gap = before.slice(tokens[i - 1].index + tokens[i - 1][0].length, tokens[i].index);
        if (!GAP.test(gap)) joined = false;
      }
      if (!joined) continue;
      const start = tokens[first].index;
      const found = completionsFor(before.slice(start), sheets);
      if (found.length === 0) continue;
      return {
        from: line.from + start,
        filter: false,
        options: found.map((item) => ({ label: item.label, apply: upper ? item.label.toLocaleUpperCase("fr") : item.label, type: "text" })),
      };
    }
    return null;
  };
}

// La partie de la liste tenue par l'app ne s'écrit pas à la main : seules ses
// réécritures par l'app, et leur annulation, la modifient.
export function protection(host: PeopleHost): Extension {
  return EditorState.changeFilter.of((tr) => {
    if (tr.annotation(castRewrite) || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return true;
    const range = host.protectedRange();
    if (!range) return true;
    let touches = false;
    tr.changes.iterChangedRanges((from, to) => {
      if (from < range.to && to > range.from) touches = true;
    });
    if (!touches) return true;
    host.refused();
    return [range.from, range.to];
  });
}

// Le nom sous le curseur (ou au bord de la sélection).
export function nameAtCursor(view: EditorView, sheets: Sheet[]): NameHit | undefined {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return hitAt(findNames(line.text, sheets, line.from), head);
}

const nameMark = Decoration.mark({ class: "cm-personnage" });
const activeMark = Decoration.mark({ class: "cm-personnage cm-personnage-actif" });

function decorations(view: EditorView, host: PeopleHost): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!host.enabled()) return builder.finish();
  const sheets = host.sheets();
  if (sheets.length === 0) return builder.finish();
  const active = view.state.field(activeField, false);
  // Seule la partie visible est parcourue : un roman entier reste fluide.
  for (const { from, to } of view.visibleRanges) {
    const start = view.state.doc.lineAt(from).from;
    const end = view.state.doc.lineAt(to).to;
    for (const hit of findNames(view.state.doc.sliceString(start, end), sheets, start)) {
      builder.add(hit.from, hit.to, active && hit.ids.includes(active) ? activeMark : nameMark);
    }
  }
  return builder.finish();
}

export function peopleExtension(host: PeopleHost): Extension {
  const names = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorations(view, host);
      }
      update(update: ViewUpdate) {
        const refreshed = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshNames) || e.is(activeSheet)));
        if (update.docChanged || update.viewportChanged || refreshed) this.decorations = decorations(update.view, host);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  return [
    activeField,
    names,
    protection(host),
    autocompletion({ override: [nameSource(host)], defaultKeymap: false, icons: false }),
    // Tab accepte une suggestion affichée ; sans suggestion, Tab garde son
    // rôle (saisie du théâtre et du scénario). Entrée n'accepte jamais.
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptCompletion },
        { key: "Escape", run: closeCompletion },
      ]),
    ),
    EditorView.domEventHandlers({
      // Le double-clic sélectionne le mot comme d'habitude, et ouvre sa fiche.
      dblclick(event, view) {
        if (!host.enabled()) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const line = view.state.doc.lineAt(pos);
        const hit = hitAt(findNames(line.text, host.sheets(), line.from), pos);
        if (hit) host.open(hit.ids);
        return false;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || !host.enabled()) return;
      for (const tr of update.transactions) {
        if (!tr.isUserEvent("input")) continue;
        tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
          const typed = inserted.toString();
          if (typed.length !== 1 && typed !== "\n") return;
          if (/[\p{L}\p{M}\-‑]/u.test(typed)) return;
          const line = update.state.doc.lineAt(fromB);
          const found = wordBefore(line.text, fromB - line.from);
          if (found) host.typedWord({ word: found.word, from: line.from + found.from, to: line.from + found.to });
        });
      }
    }),
    EditorView.theme({
      ".cm-personnage": {
        textDecorationLine: "underline",
        textDecorationStyle: "dotted",
        textDecorationColor: "currentColor",
        textDecorationThickness: "1.5px",
        textUnderlineOffset: "3px",
        textDecorationSkipInk: "none",
      },
      ".cm-personnage-actif": { backgroundColor: "var(--ecr-selection)" },
      ".cm-tooltip.cm-tooltip-autocomplete": {
        border: "1px solid var(--ink)",
        borderRadius: "0",
        backgroundColor: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--font-ui)",
        fontSize: "0.9375rem",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "0.25rem 0.75rem" },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--on-accent)",
      },
    }),
  ];
}

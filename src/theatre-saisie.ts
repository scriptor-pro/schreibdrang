// Saisie d'une pièce, dans l'état de l'éditeur : la nature de chaque ligne,
// le nom ou la réplique en cours de saisie, et les commandes de Tab, Entrée,
// Maj+Entrée et « ( ». Ce module ne touche pas à la page : theatre-editeur.ts
// le branche dans CodeMirror.

import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { couldBeCharacter } from "./fountain.ts";
import { classifyPlay } from "./theatre.ts";
import type { PlayLine } from "./theatre.ts";

// La nature des lignes, relue à chaque modification du texte.
export const playKinds = StateField.define<PlayLine[]>({
  create: (state) => classifyPlay(state.doc.toJSON()),
  update: (value, tr) => (tr.docChanged ? classifyPlay(tr.state.doc.toJSON()) : value),
});

// Tab fait de la ligne en cours un nom : tant que le curseur y reste, ce
// qu'on tape passe en capitales. Entrée ouvre ensuite la réplique. Chaque
// repère est le début d'une ligne ; il tombe quand le curseur la quitte.
export interface PlayEntry {
  character: number | null;
  dialogue: number | null;
}

export const NO_PLAY_ENTRY: PlayEntry = { character: null, dialogue: null };
export const setPlayEntry = StateEffect.define<PlayEntry>();

export const playEntry = StateField.define<PlayEntry>({
  create: () => NO_PLAY_ENTRY,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) if (effect.is(setPlayEntry)) next = effect.value;
    if (next === value && tr.docChanged) {
      const follow = (pos: number | null) => (pos === null ? null : tr.state.doc.lineAt(tr.changes.mapPos(pos, -1)).from);
      next = { character: follow(value.character), dialogue: follow(value.dialogue) };
    }
    const line = tr.state.doc.lineAt(tr.state.selection.main.head).from;
    const character = next.character === line ? line : null;
    const dialogue = next.dialogue === line ? line : null;
    if (character === null && dialogue === null) return NO_PLAY_ENTRY;
    return character === next.character && dialogue === next.dialogue ? next : { character, dialogue };
  },
});

const blankAbove = (state: EditorState, lineNumber: number) =>
  lineNumber === 1 || state.doc.line(lineNumber - 1).text.trim() === "";

// Tab : la ligne en cours devient un nom de personnage, en capitales,
// précédé d'une ligne vide.
export function playTab(state: EditorState): TransactionSpec {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const blank = blankAbove(state, line.number);
  const start = line.from + (blank ? 0 : 1);
  return {
    changes: { from: line.from, to: line.to, insert: (blank ? "" : "\n") + line.text.toLocaleUpperCase("fr") },
    selection: { anchor: start + (head - line.from) },
    effects: setPlayEntry.of({ character: start, dialogue: null }),
    userEvent: "input",
  };
}

// Une nouvelle ligne de réplique sous la ligne en cours.
function openReply(at: number): TransactionSpec {
  return {
    changes: { from: at, insert: "\n" },
    selection: { anchor: at + 1 },
    effects: setPlayEntry.of({ character: null, dialogue: at + 1 }),
    scrollIntoView: true,
    userEvent: "input",
  };
}

// Entrée, à la fin d'une ligne : après un titre d'acte ou de scène, une ligne
// vide ; après un nom ou une didascalie dans une réplique, la ligne de
// réplique ; à la fin d'une réplique, une ligne vide qui la termine. Ailleurs,
// Entrée garde son comportement ordinaire (null).
export function playEnter(state: EditorState): TransactionSpec | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  if (selection.head !== line.to) return null;
  const kind = state.field(playKinds)[line.number - 1];
  const entry = state.field(playEntry);
  const text = line.text.trim();
  const blank = blankAbove(state, line.number);
  if (kind === "act" || kind === "scene") {
    return { changes: { from: line.to, insert: "\n\n" }, selection: { anchor: line.to + 2 }, scrollIntoView: true, userEvent: "input" };
  }
  const name = text !== "" && (entry.character === line.from || (couldBeCharacter(text) && blank && kind !== "dialogue" && kind !== "cast"));
  if (name || (kind === "stage" && !blank)) return openReply(line.to);
  if (text !== "" && (kind === "dialogue" || entry.dialogue === line.from)) {
    return {
      changes: { from: line.to, insert: "\n\n" },
      selection: { anchor: line.to + 2 },
      effects: setPlayEntry.of(NO_PLAY_ENTRY),
      scrollIntoView: true,
      userEvent: "input",
    };
  }
  return null;
}

// Maj+Entrée à la fin d'une réplique : à la ligne, sans la quitter.
export function playShiftEnter(state: EditorState): TransactionSpec | null {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const line = state.doc.lineAt(selection.head);
  const kind = state.field(playKinds)[line.number - 1];
  const inReply = kind === "dialogue" || (state.field(playEntry).dialogue === line.from && line.text.trim() !== "");
  if (!inReply || selection.head !== line.to) return null;
  return openReply(line.to);
}

// Ce qu'on tape : en capitales dans un nom en cours de saisie ; « ( » sur une
// ligne vide pose les deux parenthèses ; « ) » devant la parenthèse fermante
// la franchit. Sinon, null.
export function playInput(state: EditorState, from: number, to: number, text: string): TransactionSpec | null {
  const line = state.doc.lineAt(from);
  if (state.field(playEntry).character === line.from) {
    const upper = text.toLocaleUpperCase("fr");
    if (upper === text) return null;
    return { changes: { from, to, insert: upper }, selection: { anchor: from + upper.length }, userEvent: "input.type" };
  }
  if (text === "(" && from === to && line.text.trim() === "") {
    return { changes: { from, insert: "()" }, selection: { anchor: from + 1 }, userEvent: "input.type" };
  }
  if (text === ")" && from === to && state.sliceDoc(from, from + 1) === ")" && /^\s*\(/.test(line.text)) {
    return { selection: { anchor: from + 1 } };
  }
  return null;
}

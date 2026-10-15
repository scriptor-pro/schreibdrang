import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import { NO_PLAY_ENTRY, playEnter, playEntry, playInput, playKinds, playLineKind, playShiftEnter, playTab } from "../src/theatre-saisie.ts";

function stateAt(doc: string, anchor = doc.length) {
  return EditorState.create({ doc, selection: { anchor }, extensions: [playKinds, playEntry] });
}

const apply = (state: EditorState, spec: TransactionSpec | null) => {
  assert.ok(spec, "une modification est attendue");
  return state.update(spec).state;
};

const HEAD = "# ACTE I\n\n## Scène 1\n\n";

test("Tab fait de la ligne un nom de personnage, en capitales", () => {
  const state = apply(stateAt(HEAD + "claire"), playTab(stateAt(HEAD + "claire")));
  assert.equal(state.doc.toString(), HEAD + "CLAIRE");
  assert.equal(state.field(playEntry).character, HEAD.length);
});

test("Tab sous une ligne écrite ajoute la ligne vide qui précède un nom", () => {
  const start = stateAt("## Scène 1\nclaire");
  assert.equal(apply(start, playTab(start)).doc.toString(), "## Scène 1\n\nCLAIRE");
});

test("pendant la saisie d'un nom, ce qu'on tape passe en capitales", () => {
  const named = apply(stateAt(HEAD + "cl"), playTab(stateAt(HEAD + "cl")));
  const end = named.doc.length;
  assert.equal(apply(named, playInput(named, end, end, "a")).doc.toString(), HEAD + "CLA");
});

test("Entrée après le nom ouvre la réplique", () => {
  const state = stateAt(HEAD + "CLAIRE");
  const next = apply(state, playEnter(state));
  assert.equal(next.doc.toString(), HEAD + "CLAIRE\n");
  assert.equal(next.field(playEntry).dialogue, next.doc.length);
});

test("le nom reste un nom (centré) dès Entrée, avant la première lettre de la réplique", () => {
  const state = stateAt(HEAD + "CLAIRE");
  const next = apply(state, playEnter(state));
  assert.equal(playLineKind(next, next.doc.lineAt(HEAD.length).number), "character");
});

test("Entrée ailleurs n'en fait pas un nom", () => {
  const state = stateAt(HEAD + "CLAIRE");
  const next = state.update({ changes: { from: state.doc.length, insert: "\n" } }).state;
  assert.notEqual(playLineKind(next, next.doc.lineAt(HEAD.length).number), "character");
});

test("Entrée à la fin d'une réplique la termine, par une ligne vide", () => {
  const state = stateAt(HEAD + "CLAIRE\nTu rentres tard.");
  const next = apply(state, playEnter(state));
  assert.equal(next.doc.toString(), HEAD + "CLAIRE\nTu rentres tard.\n\n");
  assert.equal(next.field(playEntry), NO_PLAY_ENTRY);
});

test("Maj+Entrée dans une réplique passe à la ligne sans la quitter", () => {
  const state = stateAt(HEAD + "CLAIRE\nTu rentres");
  assert.equal(apply(state, playShiftEnter(state)).doc.toString(), HEAD + "CLAIRE\nTu rentres\n");
});

test("Entrée après une didascalie dans une réplique reprend la réplique", () => {
  const state = stateAt(HEAD + "CLAIRE\n(Elle rit.)");
  const next = apply(state, playEnter(state));
  assert.equal(next.doc.toString(), HEAD + "CLAIRE\n(Elle rit.)\n");
  assert.equal(next.field(playEntry).dialogue, next.doc.length);
});

test("Entrée après un titre d'acte ou de scène laisse une ligne vide", () => {
  const state = stateAt("# ACTE I\n\n## Scène 1");
  assert.equal(apply(state, playEnter(state)).doc.toString(), "# ACTE I\n\n## Scène 1\n\n");
});

test("Entrée ailleurs garde son comportement ordinaire", () => {
  assert.equal(playEnter(stateAt(HEAD + "Une note.")), null);
  assert.equal(playEnter(stateAt(HEAD + "CLAIRE", HEAD.length + 2)), null);
  assert.equal(playEnter(stateAt("PERSONNAGES\n\nCLAIRE")), null);
});

test("« ( » sur une ligne vide pose les deux parenthèses, « ) » franchit la fermante", () => {
  const state = stateAt(HEAD);
  const opened = apply(state, playInput(state, HEAD.length, HEAD.length, "("));
  assert.equal(opened.doc.toString(), HEAD + "()");
  assert.equal(opened.selection.main.head, HEAD.length + 1);
  const typed = opened.update({ changes: { from: HEAD.length + 1, insert: "Elle rit." }, selection: { anchor: HEAD.length + 10 } }).state;
  const closed = apply(typed, playInput(typed, HEAD.length + 10, HEAD.length + 10, ")"));
  assert.equal(closed.doc.toString(), HEAD + "(Elle rit.)");
  assert.equal(closed.selection.main.head, closed.doc.length);
  assert.equal(playInput(stateAt(HEAD + "Oui"), HEAD.length + 3, HEAD.length + 3, "("), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { correctionField, nextRemark, openBubble, remarkAt, setRemarks } from "../src/correction/etat.ts";
import type { Remark } from "../src/correction/remarques.ts";

const DOC = "Un deux.\n\nTrois quatre.";

function remark(word: string, passage: string, key = word): Remark {
  const from = DOC.indexOf(word);
  const start = DOC.indexOf(passage);
  return {
    from,
    to: from + word.length,
    kind: "grammaire",
    message: "",
    suggestions: [],
    rule: "r",
    label: "",
    excerpt: word,
    key,
    passage: { from: start, to: start + passage.length },
  };
}

const DEUX = remark("deux", "Un deux.");
const QUATRE = remark("quatre", "Trois quatre.");

function stateWith(remarks: Remark[]) {
  return EditorState.create({ doc: DOC, extensions: [correctionField] }).update({ effects: setRemarks.of(remarks) }).state;
}

const words = (state: EditorState) => state.field(correctionField).remarks.map((r) => state.sliceDoc(r.from, r.to));

test("les remarques suivent le texte écrit entre deux paragraphes", () => {
  const state = stateWith([DEUX, QUATRE]).update({ changes: { from: 9, insert: "Oh.\n\n" } }).state;
  assert.deepEqual(words(state), ["deux", "quatre"]);
});

test("modifier un paragraphe efface ses remarques, pas celles des autres", () => {
  const state = stateWith([DEUX, QUATRE]).update({ changes: { from: DOC.indexOf("Trois") + 2, insert: "x" } }).state;
  assert.deepEqual(words(state), ["deux"]);
});

test("écrire au bout d'un paragraphe le modifie", () => {
  const state = stateWith([DEUX, QUATRE]).update({ changes: { from: DOC.length, insert: " Fin." } }).state;
  assert.deepEqual(words(state), ["deux"]);
});

test("la bulle se ferme quand le curseur part, quand le texte change, quand sa remarque disparaît", () => {
  let state = stateWith([DEUX, QUATRE]).update({ effects: openBubble.of(QUATRE) }).state;
  assert.equal(state.field(correctionField).bubble, QUATRE);
  assert.equal(state.update({ selection: { anchor: 0 } }).state.field(correctionField).bubble, null);
  assert.equal(state.update({ changes: { from: 0, insert: "A" } }).state.field(correctionField).bubble, null);
  assert.equal(state.update({ effects: setRemarks.of([DEUX]) }).state.field(correctionField).bubble, null);
  // Les mêmes remarques redessinées gardent la bulle ouverte, telle quelle.
  state = state.update({ effects: setRemarks.of([{ ...DEUX }, { ...QUATRE }]) }).state;
  assert.equal(state.field(correctionField).bubble, QUATRE);
});

test("ouvrir une remarque en y amenant le curseur garde la bulle ouverte", () => {
  const state = stateWith([DEUX, QUATRE]).update({ selection: { anchor: QUATRE.from }, effects: openBubble.of(QUATRE) }).state;
  assert.equal(state.field(correctionField).bubble, QUATRE);
});

test("remarque suivante et précédente, en revenant au début ou à la fin", () => {
  const remarks = [DEUX, QUATRE];
  assert.equal(nextRemark(remarks, 0, 1), DEUX);
  assert.equal(nextRemark(remarks, DEUX.from, 1), QUATRE);
  assert.equal(nextRemark(remarks, QUATRE.from, 1), DEUX);
  assert.equal(nextRemark(remarks, QUATRE.from, -1), DEUX);
  assert.equal(nextRemark(remarks, DEUX.from, -1), QUATRE);
  assert.equal(nextRemark([], 0, 1), undefined);
});

test("la remarque sous le curseur, jamais une remarque vide", () => {
  const empty = { ...DEUX, to: DEUX.from };
  assert.equal(remarkAt([DEUX, QUATRE], QUATRE.from + 2), QUATRE);
  assert.equal(remarkAt([DEUX, QUATRE], 8), undefined);
  assert.equal(remarkAt([empty], DEUX.from), undefined);
});

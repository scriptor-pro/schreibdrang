import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { EDGE_GAP, MARGIN_GAP, marginBox, marginProposal, setMarginProposal } from "../src/fiches-marge.ts";

const REM = 16;

test("marge large : l'invitation fait 16 rem, calée contre le texte", () => {
  const box = marginBox(400, REM);
  assert.deepEqual(box, { left: 400 - MARGIN_GAP - 256, width: 256 });
});

test("marge moyenne : l'invitation prend la place qui reste entre les deux écarts", () => {
  const room = 12 * REM + MARGIN_GAP + EDGE_GAP + 10;
  assert.deepEqual(marginBox(room, REM), { left: EDGE_GAP, width: 12 * REM + 10 });
});

test("fenêtre de 1 100 pixels : le texte commence à 256 pixels, l'invitation y tient", () => {
  assert.notEqual(marginBox(218 + 38, REM), null);
});

test("marge trop étroite : pas de place, l'invitation va au pied de page", () => {
  assert.equal(marginBox(12 * REM + MARGIN_GAP + EDGE_GAP - 1, REM), null);
  assert.equal(marginBox(0, REM), null);
});

function withProposal(doc: string, pos: number) {
  const state = EditorState.create({ doc, extensions: [marginProposal] });
  const proposal = { id: 1, pos, text: "“Lucien” ressemble à un personnage.", actions: [] };
  return state.update({ effects: setMarginProposal.of(proposal) }).state;
}

test("l'invitation suit le nom quand on écrit avant lui", () => {
  const state = withProposal("Il vit Lucien.", 7);
  const next = state.update({ changes: { from: 0, insert: "Hier, " } }).state;
  assert.equal(next.field(marginProposal)?.pos, 13);
});

test("écrire après le nom ne la déplace pas", () => {
  const state = withProposal("Il vit Lucien.", 7);
  const before = state.field(marginProposal);
  const next = state.update({ changes: { from: 14, insert: " Il pleuvait." } }).state;
  assert.equal(next.field(marginProposal), before);
});

test("effacer l'invitation", () => {
  const state = withProposal("Il vit Lucien.", 7);
  assert.equal(state.update({ effects: setMarginProposal.of(null) }).state.field(marginProposal), null);
});

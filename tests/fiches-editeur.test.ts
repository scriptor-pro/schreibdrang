import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import type { CompletionResult } from "@codemirror/autocomplete";
import { emptySheet } from "../src/fiches.ts";
import type { Format } from "../src/recents.ts";
import { castRewrite, nameSource, protection } from "../src/fiches-editeur.ts";
import type { PeopleHost } from "../src/fiches-editeur.ts";

const marie = { ...emptySheet("m", 1), firstName: "Marie" };
const gaston = { ...emptySheet("g", 2), nickname: "le père Gaston" };

function host(options: Partial<{ format: Format; completion: boolean; range: { from: number; to: number } }> = {}) {
  const refused: number[] = [];
  const h: PeopleHost = {
    sheets: () => [marie, gaston],
    format: () => options.format ?? "roman",
    enabled: () => (options.format ?? "roman") !== "vanilla",
    completion: () => options.completion ?? true,
    open: () => {},
    typedWord: () => {},
    protectedRange: () => options.range,
    refused: () => refused.push(1),
  };
  return { h, refused };
}

function complete(doc: string, h: PeopleHost): CompletionResult | null {
  const state = EditorState.create({ doc, selection: { anchor: doc.length } });
  return nameSource(h)(new CompletionContext(state, doc.length, false)) as CompletionResult | null;
}

test("les noms sont proposés après deux lettres", () => {
  const result = complete("Il vit Ma", host().h)!;
  assert.equal(result.from, 7);
  assert.deepEqual(result.options.map((o) => o.label), ["Marie"]);
  assert.equal(complete("Il vit M", host().h), null);
});

test("un surnom de plusieurs mots est proposé", () => {
  const result = complete("Bonjour le p", host().h)!;
  assert.equal(result.from, 8);
  assert.deepEqual(result.options.map((o) => o.label), ["le père Gaston"]);
});

test("rien n'est proposé si le réglage est décoché ou au format page blanche", () => {
  assert.equal(complete("Il vit Ma", host({ completion: false }).h), null);
  assert.equal(complete("Il vit Ma", host({ format: "vanilla" }).h), null);
});

test("sur une ligne de nom, au théâtre, le nom est inséré en capitales", () => {
  const result = complete("Il sort.\n\nMA", host({ format: "theatre" }).h)!;
  assert.equal(result.options[0].apply, "MARIE");
  const prose = complete("Il voit Ma", host({ format: "theatre" }).h)!;
  assert.equal(prose.options[0].apply, "Marie");
});

test("la liste tenue par l'app est protégée", () => {
  const { h, refused } = host({ range: { from: 0, to: 10 } });
  const state = EditorState.create({ doc: "PERSONNAGES\n\nCLAIRE\n", extensions: protection(h) });
  assert.equal(state.update({ changes: { from: 5, insert: "x" } }).state.doc.toString(), "PERSONNAGES\n\nCLAIRE\n");
  assert.equal(refused.length, 1);
  assert.equal(state.update({ changes: { from: 15, insert: "x" } }).state.doc.toString(), "PERSONNAGES\n\nCLxAIRE\n");
  const rewrite = state.update({ changes: { from: 0, to: 11, insert: "LISTE" }, annotations: castRewrite.of(true) });
  assert.equal(rewrite.state.doc.toString(), "LISTE\n\nCLAIRE\n");
  // Ctrl+Z annule une réécriture de la liste.
  const undo = state.update({ changes: { from: 0, to: 11, insert: "LISTE" }, userEvent: "undo" });
  assert.equal(undo.state.doc.toString(), "LISTE\n\nCLAIRE\n");
});

test("une réécriture de tout le texte qui garde la liste intacte passe (cork board)", () => {
  const doc = "PERSONNAGES\n\nCLAIRE\n\n# ACTE I\n\n## Scène 1\n\n## Scène 2\n";
  const { h, refused } = host({ range: { from: 0, to: 19 } });
  const state = EditorState.create({ doc, extensions: protection(h) });
  const moved = "PERSONNAGES\n\nCLAIRE\n\n# ACTE I\n\n## Scène 2\n\n## Scène 1\n";
  assert.equal(state.update({ changes: { from: 0, to: doc.length, insert: moved } }).state.doc.toString(), moved);
  assert.equal(refused.length, 0);
});

test("écrire au bord de la liste tenue est refusé", () => {
  const doc = "PERSONNAGES\n\nCLAIRE\n\n# ACTE I\n";
  const { h, refused } = host({ range: { from: 0, to: 19 } });
  const state = EditorState.create({ doc, extensions: protection(h) });
  assert.equal(state.update({ changes: { from: 19, insert: " et" } }).state.doc.toString(), doc);
  assert.equal(state.update({ changes: { from: 0, insert: "X" } }).state.doc.toString(), doc);
  assert.equal(refused.length, 2);
  // Juste après la ligne, sur la ligne vide, on écrit librement.
  assert.equal(state.update({ changes: { from: 20, insert: "Note." } }).state.doc.toString(), "PERSONNAGES\n\nCLAIRE\nNote.\n# ACTE I\n");
});

test("un nom déjà tapé en entier n'est plus proposé (Tab garde son rôle)", () => {
  assert.equal(complete("Il sort.\n\nMARIE", host({ format: "theatre" }).h), null);
  assert.equal(complete("Il voit Marie", host().h), null);
  const mathieu = { ...emptySheet("t", 3), firstName: "Mariette" };
  const h: PeopleHost = { ...host().h, sheets: () => [marie, mathieu] };
  assert.deepEqual(complete("Il voit Marie", h)!.options.map((o) => o.label), ["Mariette"]);
});

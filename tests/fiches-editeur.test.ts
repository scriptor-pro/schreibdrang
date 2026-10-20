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

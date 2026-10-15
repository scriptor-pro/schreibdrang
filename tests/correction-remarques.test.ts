import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPassages } from "../src/correction/extraction.ts";
import { SPELLING_RULE, kindOf, remarkKey, remarksOf, wordAcceptor } from "../src/correction/remarques.ts";
import type { EngineReply, RemarkFilter } from "../src/correction/remarques.ts";

const ALL: RemarkFilter = {
  kinds: { grammaire: true, orthographe: true, typographie: true },
  ignoredRules: new Set(),
  ignoredRemarks: new Set(),
  accepts: () => false,
};

const REPLY: EngineReply = {
  grammar: [
    { start: 4, end: 10, type: "gn", rule: "gn1", message: "Accord de nombre erroné.", suggestions: ["maisons"] },
    { start: 16, end: 22, type: "ppas", rule: "ppas1", message: "Accord erroné.", suggestions: ["grandes"] },
    { start: 23, end: 25, type: "apos", rule: "apostrophe_typographique", message: "Apostrophe typographique.", suggestions: ["l’"] },
  ],
  spelling: [{ start: 32, end: 41, word: "flurmibon" }],
};
const DOC = "Avant.\n\nLes maison sont *grande* l'été du flurmibon.";
const PASSAGE = extractPassages(DOC, "roman")[1];

test("chaque remarque reçoit sa sorte et sa place dans le document", () => {
  assert.equal(PASSAGE.text, "Les maison sont grande l'été du flurmibon.");
  const remarks = remarksOf(PASSAGE, REPLY, ALL);
  assert.deepEqual(remarks.map((r) => [r.kind, DOC.slice(r.from, r.to)]), [
    ["grammaire", "maison"],
    ["grammaire", "grande"],
    ["typographie", "l'"],
    ["orthographe", "flurmibon"],
  ]);
  assert.deepEqual(remarks[0].suggestions, ["maisons"]);
  assert.equal(remarks[0].excerpt, "maison");
  assert.equal(remarks[3].rule, SPELLING_RULE);
  assert.deepEqual(remarks[3].suggestions, []);
  assert.deepEqual(remarks[0].passage, { from: PASSAGE.from, to: PASSAGE.to });
});

test("les options du groupe Typographie de Grammalecte sont de la typographie, le reste de la grammaire", () => {
  for (const type of ["typo", "apos", "esp", "nbsp", "maj", "virg", "tu", "num"]) assert.equal(kindOf(type), "typographie");
  for (const type of ["gn", "ppas", "conj", "conf", "inconnu"]) assert.equal(kindOf(type), "grammaire");
});

test("une sorte décochée n'est pas montrée", () => {
  const filter = { ...ALL, kinds: { grammaire: true, orthographe: false, typographie: false } };
  assert.deepEqual(remarksOf(PASSAGE, REPLY, filter).map((r) => r.excerpt), ["maison", "grande"]);
});

test("une règle ignorée et une remarque ignorée ne sont pas montrées", () => {
  const key = remarkKey("gn1", PASSAGE.text, 4, 10);
  const filter = { ...ALL, ignoredRules: new Set(["apostrophe_typographique"]), ignoredRemarks: new Set([key]) };
  assert.deepEqual(remarksOf(PASSAGE, REPLY, filter).map((r) => r.excerpt), ["grande", "flurmibon"]);
});

test("une remarque ignorée le reste quand le paragraphe change loin d'elle", () => {
  const before = "Les maison sont grandes, dit-il.";
  const after = "Les maison sont grandes, dit-il en riant très fort ce soir-là.";
  assert.equal(remarkKey("gn1", before, 4, 10), remarkKey("gn1", after, 4, 10));
  assert.notEqual(remarkKey("gn1", before, 4, 10), remarkKey("gn1", "Nos maison sont grandes, dit-il.", 4, 10));
});

test("un mot accepté par un dictionnaire n'est pas signalé", () => {
  const filter = { ...ALL, accepts: wordAcceptor(["Flurmibon"]) };
  assert.deepEqual(remarksOf(PASSAGE, REPLY, filter).map((r) => r.excerpt), ["maison", "grande", "l'"]);
});

test("les dictionnaires ignorent la casse et la forme de l'apostrophe", () => {
  const accepts = wordAcceptor(["aujourd’hui"], new Set(["ÉLISE"]));
  assert.ok(accepts("aujourd'hui"));
  assert.ok(accepts("Aujourd’hui"));
  assert.ok(accepts("Élise"));
  assert.ok(!accepts("Marc"));
});

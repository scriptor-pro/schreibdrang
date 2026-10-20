import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySheet } from "../src/fiches.ts";
import { completionsFor, findNames, hitAt, startsWithArticleOrTitle, wordsMatch } from "../src/fiches-noms.ts";

const marie = { ...emptySheet("m", 1), firstName: "Marie", lastName: "Delcourt" };
const gaston = { ...emptySheet("g", 2), nickname: "le père Gaston" };
const elise = { ...emptySheet("e", 3), firstName: "Élise" };
const sheets = [marie, gaston, elise];
const names = (text: string) => findNames(text, sheets).map((h) => text.slice(h.from, h.to));

test("règle de reconnaissance", () => {
  assert.deepEqual(names("Marie et MARIE, mais pas marie ni Mariette."), ["Marie", "MARIE"]);
  assert.deepEqual(names("ELISE rit. Elise non."), ["ELISE"]);
  assert.deepEqual(names("Le père Gaston dort ; le père de Marie aussi."), ["Le père Gaston", "Marie"]);
  assert.deepEqual(names("d'Antoine, (Marie) Delcourt"), ["Marie", "Delcourt"]);
  assert.deepEqual(names("Marie Delcourt"), ["Marie", "Delcourt"]);
  assert.deepEqual(names("Marie"), ["Marie"]);
});

test("un mot correspond à un nom", () => {
  assert.equal(wordsMatch("Marie", "Marie"), true);
  assert.equal(wordsMatch("Le", "le"), true);
  assert.equal(wordsMatch("ÉLISE", "Élise"), true);
  assert.equal(wordsMatch("ELISE", "Élise"), true);
  assert.equal(wordsMatch("Elise", "Élise"), false);
  assert.equal(wordsMatch("marie", "Marie"), false);
});

test("un nom avec article ou titre n'est reconnu qu'en entier", () => {
  const ferrand = { ...emptySheet("f", 1), nickname: "Madame Ferrand" };
  assert.deepEqual(findNames("Madame dort. Madame Ferrand aussi. Ferrand", [ferrand]).length, 1);
});

test("deux fiches pour un même nom", () => {
  const autre = { ...emptySheet("m2", 4), firstName: "Marie" };
  assert.deepEqual(findNames("Marie", [marie, autre])[0].ids, ["m", "m2"]);
});

test("décalage d'un passage", () => {
  assert.deepEqual(findNames("Marie", sheets, 10)[0], { from: 10, to: 15, ids: ["m"] });
});

test("nom sous le curseur", () => {
  const hits = findNames("Il voit Marie.", sheets);
  assert.equal(hitAt(hits, 8)?.ids[0], "m");
  assert.equal(hitAt(hits, 13)?.ids[0], "m");
  assert.equal(hitAt(hits, 3), undefined);
});

test("article ou titre", () => {
  assert.equal(startsWithArticleOrTitle("Madame Ferrand"), true);
  assert.equal(startsWithArticleOrTitle("Deux gardes"), true);
  assert.equal(startsWithArticleOrTitle("3 brigands"), true);
  assert.equal(startsWithArticleOrTitle("Antoine Delorme"), false);
});

test("autocomplétion", () => {
  assert.deepEqual(completionsFor("el", sheets).map((c) => c.label), ["Élise"]);
  assert.deepEqual(completionsFor("DE", sheets).map((c) => c.label), ["Delcourt"]);
  assert.deepEqual(completionsFor("M", sheets), []);
  assert.deepEqual(completionsFor("le p", sheets).map((c) => c.label), ["le père Gaston"]);
  const autre = { ...emptySheet("m2", 4), firstName: "Marie" };
  assert.deepEqual(completionsFor("ma", [marie, autre]), [{ label: "Marie", ids: ["m", "m2"] }]);
});

test("rapide sur un roman entier", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ ...emptySheet(`s${i}`, i), firstName: `Prenom${i}` }));
  const text = "Il était une fois Prenom7 et Prenom31 dans la forêt. ".repeat(10_000);
  const start = performance.now();
  const hits = findNames(text, many);
  assert.equal(hits.length, 20_000);
  assert.ok(performance.now() - start < 200);
});

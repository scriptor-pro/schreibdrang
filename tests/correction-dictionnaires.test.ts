import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyTextData,
  knownTextData,
  normalizePersonal,
  normalizeTextsData,
  withItem,
  withoutItem,
  withRule,
  withoutRule,
  withTextData,
} from "../src/correction/dictionnaires.ts";

test("un mot ajouté prend sa place dans l'ordre alphabétique, sans doublon", () => {
  let words = withItem([], "zèbre");
  words = withItem(words, "âne");
  words = withItem(words, "école");
  words = withItem(words, "école");
  assert.deepEqual(words, ["âne", "école", "zèbre"]);
  assert.deepEqual(withoutItem(words, "école"), ["âne", "zèbre"]);
});

test("une règle ignorée l'est une seule fois, et se rétablit", () => {
  let rules = withRule([], { rule: "apostrophe_typographique", label: "Apostrophe typographique." });
  rules = withRule(rules, { rule: "apostrophe_typographique", label: "Autre libellé" });
  assert.deepEqual(rules, [{ rule: "apostrophe_typographique", label: "Apostrophe typographique." }]);
  assert.deepEqual(withoutRule(rules, "apostrophe_typographique"), []);
});

test("des données personnelles illisibles donnent des listes vides, une entrée invalide est écartée", () => {
  assert.deepEqual(normalizePersonal(null), { words: [], rules: [] });
  assert.deepEqual(normalizePersonal({ words: ["Élise", 3, "", "Élise"], rules: [{ rule: "r", label: "R" }, { rule: 1 }, "x"] }), {
    words: ["Élise"],
    rules: [{ rule: "r", label: "R" }],
  });
});

test("les données de chaque texte sont retenues par son chemin", () => {
  let texts = withTextData({}, "/textes/recit.md", { words: ["Kroszwinsky"], ignored: ["clé"] });
  assert.deepEqual(knownTextData(texts, "/textes/recit.md"), { words: ["Kroszwinsky"], ignored: ["clé"] });
  assert.deepEqual(knownTextData(texts, "/textes/autre.md"), emptyTextData());
  assert.deepEqual(knownTextData({}, "constructor"), emptyTextData());
  texts = withTextData(texts, "/textes/recit.md", emptyTextData());
  assert.deepEqual(knownTextData(texts, "/textes/recit.md"), emptyTextData());
});

test("des données de textes illisibles donnent une liste vide, une entrée invalide est écartée", () => {
  assert.deepEqual(normalizeTextsData("x"), {});
  assert.deepEqual(normalizeTextsData({ "/a.md": { words: ["mot", 2], ignored: "non" }, "/b.md": 3, "": { words: [] } }), {
    "/a.md": { words: ["mot"], ignored: [] },
  });
});

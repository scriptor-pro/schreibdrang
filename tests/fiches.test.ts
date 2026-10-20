import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayName,
  emptySheet,
  emptySheetsFile,
  isFullSheet,
  isValidSheet,
  normalizeSheetsFile,
  serializeSheets,
  sheetNames,
  sidecarPath,
} from "../src/fiches.ts";

test("le fichier voisin porte le nom du texte", () => {
  assert.equal(sidecarPath("/a/mon-roman.md"), "/a/mon-roman.fiches.json");
  assert.equal(sidecarPath("C:\\a\\film.fountain"), "C:\\a\\film.fiches.json");
  assert.equal(sidecarPath("/a/notes.txt"), "/a/notes.fiches.json");
  assert.equal(sidecarPath("/a/sans-extension"), "/a/sans-extension.fiches.json");
  assert.equal(sidecarPath("/a.b/texte"), "/a.b/texte.fiches.json");
});

test("une fiche a au moins un prénom, un nom ou un surnom", () => {
  const s = emptySheet("x", 1);
  assert.equal(isValidSheet(s), false);
  assert.equal(isValidSheet({ ...s, nickname: "  la Grande " }), true);
  assert.deepEqual(sheetNames({ ...s, firstName: "Marie", nickname: " la Grande " }), ["Marie", "la Grande"]);
});

test("nom affiché", () => {
  const s = emptySheet("x", 1);
  assert.equal(displayName({ ...s, firstName: "Antoine", lastName: "Delorme" }), "Antoine Delorme");
  assert.equal(displayName({ ...s, lastName: "Delorme" }), "Delorme");
  assert.equal(displayName({ ...s, nickname: "Madame Ferrand" }), "Madame Ferrand");
});

test("lecture du fichier", () => {
  const file = { ...emptySheetsFile(), personnages: [{ ...emptySheet("a", 1), firstName: "Marie" }, emptySheet("b", 2)] };
  const read = normalizeSheetsFile(serializeSheets(file))!;
  assert.deepEqual(read.personnages.map((s) => s.id), ["a"]);
  assert.equal(normalizeSheetsFile("{"), undefined);
  assert.equal(normalizeSheetsFile('{"version":2,"personnages":[]}'), undefined);
  const partial = normalizeSheetsFile('{"version":1,"personnages":[{"id":"c","firstName":"Léa","importance":"héros"}]}')!;
  assert.equal(partial.personnages[0].importance, "");
  assert.equal(partial.personnages[0].notes, "");
  assert.equal(partial.listeTenue, null);
});

test("relations et champs personnalisés mal formés sont écartés", () => {
  const raw = JSON.stringify({
    version: 1,
    personnages: [{ id: "a", firstName: "Léa", relations: [{ to: "b", nature: "sœur" }, { nature: "x" }, 3], custom: [{ label: "Signe", value: "Lion" }, null] }],
    ecartes: ["Lyon", 4],
    listeTenue: true,
  });
  const read = normalizeSheetsFile(raw)!;
  assert.deepEqual(read.personnages[0].relations, [{ to: "b", nature: "sœur" }]);
  assert.deepEqual(read.personnages[0].custom, [{ label: "Signe", value: "Lion" }]);
  assert.deepEqual(read.ecartes, ["Lyon"]);
  assert.equal(read.listeTenue, true);
});

test("un figurant a une fiche réduite", () => {
  assert.equal(isFullSheet({ ...emptySheet("x", 1), importance: "figurant" }), false);
  assert.equal(isFullSheet(emptySheet("x", 1)), true);
});

test("une fiche dont on a effacé les noms n'est pas perdue à la relecture", () => {
  const file = { ...emptySheetsFile(), personnages: [{ ...emptySheet("a", 1), notes: "Elle ment toujours." }] };
  const read = normalizeSheetsFile(serializeSheets(file))!;
  assert.equal(read.personnages.length, 1);
  assert.equal(read.personnages[0].nickname, "Personnage sans nom");
  assert.equal(read.personnages[0].notes, "Elle ment toujours.");
});

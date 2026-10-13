import assert from "node:assert/strict";
import { test } from "node:test";
import { fileKind, importedName, knownFormat, normalizeTexts, withFormat, withRecents } from "../src/textes.ts";

test("un fichier .fountain est toujours un scénario, quoi que l'app ait retenu", () => {
  assert.equal(knownFormat({}, "/textes/film.fountain"), "scenario");
  assert.equal(knownFormat({ "/textes/film.FOUNTAIN": "roman" }, "/textes/film.FOUNTAIN"), "scenario");
});

test("un fichier .md ou .txt sans format retenu est inconnu", () => {
  assert.equal(knownFormat({}, "/textes/recit.md"), undefined);
  assert.equal(knownFormat({ "/textes/autre.md": "roman" }, "/textes/recit.txt"), undefined);
});

test("le format retenu pour un fichier est rendu tel quel, et se remplace", () => {
  let texts = withFormat({}, "/textes/recit.md", "nouvelle");
  texts = withFormat(texts, "/textes/libre.txt", "vanilla");
  assert.equal(knownFormat(texts, "/textes/recit.md"), "nouvelle");
  assert.equal(knownFormat(texts, "/textes/libre.txt"), "vanilla");
  texts = withFormat(texts, "/textes/recit.md", "roman");
  assert.equal(knownFormat(texts, "/textes/recit.md"), "roman");
});

test("des données illisibles donnent une liste vide, une entrée invalide est écartée", () => {
  assert.deepEqual(normalizeTexts(null), {});
  assert.deepEqual(normalizeTexts("x"), {});
  assert.deepEqual(normalizeTexts({ "/a.md": "nouvelle", "/b.md": "poème", "/c.md": 3, "": "roman" }), { "/a.md": "nouvelle" });
});

test("les formats retenus avec les textes récents sont repris, sans écraser un format déjà retenu", () => {
  const recents = [
    { path: "/a.md", date: "2026-10-01T00:00:00.000Z", format: "vanilla" as const },
    { path: "/b.md", date: "2026-10-02T00:00:00.000Z", format: "roman" as const },
  ];
  assert.deepEqual(withRecents({ "/b.md": "nouvelle" }, recents), { "/b.md": "nouvelle", "/a.md": "vanilla" });
});

test("un fichier est un scénario Fountain, un texte, ou un document à importer", () => {
  assert.equal(fileKind("/x/film.fountain"), "fountain");
  assert.equal(fileKind("/x/recit.md"), "texte");
  assert.equal(fileKind("/x/recit.TXT"), "texte");
  assert.equal(fileKind("/x/roman.docx"), "import");
  assert.equal(fileKind("C:\\x\\roman.ODT"), "import");
});

test("un document importé propose son nom, sans son extension, pour l'enregistrement", () => {
  assert.equal(importedName("/x/Mon roman.docx"), "Mon roman");
  assert.equal(importedName("C:\\x\\nouvelle.v2.odt"), "nouvelle.v2");
});

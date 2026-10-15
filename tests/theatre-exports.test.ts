import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PLAY_EXPORT, knownPlayExport, normalizePlayExports, withPlayExport } from "../src/theatre-exports.ts";

test("par défaut, le manuscrit et l'A4", () => {
  assert.deepEqual(DEFAULT_PLAY_EXPORT, { layout: "manuscrit", page: "a4" });
  assert.deepEqual(knownPlayExport({}, "/piece.md"), DEFAULT_PLAY_EXPORT);
  assert.deepEqual(knownPlayExport({}, undefined), DEFAULT_PLAY_EXPORT);
  assert.deepEqual(knownPlayExport({}, "constructor"), DEFAULT_PLAY_EXPORT);
});

test("le dernier choix est retenu pour chaque fichier", () => {
  const exports = withPlayExport({}, "/piece.md", { layout: "edition", page: "a5" });
  assert.deepEqual(knownPlayExport(exports, "/piece.md"), { layout: "edition", page: "a5" });
  assert.deepEqual(knownPlayExport(exports, "/autre.md"), DEFAULT_PLAY_EXPORT);
});

test("des données illisibles donnent une liste vide, une entrée invalide est écartée", () => {
  assert.deepEqual(normalizePlayExports("x"), {});
  assert.deepEqual(
    normalizePlayExports({ "/a.md": { layout: "edition", page: "a5" }, "/b.md": { layout: "poster", page: "a4" }, "/c.md": { layout: "manuscrit", page: "a3" }, "": {} }),
    { "/a.md": { layout: "edition", page: "a5" } },
  );
});

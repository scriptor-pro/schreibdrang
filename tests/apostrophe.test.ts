import assert from "node:assert/strict";
import { test } from "node:test";
import { typographicApostrophes } from "../src/apostrophe.ts";

test("l'apostrophe droite tapée devient l'apostrophe typographique", () => {
  assert.equal(typographicApostrophes("'"), "’");
  assert.equal(typographicApostrophes("l'heure d'été"), "l’heure d’été");
});

test("le reste de la saisie ne change pas", () => {
  assert.equal(typographicApostrophes("a"), "a");
  assert.equal(typographicApostrophes("« Oui » \"non\" ’"), "« Oui » \"non\" ’");
});

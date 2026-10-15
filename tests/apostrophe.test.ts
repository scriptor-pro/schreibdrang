import assert from "node:assert/strict";
import { test } from "node:test";
import { apostropheChanges, apostrophesMessage, typographicApostrophes } from "../src/apostrophe.ts";

test("l'apostrophe droite tapée devient l'apostrophe typographique", () => {
  assert.equal(typographicApostrophes("'"), "’");
  assert.equal(typographicApostrophes("l'heure d'été"), "l’heure d’été");
});

test("le reste de la saisie ne change pas", () => {
  assert.equal(typographicApostrophes("a"), "a");
  assert.equal(typographicApostrophes("« Oui » \"non\" ’"), "« Oui » \"non\" ’");
});

test("toutes les apostrophes droites du texte sont trouvées, et elles seules", () => {
  const changes = apostropheChanges("L'été, d’abord ; puis l'hiver.");
  assert.deepEqual(changes, [
    { from: 1, to: 2, insert: "’" },
    { from: 23, to: 24, insert: "’" },
  ]);
  assert.deepEqual(apostropheChanges("Rien à changer, l’été."), []);
});

test("le message dit combien d'apostrophes ont été remplacées", () => {
  assert.equal(apostrophesMessage(0), "Aucune apostrophe droite dans le texte.");
  assert.equal(apostrophesMessage(1), "1 apostrophe remplacée par l’apostrophe typographique.");
  assert.equal(apostrophesMessage(1359), "1\u202f359 apostrophes remplacées par l’apostrophe typographique.");
});

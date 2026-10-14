import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETUP, formatDecimal, knownSetup, normalizeSetup, normalizeSetups, parseDecimal, setupMessage, sheetStyle, withSetup } from "../src/miseenpage.ts";

test("un nombre se saisit avec une virgule ou un point", () => {
  assert.equal(parseDecimal("1,5"), 1.5);
  assert.equal(parseDecimal(" 2.25 "), 2.25);
  assert.equal(parseDecimal("3"), 3);
  assert.ok(Number.isNaN(parseDecimal("")));
  assert.ok(Number.isNaN(parseDecimal("deux")));
  assert.ok(Number.isNaN(parseDecimal("1,5 cm")));
  assert.equal(formatDecimal(1.5), "1,5");
  assert.equal(formatDecimal(2), "2");
});

test("par défaut : interligne de 1,5 et quatre marges de 2,5 cm", () => {
  assert.deepEqual(DEFAULT_SETUP, { spacing: 1.5, top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 });
  assert.deepEqual(normalizeSetup(null), DEFAULT_SETUP);
  assert.deepEqual(normalizeSetup("texte"), DEFAULT_SETUP);
});

test("une valeur est arrondie au dixième ; hors limites ou illisible, elle revient à la valeur par défaut", () => {
  assert.deepEqual(normalizeSetup({ spacing: "2", top: "0", bottom: "7", left: "3,14", right: 1.26 }), { spacing: 2, top: 0, bottom: 7, left: 3.1, right: 1.3 });
  // Interligne de 1 à 3, marges de 0 à 7 cm.
  assert.deepEqual(normalizeSetup({ spacing: 0.9, top: -1, bottom: 7.1, left: "abc", right: "" }), DEFAULT_SETUP);
  assert.equal(normalizeSetup({ spacing: 3.1 }).spacing, 1.5);
  assert.equal(normalizeSetup({ spacing: 1 }).spacing, 1);
  assert.equal(normalizeSetup({ spacing: 3 }).spacing, 3);
});

test("la mise en page retenue pour un fichier est rendue telle quelle ; un fichier inconnu a celle par défaut", () => {
  const setup = { spacing: 2, top: 1, bottom: 1, left: 3, right: 2 };
  const setups = withSetup({}, "/textes/libre.md", setup);
  assert.deepEqual(knownSetup(setups, "/textes/libre.md"), setup);
  assert.deepEqual(knownSetup(setups, "/textes/autre.md"), DEFAULT_SETUP);
  assert.deepEqual(knownSetup(setups, "constructor"), DEFAULT_SETUP);
});

test("des mises en page illisibles donnent une liste vide, une mise en page invalide est ramenée aux valeurs par défaut", () => {
  assert.deepEqual(normalizeSetups(null), {});
  assert.deepEqual(normalizeSetups([1, 2]), {});
  assert.deepEqual(normalizeSetups({ "/a.md": { spacing: 2, top: 1, bottom: 1, left: 1, right: 1 }, "/b.md": "?" }), {
    "/a.md": { spacing: 2, top: 1, bottom: 1, left: 1, right: 1 },
    "/b.md": DEFAULT_SETUP,
  });
});

test("le message dit si une saisie a été ramenée à sa valeur par défaut", () => {
  const typed = { spacing: "2", top: "1,5", bottom: "2.5", left: "3", right: "3" };
  assert.equal(setupMessage(typed), "Mise en page appliquée.");
  assert.equal(setupMessage({ ...typed, spacing: "5" }), "Mise en page appliquée, sauf une valeur hors limites, remise par défaut.");
  assert.equal(setupMessage({ ...typed, left: "" }), "Mise en page appliquée, sauf une valeur hors limites, remise par défaut.");
  // Une saisie arrondie au dixième n'est pas une erreur.
  assert.equal(setupMessage({ ...typed, left: "3,14" }), "Mise en page appliquée.");
});

test("à l'écran, la feuille fait 21 cm de large pour un texte en corps 12, et rétrécit avec la fenêtre", () => {
  const style = sheetStyle({ spacing: 2, top: 1, bottom: 4, left: 2.1, right: 4.2 });
  assert.equal(style.lineHeight, "2");
  // 21 cm font 595,28 points, soit 49,606 fois le corps du texte.
  assert.equal(style.maxWidth, "49.606em");
  assert.equal(style.paddingTop, "2.362em");
  // Une marge de 2,1 cm est le dixième de la largeur de la feuille.
  assert.equal(style.paddingLeft, "min(4.961em, 10%)");
  assert.equal(style.paddingRight, "min(9.921em, 20%)");
});

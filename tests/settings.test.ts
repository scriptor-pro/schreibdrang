import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, normalizeSettings } from "../src/settings.ts";

test("des données absentes ou illisibles donnent les valeurs par défaut", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULTS);
  assert.deepEqual(normalizeSettings("n'importe quoi"), DEFAULTS);
  assert.deepEqual(normalizeSettings([1, 2]), DEFAULTS);
});

test("des réglages valides sont conservés", () => {
  const settings = {
    theme: "sombre",
    font: "DejaVu Sans Mono",
    size: 20,
    startup: "dernier",
    nbsp: false,
    consignes: false,
    checkWhileTyping: true,
    grammar: false,
    spelling: true,
    typography: false,
    reference: "reforme",
    apostrophe: false,
    spaces: false,
  };
  assert.deepEqual(normalizeSettings(settings), settings);
});

test("chaque valeur invalide est remplacée par son défaut, les autres sont gardées", () => {
  const got = normalizeSettings({ theme: "rose", font: 12, size: "grand", startup: "dernier" });
  assert.deepEqual(got, { ...DEFAULTS, startup: "dernier" });
});

test("une taille hors limites donne la taille par défaut, une taille valide est arrondie", () => {
  assert.equal(normalizeSettings({ size: 400 }).size, 17);
  assert.equal(normalizeSettings({ size: 3 }).size, 17);
  assert.equal(normalizeSettings({ size: 17.6 }).size, 18);
  assert.equal(normalizeSettings({ size: 14 }).size, 14);
  assert.equal(normalizeSettings({ size: 24 }).size, 24);
});

test("le repère des espaces insécables est affiché par défaut, et se masque", () => {
  assert.equal(normalizeSettings({}).nbsp, true);
  assert.equal(normalizeSettings({ nbsp: false }).nbsp, false);
  assert.equal(normalizeSettings({ nbsp: "non" }).nbsp, true);
});

test("les consignes sont affichées par défaut, et se masquent", () => {
  assert.equal(normalizeSettings({}).consignes, true);
  assert.equal(normalizeSettings({ consignes: "non" }).consignes, true);
  assert.equal(normalizeSettings({ consignes: false }).consignes, false);
});

test("correction : vérification à la demande, trois sortes cochées, toutes variantes, par défaut", () => {
  const got = normalizeSettings({});
  assert.equal(got.checkWhileTyping, false);
  assert.equal(got.grammar, true);
  assert.equal(got.spelling, true);
  assert.equal(got.typography, true);
  assert.equal(got.reference, "toutes");
});

test("correction : une valeur invalide donne son défaut", () => {
  const got = normalizeSettings({ checkWhileTyping: "oui", grammar: 0, reference: "ancienne" });
  assert.equal(got.checkWhileTyping, false);
  assert.equal(got.grammar, true);
  assert.equal(got.reference, "toutes");
  assert.equal(normalizeSettings({ reference: "classique" }).reference, "classique");
});

test("l'apostrophe typographique est posée à la frappe par défaut", () => {
  assert.equal(normalizeSettings({}).apostrophe, true);
  assert.equal(normalizeSettings({ apostrophe: "non" }).apostrophe, true);
  assert.equal(normalizeSettings({ apostrophe: false }).apostrophe, false);
});

test("les espaces insécables sont posées à la frappe par défaut", () => {
  assert.equal(normalizeSettings({}).spaces, true);
  assert.equal(normalizeSettings({ spaces: 1 }).spaces, true);
  assert.equal(normalizeSettings({ spaces: false }).spaces, false);
});

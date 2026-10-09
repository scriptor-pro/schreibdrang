import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, normalizeSettings } from "../src/settings.ts";

test("des données absentes ou illisibles donnent les valeurs par défaut", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULTS);
  assert.deepEqual(normalizeSettings("n'importe quoi"), DEFAULTS);
  assert.deepEqual(normalizeSettings([1, 2]), DEFAULTS);
});

test("des réglages valides sont conservés", () => {
  const settings = { theme: "sombre", font: "DejaVu Sans Mono", size: 20, startup: "dernier", nbsp: false };
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

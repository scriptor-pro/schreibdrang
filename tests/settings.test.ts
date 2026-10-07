import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, normalizeSettings } from "../src/settings.ts";

test("des données absentes ou illisibles donnent les valeurs par défaut", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULTS);
  assert.deepEqual(normalizeSettings("n'importe quoi"), DEFAULTS);
  assert.deepEqual(normalizeSettings([1, 2]), DEFAULTS);
});

test("des réglages valides sont conservés", () => {
  const settings = { theme: "sombre", font: "DejaVu Sans Mono", size: 20, startup: "dernier" };
  assert.deepEqual(normalizeSettings(settings), settings);
});

test("chaque valeur invalide est remplacée par son défaut, les autres sont gardées", () => {
  const got = normalizeSettings({ theme: "rose", font: 12, size: "grand", startup: "dernier" });
  assert.deepEqual(got, { ...DEFAULTS, startup: "dernier" });
});

test("la taille est ramenée entre 14 et 24, et arrondie", () => {
  assert.equal(normalizeSettings({ size: 400 }).size, 24);
  assert.equal(normalizeSettings({ size: 3 }).size, 14);
  assert.equal(normalizeSettings({ size: 17.6 }).size, 18);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { savedMessage } from "../src/dates.ts";

const path = "/home/elise/Documents/un-scenario.fountain";

test("un enregistrement de moins de 24 heures est donné par son heure", () => {
  const saved = new Date(2026, 9, 9, 19, 0);
  assert.equal(savedMessage(saved, saved, path), "Enregistré à 19\u00a0h\u00a000 : un-scenario.fountain");
  assert.equal(savedMessage(saved, new Date(2026, 9, 10, 18, 59), path), "Enregistré à 19\u00a0h\u00a000 : un-scenario.fountain");
  // Les minutes ont deux chiffres ; le nom du fichier est tiré du chemin, quel que soit le système.
  assert.equal(savedMessage(new Date(2027, 1, 1, 7, 5), new Date(2027, 1, 1, 8, 0), "C:\\Textes\\roman.md"), "Enregistré à 7\u00a0h\u00a005 : roman.md");
});

test("un enregistrement de 24 heures ou plus est donné par sa date, en toutes lettres", () => {
  const saved = new Date(2026, 9, 9, 19, 0);
  assert.equal(savedMessage(saved, new Date(2026, 9, 10, 19, 0), path), "Enregistré le vendredi 9 octobre 2026 : un-scenario.fountain");
  assert.equal(savedMessage(saved, new Date(2027, 0, 3, 8, 0), path), "Enregistré le vendredi 9 octobre 2026 : un-scenario.fountain");
});

test("le premier du mois s'écrit « 1er »", () => {
  assert.equal(savedMessage(new Date(2027, 1, 1, 7, 5), new Date(2027, 1, 5, 7, 5), path), "Enregistré le lundi 1er février 2027 : un-scenario.fountain");
});

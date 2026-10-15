import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPassages } from "../src/correction/extraction.ts";
import { isProgress, passagesIn, progressMessage, readingOrder, remarksMessage } from "../src/correction/verification.ts";

const DOC = "Un.\n\nDeux.\n\nTrois.\n\nQuatre.";
const PASSAGES = extractPassages(DOC, "roman");

test("les passages affichés sont relus d'abord, puis ceux qui suivent, puis ceux d'avant", () => {
  const from = DOC.indexOf("Deux");
  const to = DOC.indexOf("Trois") + 3;
  assert.deepEqual(readingOrder(PASSAGES, from, to).map((p) => p.text), ["Deux.", "Trois.", "Quatre.", "Un."]);
});

test("une sélection fait relire les paragraphes qu'elle touche, entiers", () => {
  const from = DOC.indexOf("ux.");
  const to = DOC.indexOf("Tro") + 2;
  assert.deepEqual(passagesIn(PASSAGES, from, to).map((p) => p.text), ["Deux.", "Trois."]);
  // Une sélection qui s'arrête au début d'un paragraphe ne le touche pas.
  assert.deepEqual(passagesIn(PASSAGES, 0, DOC.indexOf("Deux")).map((p) => p.text), ["Un."]);
});

test("l'avancement est un pourcentage arrondi vers le bas", () => {
  assert.equal(progressMessage(0, 5), "Vérification : 0 %");
  assert.equal(progressMessage(2, 5), "Vérification : 40 %");
  assert.equal(progressMessage(2, 3), "Vérification : 66 %");
  assert.equal(progressMessage(3, 3), "Vérification : 100 %");
});

test("le nombre de remarques, en toutes lettres quand il n'y en a pas", () => {
  assert.equal(remarksMessage(0), "Aucune remarque");
  assert.equal(remarksMessage(1), "1 remarque");
  assert.equal(remarksMessage(12), "12 remarques");
  assert.equal(remarksMessage(3556), "3 556 remarques");
});

test("le message d'avancement est reconnu, pour être affiché en outremer et en gras", () => {
  assert.ok(isProgress(progressMessage(2, 5)));
  assert.ok(isProgress(progressMessage(3, 3)));
  assert.ok(!isProgress(remarksMessage(12)));
  assert.ok(!isProgress(""));
});

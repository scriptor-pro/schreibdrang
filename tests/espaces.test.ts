import assert from "node:assert/strict";
import { test } from "node:test";
import { NBSP, NNBSP, frenchSpacing } from "../src/espaces.ts";

// Le texte obtenu quand on tape `typed` après `before`, ou null si la saisie
// reste telle quelle.
function typing(before: string, typed: string): string | null {
  const change = frenchSpacing(before, typed);
  return change && before.slice(0, before.length - change.back) + change.insert;
}

test("l'espace tapée avant ; ! ? devient une espace fine insécable", () => {
  assert.equal(typing("Quoi ", "?"), `Quoi${NNBSP}?`);
  assert.equal(typing("Viens ", "!"), `Viens${NNBSP}!`);
  assert.equal(typing("Non ", ";"), `Non${NNBSP};`);
});

test("l'espace tapée avant : et » devient une espace insécable", () => {
  assert.equal(typing("Il dit ", ":"), `Il dit${NBSP}:`);
  assert.equal(typing("« Oui ", "»"), `« Oui${NBSP}»`);
});

test("l'espace tapée après « devient une espace insécable", () => {
  assert.equal(typing("dit : «", " "), `dit : «${NBSP}`);
});

test("l'heure s'écrit « 15 h 35 », avec des espaces insécables", () => {
  assert.equal(typing("à 15 ", "h"), `à 15${NBSP}h`);
  assert.equal(typing(`à 15${NBSP}h `, "3"), `à 15${NBSP}h${NBSP}3`);
  // Tapée sans espaces, elle est aussi remise en forme.
  assert.equal(typing("à 15h", "3"), `à 15${NBSP}h${NBSP}3`);
  // « 15 h » suivi d'un mot ne change plus.
  assert.equal(typing(`à 15${NBSP}h `, "e"), null);
});

test("sans espace tapée, rien n'est ajouté", () => {
  // « Title: » d'une page de titre de scénario, une adresse, « ?! ».
  assert.equal(typing("Title", ":"), null);
  assert.equal(typing("Quoi ?", "!"), null);
  assert.equal(typing(`dit${NBSP}`, ":"), null);
  assert.equal(typing("", "?"), null);
});

test("le reste de la saisie ne change pas", () => {
  assert.equal(typing("Il ", "a"), null);
  assert.equal(typing("a", " "), null);
  assert.equal(typing("Quoi ", "?!"), null);
  assert.equal(typing("chah", "3"), null);
});

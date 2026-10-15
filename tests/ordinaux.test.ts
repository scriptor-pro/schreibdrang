import assert from "node:assert/strict";
import { test } from "node:test";
import { ordinalChanges, ordinalsMessage } from "../src/ordinaux.ts";

// Le texte après la mise en forme de ses nombres ordinaux.
function formatted(text: string): string {
  let result = text;
  for (const change of [...ordinalChanges(text)].reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  return result;
}

test("premier et première, au singulier et au pluriel", () => {
  assert.equal(formatted("le 1er mai, la 1re fois, la 1ère page"), "le 1ᵉʳ mai, la 1ʳᵉ fois, la 1ʳᵉ page");
  assert.equal(formatted("les 1ers, les 1res, les 1ères"), "les 1ᵉʳˢ, les 1ʳᵉˢ, les 1ʳᵉˢ");
});

test("les autres rangs, quelle que soit leur graphie", () => {
  assert.equal(formatted("le 2e, le 3ème, le 4ième, le 5eme, le 6è, le 21e"), "le 2ᵉ, le 3ᵉ, le 4ᵉ, le 5ᵉ, le 6ᵉ, le 21ᵉ");
  assert.equal(formatted("les 2es, les 3èmes, les 4ièmes"), "les 2ᵉˢ, les 3ᵉˢ, les 4ᵉˢ");
  assert.equal(formatted("le 2nd, la 2nde, les 2nds, les 2ndes"), "le 2ᵈ, la 2ᵈᵉ, les 2ᵈˢ, les 2ᵈᵉˢ");
});

test("les chiffres romains", () => {
  assert.equal(formatted("au XIXe siècle, au XXème, au IIIe, Ve République"), "au XIXᵉ siècle, au XXᵉ, au IIIᵉ, Vᵉ République");
  assert.equal(formatted("François Ier, la Ire armée, la Ière"), "François Iᵉʳ, la Iʳᵉ armée, la Iʳᵉ");
  assert.equal(formatted("au XIXèmes"), "au XIXᵉˢ");
});

test("ce qui n'est pas un nombre ordinal ne change pas", () => {
  for (const text of ["Ce De Le Me", "le 1e", "la 1ème", "3e5", "a2e", "le 2em", "XIXe2", "Ie", "21er", "le 3nd", "Mme", "15 h", "Vie", "1ᵉʳ et XIXᵉ"]) {
    assert.deepEqual(ordinalChanges(text), [], text);
  }
});

test("le message dit combien de nombres ordinaux ont été mis en forme", () => {
  assert.equal(ordinalsMessage(0), "Aucun nombre ordinal à mettre en forme dans le texte.");
  assert.equal(ordinalsMessage(1), "1 nombre ordinal mis en forme.");
  assert.equal(ordinalsMessage(1200), "1 200 nombres ordinaux mis en forme.");
});

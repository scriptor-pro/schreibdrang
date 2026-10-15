import assert from "node:assert/strict";
import { test } from "node:test";
import { NEW_PLAY, classifyPlay, renumberChanges, renumberMessage, renumberPlay, toRoman } from "../src/theatre.ts";

export const PLAY = [
  "PERSONNAGES",
  "",
  "CLAIRE, trente ans, sa sœur.",
  "THÉO, son frère.",
  "",
  "# ACTE I",
  "",
  "## Scène 1",
  "",
  "(Un salon. Le soir.)",
  "",
  "CLAIRE",
  "Tu rentres tard.",
  "",
  "THÉO",
  "(Il pose son manteau.)",
  "J'ai marché.",
  "Longtemps.",
  "",
];

test("chaque ligne d'une pièce reçoit sa nature", () => {
  assert.deepEqual(classifyPlay(PLAY), [
    "cast-title", "blank", "cast", "cast", "blank",
    "act", "blank", "scene", "blank", "stage", "blank",
    "character", "dialogue", "blank",
    "character", "stage", "dialogue", "dialogue", "blank",
  ]);
});

test("une ligne en capitales sans réplique dessous n'est pas un nom", () => {
  assert.deepEqual(classifyPlay(["# ACTE I", "", "FIN"]), ["act", "blank", "text"]);
});

test("un nom peut porter une mention entre parenthèses", () => {
  assert.deepEqual(classifyPlay(["", "CLAIRE (à part)", "Enfin."]), ["blank", "character", "dialogue"]);
});

test("après le premier acte, « PERSONNAGES » n'ouvre plus la liste", () => {
  assert.deepEqual(classifyPlay(["# ACTE I", "", "PERSONNAGES", "Oui."]), ["act", "blank", "character", "dialogue"]);
});

test("un texte avant le premier acte, sans liste, est du texte", () => {
  assert.deepEqual(classifyPlay(["Une note.", "", "# ACTE I"]), ["text", "blank", "act"]);
});

test("une pièce neuve a un acte et une scène", () => {
  assert.equal(NEW_PLAY, "# ACTE I\n\n## Scène 1\n\n");
  assert.deepEqual(classifyPlay(NEW_PLAY.split("\n")), ["act", "blank", "scene", "blank", "blank"]);
});

test("les chiffres romains", () => {
  assert.deepEqual([1, 4, 9, 14, 40, 1999].map(toRoman), ["I", "IV", "IX", "XIV", "XL", "MCMXCIX"]);
});

test("les actes en romains, les scènes numérotées dans chaque acte, les titres libres gardés", () => {
  const before = "# ACTE I\n\n## Scène 1\n\nA.\n\n## Scène 1 — Claire, Théo\n\nB.\n\n# ACTE III\n\n## Scène 5\n\nC.\n";
  const after = "# ACTE I\n\n## Scène 1\n\nA.\n\n## Scène 2 — Claire, Théo\n\nB.\n\n# ACTE II\n\n## Scène 1\n\nC.\n";
  assert.equal(renumberPlay(before), after);
});

test("un acte en chiffres arabes passe en romains, la casse est gardée", () => {
  assert.equal(renumberPlay("# Acte 2\n\n## scène 4\n"), "# Acte I\n\n## scène 1\n");
});

test("des scènes en romains le restent", () => {
  assert.equal(renumberPlay("# ACTE I\n\n## SCÈNE III\n\n## SCÈNE IV\n"), "# ACTE I\n\n## SCÈNE I\n\n## SCÈNE II\n");
});

test("un acte ou une scène sans numéro n'est pas modifié et ne compte pas", () => {
  const before = "# Prologue\n\n## Le retour\n\n## Scène 3\n\n# ACTE 1\n\n## Scène 9\n";
  const after = "# Prologue\n\n## Le retour\n\n## Scène 1\n\n# ACTE I\n\n## Scène 1\n";
  assert.equal(renumberPlay(before), after);
  assert.equal(renumberPlay("# Acte ici\n"), "# Acte ici\n");
});

test("une pièce déjà bien numérotée ne change pas", () => {
  assert.deepEqual(renumberChanges("# ACTE I\n\n## Scène 1\n\n## Scène 2\n"), []);
  assert.equal(renumberMessage(0), "Les numéros des actes et des scènes étaient déjà justes.");
  assert.equal(renumberMessage(3), "Actes et scènes renumérotés.");
});

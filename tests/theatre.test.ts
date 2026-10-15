import assert from "node:assert/strict";
import { test } from "node:test";
import { NEW_PLAY, classifyPlay } from "../src/theatre.ts";

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

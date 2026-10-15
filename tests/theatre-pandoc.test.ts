import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAY_STYLES, playModel, playToPandoc } from "../src/theatre-pandoc.ts";

const PIECE = "PERSONNAGES\n\nCLAIRE, sa sœur.\n\n# ACTE I\n\n## Scène 1\n\n(Un salon.)\n\nCLAIRE\nTu rentres\ntard.\n(Elle rit.)\nEnfin.\n";

const block = (style: string, text: string) => `::: {custom-style="${style}"}\n${text}\n:::`;

test("manuscrit : chaque élément dans son style, titres en capitales, didascalies entre parenthèses", () => {
  assert.equal(
    playToPandoc(PIECE, "manuscrit"),
    [
      block("Personnages", "PERSONNAGES"),
      block("Distribution", "CLAIRE, sa sœur."),
      block("Acte", "ACTE I"),
      block("Scene", "SCÈNE 1"),
      block("Didascalie", "(Un salon.)"),
      block("Personnage", "CLAIRE"),
      block("Replique", "Tu rentres\ntard."),
      block("Didascalie", "(Elle rit.)"),
      block("Replique", "Enfin."),
    ].join("\n\n") + "\n",
  );
});

test("édition : titres tels qu'écrits, didascalies sans parenthèses", () => {
  const edition = playToPandoc(PIECE, "edition");
  assert.ok(edition.includes(block("Personnages", "Personnages")));
  assert.ok(edition.includes(block("Scene", "Scène 1")));
  assert.ok(edition.includes(block("Didascalie", "Un salon.")));
  assert.ok(edition.includes(block("Didascalie", "Elle rit.")));
});

test("une réplique qui ressemble à du Markdown reste une réplique", () => {
  const text = "# ACTE I\n\n## Scène 1\n\nCLAIRE\n- Non.\n1. Oui.\n";
  assert.ok(playToPandoc(text, "manuscrit").includes(block("Replique", "\\- Non.\n1\\. Oui.")));
});

test("un texte que rien ne reconnaît garde son style", () => {
  assert.ok(playToPandoc("Une note.\n\n# ACTE I\n", "edition").startsWith(block("Texte", "Une note.")));
});

test("les styles nommés et les modèles", () => {
  assert.deepEqual(PLAY_STYLES, ["Acte", "Scene", "Personnages", "Distribution", "Personnage", "Replique", "Didascalie", "Texte"]);
  assert.equal(playModel("manuscrit", "a5"), "manuscrit");
  assert.equal(playModel("edition", "a4"), "edition-a4");
  assert.equal(playModel("edition", "a5"), "edition-a5");
});

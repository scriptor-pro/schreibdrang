import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDocument, parseNovella, serializeDocument } from "../src/outline.ts";

test("un texte découpé puis réécrit sans changement reste identique", () => {
  const text = "# Chapitre 1\n\n## Le pont\n\nElle traversa.\n\n## La gare\n\nLe train n'arriva pas.\n\n# Chapitre 2\n\n## Le quai\n\nIl pleuvait.\n";
  assert.equal(serializeDocument(parseDocument(text)), text);
});

test("le texte placé avant le premier chapitre est conservé", () => {
  const text = "Prologue\n\nIl était une fois.\n\n# Chapitre 1\n\n## Le pont\n\nElle traversa.\n";
  const outline = parseDocument(text);
  assert.equal(outline.preamble, "Prologue\n\nIl était une fois.");
  assert.equal(serializeDocument(outline), text);
});

test("le texte placé entre un titre de chapitre et sa première scène est conservé", () => {
  const text = "# Chapitre 1\n\nUne épigraphe.\n\n## Le pont\n\nElle traversa.\n";
  const outline = parseDocument(text);
  assert.equal(outline.chapters[0].intro, "Une épigraphe.");
  assert.equal(serializeDocument(outline), text);
});

test("un chapitre sans scène garde son texte", () => {
  const text = "# Chapitre 1\n\nTout le chapitre, d'un seul tenant.\n\n# Chapitre 2\n\n## Le quai\n\nIl pleuvait.\n";
  assert.equal(serializeDocument(parseDocument(text)), text);
});

test("un texte sans chapitre est conservé en entier", () => {
  const text = "Un texte libre.\n\n## Un intertitre\n\nLa suite.\n";
  const outline = parseDocument(text);
  assert.deepEqual(outline.chapters, []);
  assert.equal(serializeDocument(outline), text);
});

test("déplacer une scène d'un chapitre à l'autre ne perd aucun texte", () => {
  const text = "Prologue.\n\n# Chapitre 1\n\nÉpigraphe.\n\n## Le pont\n\nElle traversa.\n\n# Chapitre 2\n\n## Le quai\n\nIl pleuvait.\n";
  const outline = parseDocument(text);
  const [moved] = outline.chapters[0].scenes.splice(0, 1);
  outline.chapters[1].scenes.push(moved);
  assert.equal(
    serializeDocument(outline),
    "Prologue.\n\n# Chapitre 1\n\nÉpigraphe.\n\n# Chapitre 2\n\n## Le quai\n\nIl pleuvait.\n\n## Le pont\n\nElle traversa.\n",
  );
});

test("une nouvelle se découpe en scènes, sans chapitres : une seule colonne sans titre", () => {
  const text = "Exergue.\n\n## L'arrivée\n\nElle arrive.\n\n# Le départ\n\nElle repart.\n";
  const outline = parseNovella(text);
  assert.equal(outline.preamble, "Exergue.");
  assert.equal(outline.chapters.length, 1);
  assert.equal(outline.chapters[0].heading, "");
  assert.deepEqual(outline.chapters[0].scenes, [
    { heading: "## L'arrivée", body: "Elle arrive." },
    { heading: "# Le départ", body: "Elle repart." },
  ]);
  // Le texte est rendu tel quel, et une scène déplacée garde son titre.
  assert.equal(serializeDocument(outline), text);
  outline.chapters[0].scenes.reverse();
  assert.equal(serializeDocument(outline), "Exergue.\n\n# Le départ\n\nElle repart.\n\n## L'arrivée\n\nElle arrive.\n");
});

test("une nouvelle sans titre de scène n'a aucune fiche, et son texte est gardé", () => {
  const outline = parseNovella("Un seul bloc.\n\nDeux paragraphes.\n");
  assert.deepEqual(outline.chapters, []);
  assert.equal(serializeDocument(outline), "Un seul bloc.\n\nDeux paragraphes.\n");
});

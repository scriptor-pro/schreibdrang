import assert from "node:assert/strict";
import { test } from "node:test";
import { characterNames, extractPassages, toDocument } from "../src/correction/extraction.ts";
import type { Passage } from "../src/correction/extraction.ts";

// Ce que couvre, dans le document, le passage relevé entre start et end.
function covered(doc: string, passage: Passage, start: number, end: number): string {
  const { from, to } = toDocument(passage, start, end);
  return doc.slice(from, to);
}

test("roman : les titres sans leurs « # », les paragraphes sans leurs marques", () => {
  const doc = "# Chapitre un\n\n## La scène\n\nIl marcha *vite* vers la **mer**.\n\nElle resta.";
  const passages = extractPassages(doc, "roman");
  assert.deepEqual(passages.map((p) => p.text), ["Chapitre un", "La scène", "Il marcha vite vers la mer.", "Elle resta."]);
  const paragraph = passages[2];
  assert.equal(paragraph.from, doc.indexOf("Il marcha"));
  assert.equal(paragraph.to, doc.indexOf("\n\nElle"));
  const vite = paragraph.text.indexOf("vite");
  assert.equal(covered(doc, paragraph, vite, vite + 4), "vite");
  // Un passage relevé englobe les marques qu'il traverse.
  const mer = paragraph.text.indexOf("mer.");
  assert.equal(covered(doc, paragraph, mer, mer + 4), "mer**.");
});

test("un paragraphe écrit sur plusieurs lignes est relu d'un seul tenant", () => {
  const doc = "Il marcha\nvers la mer.\n\nFin.";
  const passages = extractPassages(doc, "roman");
  assert.deepEqual(passages.map((p) => p.text), ["Il marcha vers la mer.", "Fin."]);
  const start = passages[0].text.indexOf("marcha");
  assert.equal(covered(doc, passages[0], start, start + "marcha vers".length), "marcha\nvers");
});

test("un séparateur fait seulement de marques n'est pas relu", () => {
  const doc = "Avant.\n\n* * *\n\n***\n\nAprès.";
  assert.deepEqual(extractPassages(doc, "nouvelle").map((p) => p.text), ["Avant.", "Après."]);
});

test("un « _ » entre deux lettres est gardé, les autres sont des marques", () => {
  assert.deepEqual(extractPassages("Un mot_clé et un _vrai_ souligné.", "vanilla").map((p) => p.text), ["Un mot_clé et un vrai souligné."]);
});

test("un emoji avant une faute ne décale pas sa position", () => {
  const doc = "😀 Il marcha *vers* le flurmibon.";
  const [passage] = extractPassages(doc, "roman");
  const start = passage.text.indexOf("flurmibon");
  assert.equal(covered(doc, passage, start, start + 9), "flurmibon");
});

test("scénario : l'action, les didascalies et les répliques sont relues, pas le reste", () => {
  const doc = [
    "Title: Sous le ciel",
    "Author: Élise",
    "",
    "INT. CUISINE - JOUR",
    "",
    "Élise entre, *lentement*.",
    "",
    "ÉLISE",
    "(souriant)",
    "Les maison sont grande.",
    "",
    "COUPE À :",
    "",
    "!SALUT, dit-il.",
  ].join("\n");
  const passages = extractPassages(doc, "scenario");
  assert.deepEqual(passages.map((p) => p.text), ["Élise entre, lentement.", "(souriant)", "Les maison sont grande.", "SALUT, dit-il."]);
  // Le « ! » qui force l'action ne s'imprime pas : il n'est pas relu.
  assert.equal(toDocument(passages[3], 0, 1).from, doc.indexOf("SALUT"));
});

test("scénario : une réplique sur deux lignes est un seul passage", () => {
  const doc = "MARC\nJe viens\navec toi.\n\nIl part.";
  assert.deepEqual(extractPassages(doc, "scenario").map((p) => p.text), ["Je viens avec toi.", "Il part."]);
});

test("les noms des personnages qui parlent, entiers et mot par mot", () => {
  const doc = "ÉLISE (V.O.)\nBonjour.\n\nJEAN-PIERRE\nSalut.\n\n@McDonald\nOui.\n\nIl entre.";
  assert.deepEqual(characterNames(doc), new Set(["ÉLISE", "JEAN-PIERRE", "JEAN", "PIERRE", "MCDONALD"]));
});

test("un paragraphe est copié par blocs, pas caractère par caractère, pour ne pas gêner la frappe", () => {
  // Un texte de la taille d'un roman se découpe à chaque rafraîchissement des
  // remarques : chaque passage n'a qu'un tronçon par ligne et par marque.
  const [plain, marked, lines] = extractPassages("Elle connaissait par cœur le trajet jusqu'à la gare.\n\nTrois cent *quarante* pas.\n\nPuis le pont,\npuis la côte.", "roman");
  assert.equal(plain.starts.length, 1);
  assert.equal(marked.starts.length, 3);
  assert.equal(lines.starts.length, 3);
});

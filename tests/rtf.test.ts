import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { inlineRtf, markdownToRtf } from "../src/rtf.ts";

test("accents, guillemets et espaces insécables passent par leur numéro Unicode", () => {
  assert.equal(inlineRtf("«\u00A0Été\u00A0»"), "\\u171\\'ab\\~\\u201\\'c9t\\u233\\'e9\\~\\u187\\'bb");
});

test("accolades et barres obliques inverses sont protégées", () => {
  assert.equal(inlineRtf("a{b}c"), "a\\{b\\}c");
  assert.equal(inlineRtf("C:\\\\dossier"), "C:\\\\dossier");
});

test("un caractère au-delà de U+FFFF s'écrit en deux moitiés", () => {
  assert.equal(inlineRtf("😀"), "\\u-10179\\'3f\\u-8704\\'3f");
});

test("italique, gras, et les deux", () => {
  assert.equal(inlineRtf("un *mot* et un **autre**"), "un {\\i mot} et un {\\b autre}");
  assert.equal(inlineRtf("_mot_ et __autre__"), "{\\i mot} et {\\b autre}");
  assert.equal(inlineRtf("***fort***"), "{\\b\\i fort}");
  assert.equal(inlineRtf("**gras avec *italique* dedans**"), "{\\b gras avec {\\i italique} dedans}");
});

test("un astérisque seul ou un tiret bas dans un mot restent du texte", () => {
  assert.equal(inlineRtf("3 * 4 = 12"), "3 * 4 = 12");
  assert.equal(inlineRtf("nom_de_fichier"), "nom_de_fichier");
  assert.equal(inlineRtf("\\*pas d'italique\\*"), "*pas d'italique*");
});

test("les ordinaux deviennent un véritable exposant", () => {
  assert.equal(inlineRtf("le 1ᵉʳ et le XIXᵉ"), "le 1{\\super er} et le XIX{\\super e}");
  assert.equal(inlineRtf("le 2^e^ jour"), "le 2{\\super e} jour");
});

test("un lien garde son texte, une image disparaît", () => {
  assert.equal(inlineRtf("voir [le site](https://example.org) ![logo](logo.png)"), "voir le site ");
});

test("document : titres, paragraphes joints, séparateur, citation, liste", () => {
  const rtf = markdownToRtf("# Chapitre 1\n\n## Scène\n\nPremière ligne\nsuite.\n\n***\n\n> Une citation.\n\n- un\n- deux\n");
  assert.match(rtf, /^\{\\rtf1\\ansi/);
  assert.match(rtf, /\\fs32\\b[^ ]*\\outlinelevel0 Chapitre 1\\par\}/);
  assert.match(rtf, /\\outlinelevel1 Sc\\u232\\'e8ne\\par\}/);
  assert.match(rtf, / Premi\\u232\\'e8re ligne suite\.\\par\}/);
  assert.match(rtf, /\\qc\\sa180 \*\\~\*\\~\*\\par\}/);
  assert.match(rtf, /\\li567\\ri567 Une citation\.\\par\}/);
  assert.match(rtf, /\\u8226\\'3f\\tab un\\par\}/);
  assert.equal(rtf.trimEnd().endsWith("}"), true);
});

test("deux espaces en fin de ligne forcent un retour à la ligne", () => {
  assert.match(markdownToRtf("vers un  \nvers deux"), /vers un\\line vers deux/);
});

test("notes de bas de page", () => {
  const rtf = markdownToRtf("Un fait[^1].\n\n[^1]: Source *sûre*.\n");
  assert.match(rtf, /Un fait\{\\super\\chftn\}\{\\footnote[^}]*\{\\super\\chftn\} Source \{\\i s\\u251\\'fbre\}\.\}\./);
  assert.doesNotMatch(rtf, /\[\^1\]/);
});

test("roman : A4, marges de 2,5 cm, interligne simple ; page blanche : sa mise en page", () => {
  const roman = markdownToRtf("Texte.");
  assert.match(roman, /\\paperw11906\\paperh16838\\margl1417\\margr1417\\margt1417\\margb1417/);
  assert.doesNotMatch(roman, /\\sl\d/);
  const blanche = markdownToRtf("Texte.", { spacing: 2, top: 3, bottom: 2, left: 4, right: 1 });
  assert.match(blanche, /\\margl2268\\margr567\\margt1701\\margb1134/);
  assert.match(blanche, /\\sl480\\slmult1/);
});

const pandoc = spawnSync("pandoc", ["--version"]).status === 0;

test("aller-retour : Pandoc relit le RTF produit", { skip: !pandoc && "Pandoc absent" }, () => {
  const source = "# Chapitre premier\n\nLe 1ᵉʳ jour, *Lucien* entra, **sans** un mot : « Été ».\n\nIl repartit[^n].\n\n[^n]: Une note.\n";
  const result = spawnSync("pandoc", ["--from=rtf", "--to=markdown", "--wrap=none"], { input: markdownToRtf(source), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const back = result.stdout;
  assert.match(back, /# Chapitre premier/);
  assert.match(back, /1\^er\^ jour, \*Lucien\* entra, \*\*sans\*\* un mot : « Été »/);
  assert.match(back, /Il repartit\[\^1\]/);
  assert.match(back, /\[\^1\]: Une note\./);
});

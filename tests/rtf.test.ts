import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { inlineRtf, markdownToRtf, playToRtf, screenplayToRtf } from "../src/rtf.ts";

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

const PIECE = "PERSONNAGES\n\nANTOINE, un mari.\n\n# ACTE I\n\n## Scène 1\n\nANTOINE\n(Il entre.)\nPremier vers,\nsecond vers.\n\n# ACTE II\n";

test("pièce, manuscrit : Courier Prime, A4, actes sur une nouvelle page, numéros en bas", () => {
  const rtf = playToRtf(PIECE, "manuscrit", "a4");
  assert.match(rtf, /\{\\fonttbl\{\\f0\\fmodern[^}]*Courier Prime/);
  assert.match(rtf, /\\paperw11906\\paperh16838\\margl1417/);
  assert.match(rtf, /\{\\footer[^}]*\\qc[^}]*\\chpgn\\par\}/);
  assert.match(rtf, /\\keepn\\sb0\\sa360\\qc\\b PERSONNAGES\\par\}/);
  assert.match(rtf, /\\pagebb\\keepn\\sb0\\sa480\\qc\\b ACTE I\\par\}/);
  assert.match(rtf, /\\qc\\b SC\\u200\\'c8NE 1\\par\}/);
  assert.match(rtf, /\\keepn\\sb240\\sa0\\qc ANTOINE\\par\}/);
  assert.match(rtf, /\\li1134\\ri567\\i \(Il entre\.\)\\par\}/);
  assert.match(rtf, /\\sb0\\sa120 Premier vers,\\line second vers\.\\par\}/);
});

test("pièce, édition A5 : EB Garamond corps 11, marges de 2 cm, noms en capitales réduites, didascalies sans parenthèses", () => {
  const rtf = playToRtf(PIECE, "edition", "a5");
  assert.match(rtf, /EB Garamond;/);
  assert.match(rtf, /\\paperw8391\\paperh11906\\margl1134\\margr1134/);
  assert.match(rtf, /\\fs22\\lang1036\\keepn\\sb240\\sa0\\qc\\caps\\fs18 ANTOINE\\par\}/);
  assert.match(rtf, /\\li1134\\ri567\\i Il entre\.\\par\}/);
  assert.match(rtf, /\\qc\\b Sc\\u232\\'e8ne 1\\par\}/);
});

test("scénario : lignes imprimées, retraits gardés, une page par page, numéro en haut à droite", () => {
  const pages = [
    [[{ text: "INT. CUISINE - JOUR", style: "b" as const }], [], [{ text: "                      ÉLISE", style: "" as const }]],
    [[{ text: "          Bonjour.", style: "" as const }]],
  ];
  const rtf = screenplayToRtf(pages);
  assert.match(rtf, /Courier Prime\{\\\*\\falt Courier New\}/);
  assert.match(rtf, /\{\\header\\pard\\plain\\qr\\f0\\fs24 \\chpgn\.\\par\}/);
  assert.match(rtf, /\\titlepg/);
  assert.match(rtf, /\\sl-240\\sa0\\sb0 \{\\b INT\. CUISINE - JOUR\}\\par\}/);
  assert.match(rtf, /\\sb0                       \\u201\\'c9LISE\\par\}/);
  assert.match(rtf, /\\sb0\\pagebb           Bonjour\.\\par\}/);
  assert.doesNotMatch(rtf, /\\sect\b/);
});

test("scénario avec page de titre : une section pour elle, puis le texte paginé à partir de 1", () => {
  const author = { name: "Alan Smithee", email: "alan@example.org", phone: "555 6789", agentFirstName: "", agentLastName: "", agency: "", agencyEmail: "", agencyPhone: "" };
  const rtf = screenplayToRtf([[[{ text: "FONDU :", style: "" }]]], { title: "Untitled", source: "", authors: [author] });
  assert.match(rtf, /\\qc\\sb3912\\sa480 UNTITLED\\par\}/);
  assert.match(rtf, /\\u233\\'e9crit par/);
  assert.match(rtf, /\\posyb[^}]* Alan Smithee\\line alan@example\.org\\line 555 6789\\par\}/);
  assert.match(rtf, /\\sect\n\\sectd\\sbkpage\\pgnrestart\\pgnstarts1\\titlepg/);
});

test("aller-retour : Pandoc relit la pièce et le scénario", { skip: !pandoc && "Pandoc absent" }, () => {
  const read = (rtf: string) => spawnSync("pandoc", ["--from=rtf", "--to=plain", "--wrap=none"], { input: rtf, encoding: "utf8" }).stdout;
  const play = read(playToRtf(PIECE, "manuscrit", "a4"));
  assert.match(play, /ACTE I/);
  assert.match(play, /Premier vers,\n\s*second vers\./);
  const script = read(screenplayToRtf([[[{ text: "INT. CUISINE - JOUR", style: "b" }], [], [{ text: "Élise entre.", style: "" }]]]));
  assert.match(script, /INT\. CUISINE - JOUR/);
  assert.match(script, /Élise entre\./);
});

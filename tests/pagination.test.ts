import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLines } from "../src/fountain.ts";
import { pageAt, paginate, printedPages, wrapOffsets } from "../src/pagination.ts";
import type { PrintedLine } from "../src/pagination.ts";

function pages(text: string, perPage: number) {
  const lines = text.split("\n");
  return paginate(lines, classifyLines(lines), perPage);
}

test("un paragraphe est composé à la largeur de son élément, sans couper les mots", () => {
  assert.deepEqual(wrapOffsets("court", 10), [0]);
  assert.deepEqual(wrapOffsets("", 10), [0]);
  // « un deux » fait 7 caractères, « un deux trois » en ferait 13.
  assert.deepEqual(wrapOffsets("un deux trois quatre", 10), [0, 8, 14]);
  // Un mot qui finit exactement à la largeur tient sur la ligne.
  assert.deepEqual(wrapOffsets("abcde fghi jkl", 10), [0, 11]);
  // Après un trait d'union, la ligne peut être coupée.
  assert.deepEqual(wrapOffsets("cent quatre-vingt-trois", 12), [0, 12]);
  // Une espace insécable ne permet pas de couper : « là\u00a0? » reste entier.
  assert.deepEqual(wrapOffsets("Tu restes là\u00a0?", 13), [0, 10]);
  assert.deepEqual(wrapOffsets("Tu restes là ?", 13), [0, 13]);
  // Un mot plus long que la ligne est coupé à la largeur.
  assert.deepEqual(wrapOffsets("abcdefghijklmnopqrstuvwxy", 10), [0, 10, 20]);
});

test("un scénario court tient sur une page ; la page de titre et les sections ne comptent pas", () => {
  const text = "Title: Les marches\nAuthor: Élise\n\n# Acte I\n\n= Résumé.\n\nINT. CUISINE - JOUR\n\nÉlise entre.\n";
  // Trois lignes imprimées : l'intitulé, une ligne vide, l'action.
  assert.deepEqual(pages(text, 3), []);
  assert.deepEqual(pages(text, 55), []);
});

test("une page pleine se termine, la suivante ne commence pas par une ligne vide", () => {
  const text = "Un.\n\nDeux.\n\nTrois.\n\nQuatre.\n";
  // Page de 3 lignes : « Un. », vide, « Deux. » ; puis « Trois. », vide, « Quatre. ».
  assert.deepEqual(pages(text, 3), [{ line: 4, offset: 0 }]);
});

test("un paragraphe d'action passe d'une page à l'autre au milieu, sans ligne isolée", () => {
  const paragraph = "aaaa ".repeat(60).trim(); // 60 mots de 4 lettres : 12 par ligne de 60, donc 5 lignes
  assert.equal(wrapOffsets(paragraph, 60).length, 5);
  // Deux lignes sont prises ; il en reste trois sur une page de cinq.
  assert.deepEqual(pages(`Un.\n\n${paragraph}\n`, 5), [{ line: 2, offset: 180 }]);
  // Une seule ligne de libre : le paragraphe commence la page suivante.
  assert.deepEqual(pages(`Un.\n\nDeux.\n\n${paragraph}\n`, 5), [{ line: 4, offset: 0 }]);
});

test("un nom de personnage n'est pas séparé de sa réplique", () => {
  const text = "Un.\n\nDeux.\n\nÉLISE\n(avec ironie)\nBien sûr.\n";
  // Page de 6 lignes : quatre sont prises, le dialogue en demande trois.
  assert.deepEqual(pages(text, 6), [{ line: 4, offset: 0 }]);
  assert.deepEqual(pages(text, 7), []);
});

test("un intitulé de scène n'est pas laissé seul en bas de page", () => {
  const text = "Un.\n\nDeux.\n\nINT. CUISINE - JOUR\n\nÉlise entre.\n";
  // Page de 5 lignes : l'intitulé tiendrait en cinquième ligne, sans rien dessous.
  assert.deepEqual(pages(text, 5), [{ line: 4, offset: 0 }]);
  assert.deepEqual(pages(text, 7), []);
});

test("un intitulé de scène suit le paragraphe qui ne peut pas commencer sous lui", () => {
  const paragraph = "aaaa ".repeat(36).trim(); // 3 lignes de 60 caractères
  assert.equal(wrapOffsets(paragraph, 60).length, 3);
  // Page de 6 lignes : « Un. », vide, l'intitulé, vide, puis deux lignes de
  // libre pour un paragraphe de trois, qui ne se coupe pas en 2 + 1. Le
  // paragraphe passe à la page suivante, et l'intitulé avec lui.
  assert.deepEqual(pages(`Un.\n\nINT. CUISINE - JOUR\n\n${paragraph}\n`, 6), [{ line: 2, offset: 0 }]);
  // Un dialogue qui ne tient pas sous l'intitulé l'emmène aussi.
  assert.deepEqual(pages("Un.\n\nINT. CUISINE - JOUR\n\nÉLISE\n(bas)\nOui.\n", 6), [{ line: 2, offset: 0 }]);
});

test("« === » force un saut de page", () => {
  assert.deepEqual(pages("Un.\n\n===\n\nDeux.\n", 55), [{ line: 4, offset: 0 }]);
});

test("le numéro de page d'une position suit les coupures", () => {
  const breaks = [{ line: 4, offset: 0 }, { line: 9, offset: 120 }];
  assert.equal(pageAt(breaks, 0, 0), 1);
  assert.equal(pageAt(breaks, 4, 0), 2);
  assert.equal(pageAt(breaks, 9, 119), 2);
  assert.equal(pageAt(breaks, 9, 120), 3);
  assert.equal(pageAt([], 100, 0), 1);
});

function printedRuns(text: string, perPage = 55) {
  const lines = text.split("\n");
  return printedPages(lines, classifyLines(lines), perPage);
}

// Le texte seul de chaque ligne imprimée, sans sa graisse.
const lineText = (line: PrintedLine) => line.map((run) => run.text).join("");

function printed(text: string, perPage = 55) {
  return printedRuns(text, perPage).map((page) => page.map(lineText));
}

test("à l'impression, chaque élément a son retrait et perd sa marque Fountain", () => {
  const text = [
    "Title: Les marches",
    "",
    "# Acte I",
    "",
    "= Résumé.",
    "",
    ".CUISINE",
    "",
    "!ÉLISE entre.",
    "",
    "@élise (V.O.) ^",
    "(bas)",
    "Bonjour.",
    "",
    "> FONDU AU NOIR",
    "",
    "COUPE À :",
    "",
    "> FIN <",
  ].join("\n");
  assert.deepEqual(printed(text), [
    [
      "CUISINE",
      "",
      "ÉLISE entre.",
      "",
      `${" ".repeat(22)}élise (V.O.)`,
      `${" ".repeat(16)}(bas)`,
      `${" ".repeat(10)}Bonjour.`,
      "",
      `${" ".repeat(60 - 13)}FONDU AU NOIR`,
      "",
      `${" ".repeat(60 - 9)}COUPE À :`,
      "",
      `${" ".repeat(28)}FIN`,
    ],
  ]);
});

test("à l'impression, un paragraphe est coupé aux mêmes endroits que dans l'éditeur", () => {
  const action = "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize";
  assert.deepEqual(printed(action), [
    ["un deux trois quatre cinq six sept huit neuf dix onze douze", "treize quatorze quinze seize"],
  ]);
  assert.deepEqual(printed(`ÉLISE\n${"mot ".repeat(12).trim()}`), [
    [`${" ".repeat(22)}ÉLISE`, `${" ".repeat(10)}${"mot ".repeat(9).trim()}`, `${" ".repeat(10)}${"mot ".repeat(3).trim()}`],
  ]);
});

test("les pages imprimées commencent aux coupures de l'éditeur", () => {
  assert.deepEqual(printed("Un.\n\nDeux.\n\nTrois.\n\nQuatre.\n", 3), [
    ["Un.", "", "Deux."],
    ["Trois.", "", "Quatre."],
  ]);
  // Une coupure au milieu d'un paragraphe : la page suivante reprend au mot
  // où l'éditeur place son filet.
  const paragraph = Array.from({ length: 6 }, (_, index) => `${"x".repeat(55)}${index}`).join(" ");
  const lines = [paragraph];
  const breaks = paginate(lines, classifyLines(lines), 4);
  const pagesOut = printed(paragraph, 4);
  assert.equal(pagesOut.length, breaks.length + 1);
  assert.equal(pagesOut[1][0], paragraph.slice(breaks[0].offset, breaks[0].offset + 56));
});

test("un long scénario imprimé a les pages de l'éditeur, aucune ne déborde ni ne commence par une ligne vide", () => {
  const blocks: string[] = [];
  for (let index = 0; index < 400; index += 1) {
    if (index % 7 === 0) blocks.push(`INT. LIEU ${index} - JOUR`);
    if (index % 31 === 30) blocks.push("===");
    if (index % 3 === 0) blocks.push(`PERSONNAGE ${index}\n(à part)\n${"réplique ".repeat(5 + (index % 40)).trim()}`);
    else blocks.push("action ".repeat(3 + (index % 60)).trim());
    if (index % 11 === 0) blocks.push("COUPE À :");
  }
  const lines = blocks.join("\n\n").split("\n");
  const kinds = classifyLines(lines);
  const breaks = paginate(lines, kinds);
  const pagesOut = printedPages(lines, kinds).map((page) => page.map(lineText));
  assert.equal(pagesOut.length, breaks.length + 1);
  assert.ok(pagesOut.length > 20);
  for (const page of pagesOut) {
    assert.ok(page.length >= 1 && page.length <= 55);
    assert.notEqual(page[0], "");
    assert.notEqual(page[page.length - 1], "");
    for (const line of page) assert.ok(line.length <= 60, line);
  }
});

test("à l'impression, l'intitulé de scène est en gras et une ligne vide n'a pas de texte", () => {
  assert.deepEqual(printedRuns("INT. CUISINE - JOUR\n\nÉlise entre."), [
    [[{ text: "INT. CUISINE - JOUR", style: "b" }], [], [{ text: "Élise entre.", style: "" }]],
  ]);
});

test("à l'impression, les étoiles de Fountain donnent l'italique et le gras, et disparaissent", () => {
  assert.deepEqual(printedRuns("Elle *crie* et **frappe**, ***fort***.")[0][0], [
    { text: "Elle ", style: "" },
    { text: "crie", style: "i" },
    { text: " et ", style: "" },
    { text: "frappe", style: "b" },
    { text: ", ", style: "" },
    { text: "fort", style: "bi" },
    { text: ".", style: "" },
  ]);
  // L'italique dans le gras, et dans un dialogue : le retrait reste en maigre.
  assert.deepEqual(printedRuns("ÉLISE\n**Non, *jamais* !**")[0][1], [
    { text: " ".repeat(10), style: "" },
    { text: "Non, ", style: "b" },
    { text: "jamais", style: "bi" },
    { text: " !", style: "b" },
  ]);
  // Dans un intitulé de scène, déjà en gras.
  assert.deepEqual(printedRuns("INT. *NAUTILUS* - NUIT\n\nRien.")[0][0], [
    { text: "INT. ", style: "b" },
    { text: "NAUTILUS", style: "bi" },
    { text: " - NUIT", style: "b" },
  ]);
});

test("une étoile seule, précédée d'une barre oblique ou suivie d'une espace reste une étoile", () => {
  assert.deepEqual(printed("Note * en bas, 3 * 4 = 12."), [["Note * en bas, 3 * 4 = 12."]]);
  assert.deepEqual(printed("Une étoile \\* seule et \\*deux\\*."), [["Une étoile * seule et *deux*."]]);
  assert.deepEqual(printed("Un *mot sans fin."), [["Un *mot sans fin."]]);
});

test("l'italique se poursuit quand le paragraphe passe à la ligne", () => {
  const text = `*${"mot ".repeat(20).trim()}*`;
  const [page] = printedRuns(text);
  assert.equal(page.length, 2);
  for (const line of page) assert.deepEqual(line.map((run) => run.style), ["i"]);
  assert.equal(page.map(lineText).join(" "), "mot ".repeat(20).trim());
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLines, couldBeCharacter, hasTitlePage, parseScreenplay, sceneTitle, upperCaseSceneHeadings } from "../src/fountain.ts";
import { serializeDocument } from "../src/outline.ts";

const SCRIPT = [
  "Title: Les marches", //            0 title
  "Author: Élise Kœnig", //           1 title
  "", //                              2
  "INT. CUISINE - JOUR", //           3 scene
  "", //                              4
  "Élise ouvre la fenêtre.", //       5 action
  "", //                              6
  "LE VIEIL HOMME", //                7 character
  "(sans se retourner)", //           8 parenthetical
  "Tu comptes rester là longtemps ?", // 9 dialogue
  "", //                              10
  "ÉLISE (V.O.)", //                  11 character
  "Ça dépend.", //                    12 dialogue
  "", //                              13
  "COUPE À :", //                     14 transition
  "", //                              15
  ".LE PONT, PLUS TARD", //           16 scene (forcée)
  "", //                              17
  "SILENCE.", //                      18 action : capitales, mais rien ne suit
  "", //                              19
  "> FIN <", //                       20 centered
];

test("chaque ligne d'un scénario Fountain est reconnue", () => {
  assert.deepEqual(classifyLines(SCRIPT), [
    "title", "title", "blank",
    "scene", "blank",
    "action", "blank",
    "character", "parenthetical", "dialogue", "blank",
    "character", "dialogue", "blank",
    "transition", "blank",
    "scene", "blank",
    "action", "blank",
    "centered",
  ]);
});

test("les sections, les synopsis, les sauts de page et les lignes forcées sont reconnus", () => {
  assert.deepEqual(classifyLines(["# Acte I", "", "= Elle arrive.", "", "===", "", "> FONDU AU NOIR", "", "@McCLANE", "Yippee.", "", "!EXT. FAUX INTITULÉ"]), [
    "section", "blank", "synopsis", "blank", "pagebreak", "blank", "transition", "blank", "character", "dialogue", "blank", "action",
  ]);
});

test("un intitulé de scène demande une ligne vide avant lui, pas après", () => {
  // L'action tapée juste sous l'intitulé ne lui retire pas sa nature.
  assert.deepEqual(classifyLines(["int. cuisine - jour", "Une magnifique cuisine"]), ["scene", "action"]);
  assert.deepEqual(classifyLines(["Élise sort.", "", ".le pont", "Il pleut."]), ["action", "blank", "scene", "action"]);
  assert.deepEqual(classifyLines(["Elle lit :", "INT. CUISINE - JOUR", "sur l'écran."]), ["action", "action", "action"]);
  assert.deepEqual(classifyLines(["int. cuisine - jour"]), ["scene"]);
  assert.deepEqual(classifyLines(["EXT./INT. VOITURE - NUIT", "", "INT/EXT. PORCHE", "", "I/E. HALL", "", "INTÉRIEUR"]).filter((k) => k !== "blank"), [
    "scene", "scene", "scene", "action",
  ]);
});

test("la page de titre n'existe qu'en tête du fichier", () => {
  assert.equal(hasTitlePage("Title: Les marches\n\nINT. CUISINE"), true);
  assert.equal(hasTitlePage("INT. CUISINE - JOUR\n\nTitle: non"), false);
  assert.equal(sceneTitle(".LE PONT"), "LE PONT");
  assert.equal(sceneTitle("INT. CUISINE"), "INT. CUISINE");
});

test("un scénario découpé puis réécrit sans changement reste identique", () => {
  const text = SCRIPT.join("\n") + "\n";
  const outline = parseScreenplay(text);
  assert.equal(outline.preamble, "Title: Les marches\nAuthor: Élise Kœnig");
  assert.deepEqual(outline.chapters.map((c) => c.heading), [""]);
  assert.deepEqual(outline.chapters[0].scenes.map((s) => s.heading), ["INT. CUISINE - JOUR", ".LE PONT, PLUS TARD"]);
  assert.equal(serializeDocument(outline), text);
});

test("les sections de premier niveau forment les colonnes ; déplacer une scène ne perd aucun texte", () => {
  const text = "# Acte I\n\n= Installation.\n\nINT. CUISINE - JOUR\n\nÉlise entre.\n\n## Séquence 2\n\nEXT. PONT - NUIT\n\nIl pleut.\n\n# Acte II\n\nINT. GARE - JOUR\n\nLe train n'arrive pas.\n";
  const outline = parseScreenplay(text);
  assert.deepEqual(outline.chapters.map((c) => [c.heading, c.scenes.length]), [["# Acte I", 2], ["# Acte II", 1]]);
  assert.equal(outline.chapters[0].intro, "= Installation.");
  assert.equal(serializeDocument(outline), text);
  const [moved] = outline.chapters[0].scenes.splice(1, 1);
  outline.chapters[1].scenes.push(moved);
  assert.equal(
    serializeDocument(outline),
    "# Acte I\n\n= Installation.\n\nINT. CUISINE - JOUR\n\nÉlise entre.\n\n## Séquence 2\n\n# Acte II\n\nINT. GARE - JOUR\n\nLe train n'arrive pas.\n\nEXT. PONT - NUIT\n\nIl pleut.\n",
  );
});

test("un nom de personnage est en capitales, sans être un intitulé de scène ni une transition", () => {
  for (const line of ["ÉLISE", "LE VIEIL HOMME (O.S.)", "@McClane", "  PAUL  "]) assert.equal(couldBeCharacter(line), true, line);
  for (const line of ["", "Élise", "INT. CUISINE - JOUR", "COUPE À :", "> FIN <", "# ACTE I", ".LE PONT", "(SUITE)"]) {
    assert.equal(couldBeCharacter(line), false, line);
  }
});

test("un intitulé de scène est reconnu quelle que soit sa casse, avec ou sans point", () => {
  for (const heading of ["INT. CUISINE - JOUR", "Int. cuisine - jour", "int cuisine", "eXt. jardin", "ext jardin", "int./ext. voiture", "i/e voiture"]) {
    assert.deepEqual(classifyLines(["", heading, ""]), ["blank", "scene", "blank"], heading);
  }
});

test("« est » n'ouvre pas un intitulé de scène : c'est aussi un mot", () => {
  assert.deepEqual(classifyLines(["", "Est arrivé hier.", ""]), ["blank", "action", "blank"]);
  assert.deepEqual(classifyLines(["", "EST. PARIS - JOUR", ""]), ["blank", "action", "blank"]);
});

test("le titre d'une scène est en majuscules, quoi qu'on ait tapé", () => {
  assert.equal(sceneTitle("int. cuisine d'élise - jour"), "INT. CUISINE D'ÉLISE - JOUR");
  assert.equal(sceneTitle(".le pont"), "LE PONT");
});

test("à l'export, les intitulés de scène passent en majuscules et le reste ne change pas", () => {
  const text = "Title: Les marches\n\nint. cuisine - jour\n\nÉlise entre. Int. ne compte pas ici.\n\n.le pont\n\nélise\nBonjour.\n";
  assert.equal(
    upperCaseSceneHeadings(text),
    "Title: Les marches\n\nINT. CUISINE - JOUR\n\nÉlise entre. Int. ne compte pas ici.\n\n.LE PONT\n\nélise\nBonjour.\n",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySheet } from "../src/fiches.ts";
import { applyRename, planRename } from "../src/fiches-noms.ts";
import { castTitleRanges, prefillAllowed } from "../src/fiches-detection.ts";

const marie = { ...emptySheet("m", 1), firstName: "Marie", lastName: "Delcourt" };
const autreMarie = { ...emptySheet("m2", 2), firstName: "Marie" };
const antoinePetit = { ...emptySheet("p", 3), nickname: "Antoine Petit" };

const rename = (text: string, from: string, to: string, others = [marie], apostrophe = "’") =>
  applyRename(text, planRename(text, from, to, others, apostrophe).changes);

test("remplace le nom écrit comme dans la fiche, en début de phrase et en capitales", () => {
  assert.equal(rename("Antoine rit. ANTOINE\nantoine", "Antoine", "Gaston"), "Gaston rit. GASTON\nantoine");
  assert.equal(rename("le père Antoine. Le père Antoine.", "le père Antoine", "le père Firmin"), "le père Firmin. Le père Firmin.");
  assert.equal(rename("ELISE et ÉLISE, Elise", "Élise", "Jeanne"), "JEANNE et JEANNE, Elise");
});

test("ne touche ni les mots plus longs ni les autres noms", () => {
  assert.equal(rename("Antoinette, Antoine-Marie, Marie", "Antoine", "Gaston"), "Antoinette, Antoine-Marie, Marie");
  assert.equal(rename("Antoine Petit et Antoine", "Antoine", "Gaston", [antoinePetit]), "Antoine Petit et Gaston");
});

test("compte les remplacements", () => {
  assert.equal(planRename("Antoine, Antoine et ANTOINE.", "Antoine", "Gaston", []).changes.length, 3);
  assert.equal(planRename("Personne ici.", "Antoine", "Gaston", []).changes.length, 0);
});

test("élision : d’ et qu’ suivent le nouveau nom", () => {
  assert.equal(rename("la mère d’Antoine, qu'Antoine", "Antoine", "Gaston"), "la mère de Gaston, que Gaston");
  assert.equal(rename("D’ANTOINE", "Antoine", "Gaston"), "DE GASTON");
  assert.equal(rename("la mère de Gaston, que Gaston. De Gaston", "Gaston", "Antoine"), "la mère d’Antoine, qu’Antoine. D’Antoine");
  assert.equal(rename("la mère de Gaston", "Gaston", "Hélène", [], "'"), "la mère d'Hélène");
  assert.equal(rename("la mère de Gaston", "Gaston", "Paul"), "la mère de Paul");
  assert.equal(rename("le monde Gaston", "Gaston", "Antoine"), "le monde Antoine");
});

test("un nom porté par une autre fiche n'est pas remplacé", () => {
  const plan = planRename("Marie rit.", "Marie", "Jeanne", [autreMarie]);
  assert.equal(plan.shared, true);
  assert.equal(plan.changes.length, 0);
});

test("la partie protégée est laissée de côté", () => {
  const text = "PERSONNAGES\n\nANTOINE.\n\nANTOINE\nBonjour.";
  const plan = planRename(text, "Antoine", "Gaston", [], "’", [{ from: 0, to: 22 }]);
  assert.equal(applyRename(text, plan.changes), "PERSONNAGES\n\nANTOINE.\n\nGASTON\nBonjour.");
});

test("dans l'éditeur : passe la protection et s'annule d'un seul Ctrl+Z", async () => {
  const { EditorState } = await import("@codemirror/state");
  const { history, isolateHistory, undo } = await import("@codemirror/commands");
  const { protection } = await import("../src/fiches-editeur.ts");
  const text = "PERSONNAGES\n\nANTOINE.\n\nANTOINE\nBonjour, Antoine.";
  const range = { from: 0, to: 22 };
  const host = { protectedRange: () => range, refused: () => assert.fail("refusé") } as never;
  let state = EditorState.create({ doc: text, extensions: [history(), protection(host)] });
  state = state.update({ changes: { from: state.doc.length, insert: " Oui." }, userEvent: "input.type" }).state;
  const plan = planRename(state.doc.toString(), "Antoine", "Gaston", [], "’", [range]);
  state = state.update({ changes: plan.changes, userEvent: "input.rename", annotations: isolateHistory.of("full") }).state;
  assert.equal(state.doc.toString(), "PERSONNAGES\n\nANTOINE.\n\nGASTON\nBonjour, Gaston. Oui.");
  undo({ state, dispatch: (tr) => (state = tr.state) });
  assert.equal(state.doc.toString(), text + " Oui.");
});

test("le titre « PERSONNAGES » d'une pièce n'est jamais renommé", () => {
  const text = "PERSONNAGES\n\nPERSONNAGES, qui parle.\n\n# Acte I\n\n## Scène 1\n\nPERSONNAGES\nBonjour.";
  const skip = castTitleRanges(text, "theatre");
  assert.deepEqual(skip, [{ from: 0, to: 11 }]);
  const plan = planRename(text, "PERSONNAGES", "ANTOINE", [], "’", skip);
  assert.equal(applyRename(text, plan.changes), "PERSONNAGES\n\nANTOINE, qui parle.\n\n# Acte I\n\n## Scène 1\n\nANTOINE\nBonjour.");
  assert.deepEqual(castTitleRanges(text, "roman"), []);
});

test("« Nouveau personnage » ne préremplit pas avec un titre ni un mot sans majuscule", () => {
  const play = ["PERSONNAGES", "", "# Acte I", "", "## Scène 1", "", "ANTOINE", "Bonjour, Lucien."];
  assert.equal(prefillAllowed(play, 0, "PERSONNAGES", "theatre"), false);
  assert.equal(prefillAllowed(play, 2, "Acte", "theatre"), false);
  assert.equal(prefillAllowed(play, 4, "Scène", "theatre"), false);
  assert.equal(prefillAllowed(play, 6, "ANTOINE", "theatre"), true);
  assert.equal(prefillAllowed(play, 7, "Lucien", "theatre"), true);
  assert.equal(prefillAllowed(play, 7, "Bonjour", "theatre"), true);
  assert.equal(prefillAllowed(["Il marche vers Lucien."], 0, "marche", "roman"), false);
  assert.equal(prefillAllowed(["# Chapitre un"], 0, "Chapitre", "roman"), false);
  const screen = ["INT. CUISINE - JOUR", "", "Lucien entre.", "", "COUPÉ À :"];
  assert.equal(prefillAllowed(screen, 0, "INT", "scenario"), false);
  assert.equal(prefillAllowed(screen, 2, "Lucien", "scenario"), true);
  assert.equal(prefillAllowed(screen, 4, "COUPÉ", "scenario"), false);
});

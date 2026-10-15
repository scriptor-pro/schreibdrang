import assert from "node:assert/strict";
import { test } from "node:test";
import { NEW_PLAY, bannerAt, classifyPlay, parsePlay, playCharacterNames, playPosition, renumberChanges, renumberMessage, renumberPlay, sceneOffset, toRoman } from "../src/theatre.ts";
import { serializeDocument } from "../src/outline.ts";

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

test("une pièce se découpe en actes et en scènes, et se réécrit à l'identique", () => {
  const text = "PERSONNAGES\n\nCLAIRE, sa sœur.\n\n# ACTE I\n\n## Scène 1\n\nCLAIRE\nBonjour.\n\n# ACTE II\n\n## Scène 1\n\nTHÉO\nAdieu.\n";
  const outline = parsePlay(text);
  assert.equal(outline.preamble, "PERSONNAGES\n\nCLAIRE, sa sœur.");
  assert.deepEqual(outline.chapters.map((act) => [act.heading, act.scenes.map((scene) => scene.heading)]), [
    ["# ACTE I", ["## Scène 1"]],
    ["# ACTE II", ["## Scène 1"]],
  ]);
  assert.equal(serializeDocument(outline), text);
});

test("des scènes avant le premier acte forment une colonne sans titre, et reviennent intactes", () => {
  const text = "## Scène 1\n\nA.\n\n# ACTE I\n\n## Scène 1\n\nB.\n";
  const outline = parsePlay(text);
  assert.equal(outline.chapters[0].heading, "");
  assert.equal(outline.chapters[0].scenes.length, 1);
  assert.equal(serializeDocument(outline), text);
});

test("la place d'une scène dans le texte, par son rang", () => {
  const text = "# ACTE I\n\n## Scène 1\n\nA.\n\n# ACTE II\n\n## Scène 1\n";
  assert.equal(sceneOffset(text, 0), text.indexOf("## Scène 1"));
  assert.equal(sceneOffset(text, 1), text.lastIndexOf("## Scène 1"));
  assert.equal(sceneOffset(text, 2), -1);
});

test("le pied de page dit l'acte et la scène du curseur", () => {
  const kinds = classifyPlay(PLAY);
  assert.equal(playPosition(PLAY, kinds, PLAY.indexOf("Tu rentres tard.")), "Acte I, scène 1");
  assert.equal(playPosition(PLAY, kinds, 2), "Personnages");
  assert.equal(playPosition(PLAY, kinds, 5), "Acte I");
  const note = ["Note.", "", "# ACTE I"];
  assert.equal(playPosition(note, classifyPlay(note), 0), "");
});

test("le pied de page compte une scène sans numéro, et nomme un acte sans numéro", () => {
  const free = ["# ACTE II — L'orage", "", "## Le retour", "", "## Le départ", "Texte."];
  assert.equal(playPosition(free, classifyPlay(free), 5), "Acte II, scène 2");
  const prologue = ["# Prologue", "", "## Scène 1", "Texte."];
  assert.equal(playPosition(prologue, classifyPlay(prologue), 3), "Prologue, scène 1");
});

test("le bandeau nomme l'acte et la scène de la première ligne affichée", () => {
  const kinds = classifyPlay(PLAY);
  assert.deepEqual(bannerAt(PLAY, kinds, PLAY.indexOf("Tu rentres tard.")), { title: "ACTE I — Scène 1", heading: 7 });
  assert.deepEqual(bannerAt(PLAY, kinds, 2), { title: "Personnages", heading: 0 });
  const lines = ["Note.", "", "# ACTE I", "", "## Scène 2 — Claire, Théo", "Oui."];
  assert.deepEqual(bannerAt(lines, classifyPlay(lines), 0), { title: "", heading: -1 });
  assert.deepEqual(bannerAt(lines, classifyPlay(lines), 5), { title: "ACTE I — Scène 2 — Claire, Théo", heading: 4 });
  const actOnly = ["# ACTE I", "", "Un texte."];
  assert.deepEqual(bannerAt(actOnly, classifyPlay(actOnly), 2), { title: "ACTE I", heading: 0 });
});

test("les noms des personnages, ceux qui parlent et ceux de la liste", () => {
  const text = "PERSONNAGES\n\nJEAN-PIERRE, son oncle.\nla Mère, une voisine.\n\n# ACTE I\n\n## Scène 1\n\nMARIE (à part)\nEnfin.\n";
  assert.deepEqual(playCharacterNames(text), new Set(["JEAN-PIERRE", "JEAN", "PIERRE", "MARIE"]));
});

test("la numérotation classique « ACTE PREMIER », « SCÈNE PREMIÈRE » est comprise et gardée", () => {
  const classic = "# ACTE PREMIER\n\n## SCÈNE PREMIÈRE\n\n## SCÈNE II\n\n## SCÈNE III\n\n# ACTE II\n\n## SCÈNE PREMIÈRE\n";
  assert.equal(renumberPlay(classic), classic);
  // Après un déplacement, la première scène redevient « PREMIÈRE ».
  assert.equal(renumberPlay("# ACTE PREMIER\n\n## SCÈNE II\n\n## SCÈNE PREMIÈRE\n"), "# ACTE PREMIER\n\n## SCÈNE PREMIÈRE\n\n## SCÈNE II\n");
  assert.equal(renumberPlay("# Acte premier\n\n## Scène 2\n\n## Scène première\n"), "# Acte premier\n\n## Scène première\n\n## Scène 2\n");
  const lines = ["# ACTE PREMIER", "", "## SCÈNE PREMIÈRE", "Texte."];
  assert.equal(playPosition(lines, classifyPlay(lines), 3), "Acte I, scène 1");
});

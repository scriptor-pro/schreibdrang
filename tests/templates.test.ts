import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_MODEL,
  TEMPLATES,
  choiceMessage,
  consigneText,
  consignesByPage,
  findTemplate,
  normalizeChoice,
  normalizeTarget,
  pageOf,
  shownConsignes,
} from "../src/templates.ts";

// Pages de chaque étape pour 110 pages, recopiées de consignes-templates.md.
const PAGES_110: Record<string, number[]> = {
  "trois-actes": [1, 11, 28, 30, 41, 55, 69, 82, 99, 107],
  "quatre-actes": [1, 12, 28, 29, 55, 56, 82, 84, 99, 107],
  "huit-sequences": [1, 14, 28, 41, 55, 69, 82, 96],
  "save-the-cat": [1, 5, 6, 12, 13, 25, 30, 31, 55, 56, 75, 76, 85, 86, 110],
  "voyage-du-heros": [1, 11, 15, 21, 28, 33, 46, 55, 64, 82, 97, 106],
  truby: [1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66, 71, 76, 81, 86, 91, 96, 101, 106],
  "cinq-actes": [1, 16, 22, 44, 55, 66, 86, 88, 99, 107],
  kishotenketsu: [1, 28, 55, 82],
};

const pages = (id: string, target: number) => findTemplate(id)!.steps.map((step) => pageOf(step.part, target));

test("il y a huit modèles, dans l'ordre du cahier des charges, et 91 étapes", () => {
  assert.deepEqual(TEMPLATES.map((template) => template.id), Object.keys(PAGES_110));
  assert.equal(TEMPLATES.reduce((sum, template) => sum + template.steps.length, 0), 91);
});

test("chaque modèle a un nom, une ligne de présentation, et des consignes de 240 caractères au plus", () => {
  for (const template of TEMPLATES) {
    assert.ok(template.name && template.line, template.id);
    for (const step of template.steps) {
      assert.ok(step.name, template.id);
      assert.ok(step.text.length > 0 && consigneText(step.text, 110).length <= 240, `${template.id} : ${step.name}`);
    }
  }
});

test("pour 110 pages, chaque étape tombe sur la page de consignes-templates.md", () => {
  for (const [id, expected] of Object.entries(PAGES_110)) assert.deepEqual(pages(id, 110), expected, id);
});

test("une moitié exacte va à l'entier pair, et un repère n'est jamais sous la page 1", () => {
  assert.equal(pageOf([250, 1000], 110), 28); // 27,5
  assert.equal(pageOf([750, 1000], 110), 82); // 82,5
  assert.equal(pageOf([150, 1000], 110), 16); // 16,5
  assert.equal(pageOf([0, 1], 300), 1);
  assert.equal(pageOf([1, 110], 10), 1);
});

test("pour une autre longueur cible, les pages sont recalculées", () => {
  assert.deepEqual(pages("trois-actes", 120), [1, 12, 30, 32, 45, 60, 75, 90, 108, 116]);
  assert.deepEqual(pages("save-the-cat", 55), [1, 2, 3, 6, 6, 12, 15, 16, 28, 28, 38, 38, 42, 43, 55]);
});

test("la première étape de chaque modèle est à la page 1, quelle que soit la longueur", () => {
  for (const template of TEMPLATES) for (const target of [1, 10, 110, 999]) assert.equal(pageOf(template.steps[0].part, target), 1, template.id);
});

test("avec une longueur très courte, les pages restent dans le scénario et ne reculent pas", () => {
  for (const template of TEMPLATES) {
    for (const target of [1, 2, 10]) {
      const got = pages(template.id, target);
      assert.ok(got.every((page) => page >= 1 && page <= target), `${template.id}, ${target} pages`);
      assert.deepEqual(got, [...got].sort((a, b) => a - b), `${template.id}, ${target} pages`);
    }
  }
});

test("les numéros de page cités dans Save the Cat suivent la longueur cible", () => {
  const steps = findTemplate("save-the-cat")!.steps;
  const debat = steps.find((step) => step.name === "Débat")!;
  const passage = steps.find((step) => step.name === "Passage à l'acte II")!;
  assert.match(consigneText(debat.text, 110), /^Jusqu'à la page 25 :/);
  assert.match(consigneText(debat.text, 55), /^Jusqu'à la page 12 :/);
  assert.equal(pageOf(passage.part, 55), 12);
  // Aucune consigne ne garde une marque de page non remplacée.
  for (const template of TEMPLATES) for (const step of template.steps) assert.doesNotMatch(consigneText(step.text, 110), /[{}]/);
});

test("les consignes sont regroupées par page, dans l'ordre du modèle", () => {
  const groups = consignesByPage({ model: "truby", target: 10 });
  assert.deepEqual(
    groups.get(1)!.map((consigne) => consigne.name),
    ["1. Révélation, besoin et désir", "2. Fantôme et univers du récit", "3. Faiblesse et besoin", "4. Événement déclencheur"],
  );
  assert.equal([...groups.values()].reduce((sum, items) => sum + items.length, 0), 22);
  assert.equal(consignesByPage(NO_MODEL).size, 0);
  assert.equal(consignesByPage({ model: "inconnu", target: 110 }).size, 0);
});

test("une consigne apparaît à sa page, disparaît en dessous, et la première est toujours là", () => {
  const groups = consignesByPage({ model: "trois-actes", target: 110 });
  assert.deepEqual(shownConsignes(groups, 1).map(([page]) => page), [1]);
  assert.deepEqual(shownConsignes(groups, 10).map(([page]) => page), [1]);
  assert.deepEqual(shownConsignes(groups, 11).map(([page]) => page), [1, 11]);
  assert.deepEqual(shownConsignes(groups, 28).map(([page]) => page), [1, 11, 28]);
  assert.equal(shownConsignes(groups, 11)[1][1][0].name, "Incident déclencheur");
  assert.deepEqual(shownConsignes(groups, 500).map(([page]) => page), [1, 11, 28, 30, 41, 55, 69, 82, 99, 107]);
});

test("une longueur illisible donne 110, une longueur hors limites la borne la plus proche", () => {
  for (const raw of [NaN, "", "   ", "abc", "110,5", null, undefined, {}, [120]]) assert.equal(normalizeTarget(raw), 110, String(raw));
  for (const raw of [0, -40, "-3", 0.4, -Infinity]) assert.equal(normalizeTarget(raw), 1, String(raw));
  for (const raw of [1000, 1e9, "1100", Infinity]) assert.equal(normalizeTarget(raw), 999, String(raw));
  assert.equal(normalizeTarget(1), 1);
  assert.equal(normalizeTarget(999), 999);
  assert.equal(normalizeTarget("95"), 95);
  assert.equal(normalizeTarget(" 120 "), 120);
  assert.equal(normalizeTarget(89.6), 90);
});

test("un choix absent ou illisible donne « sans modèle, 110 pages »", () => {
  for (const raw of [undefined, null, "save-the-cat", 3, [], {}]) assert.deepEqual(normalizeChoice(raw), NO_MODEL);
  assert.deepEqual(normalizeChoice({ model: "modèle-du-futur", target: 90 }), { model: "", target: 90 });
  assert.deepEqual(normalizeChoice({ model: "truby", target: "cent" }), { model: "truby", target: 110 });
  assert.deepEqual(normalizeChoice({ model: "save-the-cat", target: "95" }), { model: "save-the-cat", target: 95 });
  assert.deepEqual(normalizeChoice({ model: 12, target: 5000 }), { model: "", target: 999 });
});

test("les consignes regroupées par page portent les numéros de page recalculés", () => {
  const texts = [...consignesByPage({ model: "save-the-cat", target: 55 }).values()].flat().map((consigne) => consigne.text);
  assert.ok(texts.some((text) => text.startsWith("Jusqu'à la page 12 :")));
  for (const text of texts) assert.doesNotMatch(text, /[{}]/);
});

test("la première consigne est montrée dès la page blanche", () => {
  const groups = consignesByPage({ model: "trois-actes", target: 110 });
  assert.deepEqual(shownConsignes(groups, 0).map(([page]) => page), [1]);
});

test("le message d'un choix nomme le modèle et accorde « page »", () => {
  assert.equal(choiceMessage({ model: "save-the-cat", target: 110 }, "110"), "Modèle appliqué : Save the Cat, pour 110 pages.");
  assert.equal(choiceMessage({ model: "truby", target: 1 }, "1"), "Modèle appliqué : Les 22 étapes de Truby, pour 1 page.");
  assert.equal(choiceMessage({ model: "", target: 110 }, "110"), "Ce scénario est sans modèle.");
});

test("le message ne signale une longueur ramenée que si elle l'a été", () => {
  const applied = "Modèle appliqué : Save the Cat, pour 110 pages.";
  for (const typed of ["110", " 110 ", "110.0", "0110", "1.1e2"]) assert.equal(choiceMessage({ model: "save-the-cat", target: 110 }, typed), applied, typed);
  for (const typed of ["", "abc", "110,5"]) {
    assert.equal(choiceMessage({ model: "save-the-cat", target: 110 }, typed), `${applied} La longueur cible est un nombre entier de 1 à 999 pages : elle est ramenée à 110.`, typed);
  }
  assert.match(choiceMessage({ model: "save-the-cat", target: 999 }, "5000"), /pour 999 pages\. La longueur cible .* ramenée à 999\.$/);
  assert.match(choiceMessage({ model: "", target: 90 }, "89.6"), /^Ce scénario est sans modèle\. La longueur cible .* ramenée à 90\.$/);
});

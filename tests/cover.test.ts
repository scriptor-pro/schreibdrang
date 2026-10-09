import assert from "node:assert/strict";
import { test } from "node:test";
import { joinNames, missingFields, normalizeAuthor, normalizeCover, titlePage } from "../src/cover.ts";

const elise = normalizeAuthor({ name: "Élise Kœnig", email: "elise@exemple.fr", phone: "06 00 00 00 00" });
const paul = normalizeAuthor({ name: "Paul Morel", email: "paul@exemple.fr", phone: "07 00 00 00 00" });

test("le titre et, pour chaque auteur, son nom, son adresse mail et son téléphone sont obligatoires", () => {
  assert.deepEqual(missingFields({ title: "Les marches", source: "", authors: [elise] }), []);
  assert.deepEqual(missingFields(normalizeCover({})), [
    { field: "title" },
    { field: "name", author: 0 },
    { field: "email", author: 0 },
    { field: "phone", author: 0 },
  ]);
});

test("un scénario écrit à plusieurs : chaque auteur est contrôlé séparément", () => {
  assert.deepEqual(missingFields({ title: "Les marches", source: "", authors: [elise, paul] }), []);
  assert.deepEqual(missingFields({ title: "Les marches", source: "", authors: [elise, { ...paul, email: "" }] }), [
    { field: "email", author: 1 },
  ]);
});

test("l'agent est facultatif ; s'il est mentionné, son prénom, son nom et son agence sont demandés", () => {
  assert.deepEqual(missingFields({ title: "Les marches", source: "", authors: [elise, { ...paul, agency: "Agence Plume" }] }), [
    { field: "agentFirstName", author: 1 },
    { field: "agentLastName", author: 1 },
  ]);
  const represented = { ...elise, agentFirstName: "Jeanne", agentLastName: "Martin", agency: "Agence Plume" };
  assert.deepEqual(missingFields({ title: "Les marches", source: "", authors: [represented, paul] }), []);
});

test("une couverture a toujours au moins un auteur ; les espaces autour d'une saisie sont retirés", () => {
  assert.equal(normalizeCover("n'importe quoi").authors.length, 1);
  assert.equal(normalizeCover({ authors: [] }).authors.length, 1);
  const cover = normalizeCover({ title: "  Les marches  ", authors: [{ name: " Élise ", email: 3 }, null] });
  assert.equal(cover.title, "Les marches");
  assert.equal(cover.source, "");
  assert.equal(normalizeCover({ source: "  « Le Horla »  " }).source, "« Le Horla »");
  assert.equal(cover.authors.length, 2);
  assert.equal(cover.authors[0].name, "Élise");
  assert.equal(cover.authors[0].email, "");
  assert.equal(cover.authors[1].name, "");
});

test("les noms des auteurs sont reliés par « et »", () => {
  assert.equal(joinNames(["A"]), "A");
  assert.equal(joinNames(["A", "B"]), "A et B");
  assert.equal(joinNames(["A", "B", "C"]), "A, B et C");
});

test("la page de titre Fountain reprend la couverture, sans ligne vide avant la fin", () => {
  const represented = { ...elise, agentFirstName: "Jeanne", agentLastName: "Martin", agency: "Agence Plume" };
  assert.equal(
    titlePage({ title: "Les marches", source: "", authors: [represented, paul] }),
    [
      "Title: Les marches",
      "Credit: écrit par",
      "Author: Élise Kœnig et Paul Morel",
      "Contact:",
      "    Élise Kœnig",
      "    elise@exemple.fr",
      "    06 00 00 00 00",
      "    Représenté par Jeanne Martin",
      "    Agence Plume",
      "    Paul Morel",
      "    paul@exemple.fr",
      "    07 00 00 00 00",
      "",
    ].join("\n"),
  );
  assert.match(
    titlePage({ title: "Les marches", source: "« Le Horla », de Guy de Maupassant", authors: [elise] }),
    /^Author: Élise Kœnig\nSource: D'après « Le Horla », de Guy de Maupassant\nContact:$/m,
  );
});

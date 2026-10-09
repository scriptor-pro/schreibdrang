import assert from "node:assert/strict";
import { test } from "node:test";
import { addRecent, formatOf, normalizeRecents, removeRecent } from "../src/recents.ts";

const now = new Date("2026-10-07T10:00:00.000Z");

test("un texte ajouté passe en tête", () => {
  const list = addRecent([{ path: "/a.md", date: "2026-10-01T00:00:00.000Z", format: "roman" }], "/b.md", "roman", now);
  assert.deepEqual(list.map((r) => r.path), ["/b.md", "/a.md"]);
  assert.equal(list[0].date, now.toISOString());
});

test("un texte déjà présent remonte en tête, sans doublon", () => {
  const list = addRecent(
    [
      { path: "/a.md", date: "2026-10-01T00:00:00.000Z", format: "roman" },
      { path: "/b.md", date: "2026-10-02T00:00:00.000Z", format: "roman" },
    ],
    "/b.md",
    "roman",
    now,
  );
  assert.deepEqual(list.map((r) => r.path), ["/b.md", "/a.md"]);
});

test("la liste ne dépasse pas cinq textes", () => {
  let list = normalizeRecents([]);
  for (const name of ["1", "2", "3", "4", "5", "6"]) list = addRecent(list, `/${name}.md`, "roman", now);
  assert.deepEqual(list.map((r) => r.path), ["/6.md", "/5.md", "/4.md", "/3.md", "/2.md"]);
});

test("un texte retiré disparaît, les autres gardent leur ordre", () => {
  const list = removeRecent(
    [
      { path: "/a.md", date: "2026-10-01T00:00:00.000Z", format: "roman" },
      { path: "/b.md", date: "2026-10-02T00:00:00.000Z", format: "roman" },
    ],
    "/a.md",
  );
  assert.deepEqual(list.map((r) => r.path), ["/b.md"]);
});

test("des données illisibles donnent une liste vide, les entrées invalides sont écartées", () => {
  assert.deepEqual(normalizeRecents("n'importe quoi"), []);
  assert.deepEqual(normalizeRecents({ path: "/a.md" }), []);
  assert.deepEqual(
    normalizeRecents([{ path: "/a.md", date: "2026-10-01T00:00:00.000Z", format: "roman" }, { path: 3 }, null, { path: "", date: "x" }]),
    [{ path: "/a.md", date: "2026-10-01T00:00:00.000Z", format: "roman" }],
  );
});

test("le format d'un texte est retenu avec lui, et change s'il est enregistré sous un autre format", () => {
  let list = addRecent([], "/a.md", "vanilla", now);
  assert.equal(formatOf(list, "/a.md"), "vanilla");
  list = addRecent(list, "/a.md", "roman", now);
  assert.equal(formatOf(list, "/a.md"), "roman");
  assert.equal(list.length, 1);
});

test("un texte inconnu, ou retenu sans format valide, est un roman", () => {
  assert.equal(formatOf([], "/inconnu.md"), "roman");
  const list = normalizeRecents([
    { path: "/ancien.md", date: "2026-10-01T00:00:00.000Z" },
    { path: "/faux.md", date: "2026-10-01T00:00:00.000Z", format: "sonnet" },
    { path: "/libre.md", date: "2026-10-01T00:00:00.000Z", format: "vanilla" },
    { path: "/film.fountain", date: "2026-10-01T00:00:00.000Z", format: "scenario" },
  ]);
  assert.deepEqual(list.map((r) => r.format), ["roman", "roman", "vanilla", "scenario"]);
});

test("un fichier .fountain inconnu est un scénario", () => {
  assert.equal(formatOf([], "/film.fountain"), "scenario");
  assert.equal(formatOf([], "/Film.FOUNTAIN"), "scenario");
  assert.equal(formatOf(addRecent([], "/film.fountain", "vanilla", now), "/film.fountain"), "vanilla");
});

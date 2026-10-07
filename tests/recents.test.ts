import assert from "node:assert/strict";
import { test } from "node:test";
import { addRecent, normalizeRecents, removeRecent } from "../src/recents.ts";

const now = new Date("2026-10-07T10:00:00.000Z");

test("un texte ajouté passe en tête", () => {
  const list = addRecent([{ path: "/a.md", date: "2026-10-01T00:00:00.000Z" }], "/b.md", now);
  assert.deepEqual(list.map((r) => r.path), ["/b.md", "/a.md"]);
  assert.equal(list[0].date, now.toISOString());
});

test("un texte déjà présent remonte en tête, sans doublon", () => {
  const list = addRecent(
    [
      { path: "/a.md", date: "2026-10-01T00:00:00.000Z" },
      { path: "/b.md", date: "2026-10-02T00:00:00.000Z" },
    ],
    "/b.md",
    now,
  );
  assert.deepEqual(list.map((r) => r.path), ["/b.md", "/a.md"]);
});

test("la liste ne dépasse pas cinq textes", () => {
  let list = normalizeRecents([]);
  for (const name of ["1", "2", "3", "4", "5", "6"]) list = addRecent(list, `/${name}.md`, now);
  assert.deepEqual(list.map((r) => r.path), ["/6.md", "/5.md", "/4.md", "/3.md", "/2.md"]);
});

test("un texte retiré disparaît, les autres gardent leur ordre", () => {
  const list = removeRecent(
    [
      { path: "/a.md", date: "2026-10-01T00:00:00.000Z" },
      { path: "/b.md", date: "2026-10-02T00:00:00.000Z" },
    ],
    "/a.md",
  );
  assert.deepEqual(list.map((r) => r.path), ["/b.md"]);
});

test("des données illisibles donnent une liste vide, les entrées invalides sont écartées", () => {
  assert.deepEqual(normalizeRecents("n'importe quoi"), []);
  assert.deepEqual(normalizeRecents({ path: "/a.md" }), []);
  assert.deepEqual(
    normalizeRecents([{ path: "/a.md", date: "2026-10-01T00:00:00.000Z" }, { path: 3 }, null, { path: "", date: "x" }]),
    [{ path: "/a.md", date: "2026-10-01T00:00:00.000Z" }],
  );
});

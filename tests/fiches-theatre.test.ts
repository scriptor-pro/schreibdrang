import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySheet } from "../src/fiches.ts";
import { speakers } from "../src/fiches-detection.ts";
import { castChange, castLine, importCast, orderedSheets, parseCast } from "../src/fiches-theatre.ts";

const handwritten =
  "PERSONNAGES\n\nANTOINE DELORME, quarante-cinq ans, architecte d'intérieur.\nLÉA, trente ans\nLa scène est à Paris.\nDEUX GARDES\n\n# ACTE I\n\n## Scène 1\n\nLÉA\nBonjour à tous, me voici enfin.\n\nANTOINE\nBonjour.\n";

test("lecture d'une liste écrite à la main", () => {
  const block = parseCast(handwritten)!;
  assert.deepEqual(block.entries, [
    { name: "ANTOINE DELORME", presentation: "quarante-cinq ans, architecte d'intérieur." },
    { name: "LÉA", presentation: "trente ans" },
    { name: "DEUX GARDES", presentation: "" },
  ]);
  assert.deepEqual(block.free, ["La scène est à Paris."]);
  assert.equal(block.from, 0);
  assert.equal(handwritten.slice(block.to).startsWith("# ACTE I"), true);
  assert.equal(parseCast("# ACTE I\n\n## Scène 1\n"), undefined);
});

test("import, puis liste tenue par l'app", () => {
  let n = 0;
  const sheets = importCast(parseCast(handwritten)!, () => `s${n++}`, 10);
  assert.deepEqual(sheets.map((s) => [s.firstName, s.lastName, s.nickname, s.castLine]), [
    ["Antoine", "Delorme", "", "quarante-cinq ans, architecte d'intérieur."],
    ["Léa", "", "", "trente ans"],
    ["", "", "Deux gardes", ""],
  ]);
  const change = castChange(handwritten, sheets, speakers(handwritten, "theatre"))!;
  const after = handwritten.slice(0, change.from) + change.insert + handwritten.slice(change.to);
  assert.equal(
    after.split("# ACTE I")[0],
    "PERSONNAGES\n\nLÉA, trente ans.\nANTOINE DELORME, quarante-cinq ans, architecte d'intérieur.\nDEUX GARDES\n\nLa scène est à Paris.\n\n",
  );
  // La partie tenue par l'app s'arrête avant les lignes libres.
  const block = parseCast(after)!;
  assert.equal(after.slice(block.from, block.generatedTo).endsWith("DEUX GARDES"), true);
});

test("une pièce sans liste en reçoit une en tête", () => {
  const play = "# ACTE I\n\n## Scène 1\n\n";
  const claire = { ...emptySheet("c", 1), firstName: "Claire", castLine: "sa sœur" };
  assert.deepEqual(castChange(play, [claire], []), { from: 0, to: 0, insert: "PERSONNAGES\n\nCLAIRE, sa sœur.\n\n" });
});

test("rien à changer", () => {
  const text = "PERSONNAGES\n\nCLAIRE\n\n# ACTE I\n";
  assert.equal(castChange(text, [{ ...emptySheet("c", 1), firstName: "Claire" }], []), undefined);
});

test("ligne de la liste", () => {
  const s = emptySheet("x", 1);
  assert.equal(castLine({ ...s, firstName: "Théo", castLine: "son frère !" }), "THÉO, son frère !");
  assert.equal(castLine({ ...s, nickname: "Madame Ferrand", castLine: "  " }), "MADAME FERRAND");
});

test("ordre : qui parle le plus, puis l'entrée en scène, puis la création", () => {
  const play = "# ACTE I\n\n## Scène 1\n\nTHÉO\nUn deux.\n\nCLAIRE\nUn deux.\n\nLÉA\nUn deux trois quatre.\n";
  const theo = { ...emptySheet("t", 3), firstName: "Théo" };
  const claire = { ...emptySheet("c", 2), firstName: "Claire" };
  const lea = { ...emptySheet("l", 1), firstName: "Léa" };
  const muet = { ...emptySheet("m", 0), firstName: "Muet" };
  const muette = { ...emptySheet("n", 5), firstName: "Muette" };
  const order = orderedSheets([muette, claire, muet, theo, lea], speakers(play, "theatre")).map((s) => s.firstName);
  assert.deepEqual(order, ["Léa", "Théo", "Claire", "Muet", "Muette"]);
});

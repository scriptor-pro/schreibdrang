import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chargerWorker } from "./aide-worker.ts";

// Un seul chargement du moteur pour ces tests : il prend environ une seconde.
const worker = chargerWorker();

function relire(id: number, text: string) {
  worker.envoyer({ type: "check", id, text });
  return worker.recus.pop() as {
    type: string;
    id: number;
    grammar: { start: number; end: number; type: string; rule: string; message: string; suggestions: string[] }[];
    spelling: { start: number; end: number; word: string }[];
  };
}

test("le moteur démarre", () => {
  assert.deepEqual(worker.recus.shift(), { type: "ready" });
});

test("deux fautes d'accord sont signalées, avec leurs suggestions", () => {
  const reply = relire(1, "Les maison sont grande.");
  assert.equal(reply.type, "checked");
  assert.equal(reply.id, 1);
  assert.deepEqual(reply.grammar.map((e) => [e.start, e.end, e.type, e.suggestions]), [
    [4, 10, "gn", ["maisons"]],
    [16, 22, "ppas", ["grandes"]],
  ]);
  assert.deepEqual(reply.spelling, []);
});

test("les apostrophes droites sont signalées en typographie", () => {
  const reply = relire(2, "C'est l'heure.");
  assert.deepEqual(reply.grammar.map((e) => [e.start, e.end, e.type, e.rule, e.suggestions]), [
    [0, 2, "apos", "apostrophe_typographique", ["C’"]],
    [6, 8, "apos", "apostrophe_typographique", ["l’"]],
  ]);
});

test("un mot inconnu est signalé, sans suggestion calculée d'avance", () => {
  const reply = relire(3, "Il marcha vers le flurmibon.");
  assert.deepEqual(reply.grammar, []);
  assert.deepEqual(reply.spelling, [{ start: 18, end: 27, word: "flurmibon" }]);
});

test("les suggestions d'un mot sont données à la demande, six au plus", () => {
  worker.envoyer({ type: "suggest", id: 4, word: "maisonn" });
  const reply = worker.recus.pop() as { type: string; id: number; suggestions: string[] };
  assert.equal(reply.type, "suggestions");
  assert.equal(reply.id, 4);
  assert.equal(reply.suggestions[0], "maison");
  assert.ok(reply.suggestions.length <= 6);
});

test("l'orthographe de référence change de dictionnaire", () => {
  worker.envoyer({ type: "dictionary", file: "fr-reform.json" });
  assert.deepEqual(relire(5, "Un événement.").spelling.map((w) => w.word), ["événement"]);
  worker.envoyer({ type: "dictionary", file: "fr-allvars.json" });
  assert.deepEqual(relire(6, "Un événement.").spelling, []);
});

test("sans les fichiers de Grammalecte, le worker dit qu'il n'a pas pu démarrer", () => {
  const vide = fs.mkdtempSync(path.join(os.tmpdir(), "schreibdrang-"));
  const sans = chargerWorker(vide);
  const message = sans.recus.shift() as { type: string; message: string };
  assert.equal(message.type, "failed");
  assert.ok(message.message.length > 0);
});

test("les mots composés absents du dictionnaire sont signalés", () => {
  const reply = relire(7, "Il prit le porte-chaussure.");
  assert.deepEqual(reply.grammar.map((e) => [e.start, e.end, e.type]), [[11, 26, "mc"]]);
});

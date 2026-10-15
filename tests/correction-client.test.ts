import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "../src/correction/moteur.ts";

function fakeWorker() {
  return {
    sent: [] as unknown[],
    onmessage: null as null | ((event: { data: unknown }) => void),
    onerror: null as null | ((event: { message: string }) => void),
    postMessage(message: unknown) {
      this.sent.push(message);
    },
    terminate() {},
  };
}

test("chaque demande reçoit la réponse qui porte son numéro", async () => {
  const worker = fakeWorker();
  const engine = new Engine(() => worker as never);
  worker.onmessage!({ data: { type: "ready" } });
  await engine.ready;
  const first = engine.check("Un.");
  const second = engine.suggest("maisonn");
  assert.deepEqual(worker.sent, [
    { type: "check", text: "Un.", id: 1 },
    { type: "suggest", word: "maisonn", id: 2 },
  ]);
  worker.onmessage!({ data: { type: "suggestions", id: 2, suggestions: ["maison"] } });
  worker.onmessage!({ data: { type: "checked", id: 1, grammar: [], spelling: [{ start: 0, end: 2, word: "Un" }] } });
  assert.deepEqual(await first, { grammar: [], spelling: [{ start: 0, end: 2, word: "Un" }] });
  assert.deepEqual(await second, ["maison"]);
});

test("un moteur qui n'a pas démarré refuse les demandes", async () => {
  const worker = fakeWorker();
  const engine = new Engine(() => worker as never);
  const pending = engine.check("Un.");
  worker.onmessage!({ data: { type: "failed", message: "fr-allvars.json est introuvable" } });
  // La demande refusée est attendue d'abord : un refus que personne
  // n'attend ferait échouer le test.
  await assert.rejects(pending, /introuvable/);
  await assert.rejects(engine.ready, /introuvable/);
  await assert.rejects(engine.check("Deux."), /introuvable/);
});

test("un worker qui ne se charge pas fait échouer le démarrage", async () => {
  const worker = fakeWorker();
  const engine = new Engine(() => worker as never);
  worker.onerror!({ message: "" });
  await assert.rejects(engine.ready, /n'a pas pu être chargé/);
});

test("l'orthographe de référence est transmise au worker", () => {
  const worker = fakeWorker();
  const engine = new Engine(() => worker as never);
  engine.setReference("reforme");
  engine.setReference("classique");
  engine.setReference("toutes");
  assert.deepEqual(worker.sent, [
    { type: "dictionary", file: "fr-reform.json" },
    { type: "dictionary", file: "fr-classic.json" },
    { type: "dictionary", file: "fr-allvars.json" },
  ]);
});

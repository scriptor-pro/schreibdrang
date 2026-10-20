import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import { Corrector, START_FAILED } from "../src/correction/correcteur.ts";
import { correctionField } from "../src/correction/etat.ts";
import type { EngineReply } from "../src/correction/remarques.ts";
import { DEFAULTS } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";

const NONE: EngineReply = { grammar: [], spelling: [] };
const MAISON: EngineReply = {
  grammar: [{ start: 4, end: 10, type: "gn", rule: "gn1", message: "Accord.", suggestions: ["maisons"] }],
  spelling: [],
};

// Laisse passer les promesses en attente.
const flush = () => new Promise((resolve) => setImmediate(resolve));

interface Options {
  format?: "roman" | "scenario" | "theatre";
  // Vrai : chaque relecture attend qu'on la libère, par release().
  slow?: boolean;
  failing?: boolean;
  // Noms des fiches personnage, acceptés par l'orthographe.
  names?: string[];
  // Réponses du moteur à une demande de nature, par mot.
  morphs?: Record<string, string[]>;
}

function setup(doc: string, replies: Record<string, EngineReply> = {}, options: Options = {}) {
  const asked: string[] = [];
  const statuses: [string, boolean][] = [];
  const held: (() => void)[] = [];
  const references: string[] = [];
  const morphsAsked: string[] = [];
  let settings: Settings = { ...DEFAULTS };
  let personal = { words: [] as string[], rules: [] as { rule: string; label: string }[] };
  const view = {
    state: EditorState.create({ doc, extensions: [correctionField] }),
    viewport: { from: 0, to: doc.length },
    dispatch(spec: TransactionSpec) {
      this.state = this.state.update(spec).state;
    },
  };
  const engine = {
    ready: options.failing ? Promise.reject(new Error("absent")) : Promise.resolve(),
    check(text: string): Promise<EngineReply> {
      asked.push(text);
      const reply = replies[text] ?? NONE;
      if (!options.slow) return Promise.resolve(reply);
      return new Promise((resolve) => held.push(() => resolve(reply)));
    },
    suggest: async () => [],
    morphs(word: string): Promise<string[]> {
      morphsAsked.push(word);
      return Promise.resolve(options.morphs?.[word] ?? []);
    },
    setReference(reference: string) {
      references.push(reference);
    },
  };
  const corrector = new Corrector({
    view,
    format: () => options.format ?? "roman",
    settings: () => settings,
    personal: () => personal,
    textData: () => ({ words: [], ignored: [] }),
    names: () => options.names ?? [],
    status: (message, error = false) => statuses.push([message, error]),
    createEngine: () => engine,
  });
  return {
    view,
    asked,
    statuses,
    references,
    morphsAsked,
    corrector,
    remarks: () => view.state.field(correctionField).remarks.map((r) => view.state.sliceDoc(r.from, r.to)),
    set: (changes: Partial<Settings>) => (settings = { ...settings, ...changes }),
    setPersonal: (value: typeof personal) => (personal = value),
    // Libère la relecture en attente la plus ancienne.
    async releaseOne() {
      held.shift()?.();
      await flush();
    },
    // Libère les relectures en attente, une à une, jusqu'à la dernière.
    async release() {
      while (held.length) {
        held.shift()!();
        await flush();
      }
    },
  };
}

const DOC = "Les maison sont grande.\n\nTout va bien.";

test("tout le texte est vérifié, et chaque remarque tombe sur son mot", async () => {
  const s = setup(DOC, { "Les maison sont grande.": MAISON });
  await s.corrector.check();
  assert.deepEqual(s.asked, ["Les maison sont grande.", "Tout va bien."]);
  assert.deepEqual(s.remarks(), ["maison"]);
  assert.deepEqual(s.statuses, [
    ["Vérification : 0 %", false],
    ["Vérification : 50 %", false],
    ["Vérification : 100 %", false],
    ["1 remarque", false],
  ]);
  assert.equal(s.corrector.running, false);
});

test("le passage affiché est relu d'abord", async () => {
  const doc = "Un.\n\nDeux.\n\nTrois.";
  const s = setup(doc);
  s.view.viewport = { from: doc.indexOf("Deux"), to: doc.indexOf("Deux") + 5 };
  await s.corrector.check();
  assert.deepEqual(s.asked, ["Deux.", "Trois.", "Un."]);
});

test("avec une sélection, seuls les paragraphes sélectionnés sont relus", async () => {
  const doc = "Un.\n\nDeux.\n\nTrois.";
  const s = setup(doc);
  s.view.dispatch({ selection: { anchor: doc.indexOf("Deux"), head: doc.indexOf("Deux") + 2 } });
  await s.corrector.check();
  assert.deepEqual(s.asked, ["Deux."]);
});

test("une nouvelle vérification ne relit que les paragraphes modifiés", async () => {
  const s = setup(DOC, { "Les maison sont grande.": MAISON });
  await s.corrector.check();
  s.view.dispatch({ changes: { from: DOC.length - 1, insert: " ici" } });
  await s.corrector.check();
  assert.deepEqual(s.asked, ["Les maison sont grande.", "Tout va bien.", "Tout va bien ici."]);
  assert.deepEqual(s.remarks(), ["maison"]);
});

test("des paragraphes identiques sont relus une fois, et chacun reçoit sa remarque", async () => {
  const s = setup("Les maison sont grande.\n\nPuis.\n\nLes maison sont grande.", { "Les maison sont grande.": MAISON });
  await s.corrector.check();
  assert.deepEqual(s.asked, ["Les maison sont grande.", "Puis."]);
  assert.deepEqual(s.remarks(), ["maison", "maison"]);
});

test("écrire pendant la vérification ne décale pas les remarques qui arrivent", async () => {
  const s = setup(DOC, { "Les maison sont grande.": MAISON }, { slow: true });
  const running = s.corrector.check();
  await flush();
  assert.equal(s.corrector.running, true);
  s.view.dispatch({ changes: { from: 0, insert: "Titre.\n\n" } });
  await s.release();
  await running;
  assert.deepEqual(s.remarks(), ["maison"]);
  assert.deepEqual(s.asked, ["Les maison sont grande.", "Tout va bien."]);
});

test("Échap arrête la vérification ; les remarques déjà trouvées restent", async () => {
  const s = setup("Les maison sont grande.\n\nDeux.\n\nTrois.", { "Les maison sont grande.": MAISON }, { slow: true });
  const running = s.corrector.check();
  await flush();
  await s.releaseOne(); // le premier paragraphe est relu ; le deuxième attend.
  assert.equal(s.corrector.stop(), true);
  await s.release();
  await running;
  assert.equal(s.corrector.running, false);
  assert.deepEqual(s.remarks(), ["maison"]);
  assert.ok(!s.asked.includes("Trois."));
  assert.deepEqual(s.statuses.at(-1), ["1 remarque", false]);
  assert.equal(s.corrector.stop(), false);
});

test("Effacer retire les remarques, sans oublier ce qui a été relu", async () => {
  const s = setup(DOC, { "Les maison sont grande.": MAISON });
  await s.corrector.check();
  s.corrector.clear();
  assert.deepEqual(s.remarks(), []);
  assert.deepEqual(s.statuses.at(-1), ["", false]);
  await s.corrector.check();
  assert.equal(s.asked.length, 2);
  assert.deepEqual(s.remarks(), ["maison"]);
});

test("une règle ignorée retire ses remarques dès que l'affichage est rafraîchi", async () => {
  const s = setup(DOC, { "Les maison sont grande.": MAISON });
  await s.corrector.check();
  s.setPersonal({ words: [], rules: [{ rule: "gn1", label: "Accord." }] });
  s.corrector.refresh();
  assert.deepEqual(s.remarks(), []);
  assert.deepEqual(s.statuses.at(-1), ["Aucune remarque", false]);
});

test("une sorte décochée disparaît, et revient quand on la recoche", async () => {
  const s = setup(DOC, { "Les maison sont grande.": MAISON });
  await s.corrector.check();
  s.set({ grammar: false });
  s.corrector.refresh();
  assert.deepEqual(s.remarks(), []);
  s.set({ grammar: true });
  s.corrector.refresh();
  assert.deepEqual(s.remarks(), ["maison"]);
});

test("scénario : les noms des personnages sont acceptés par l'orthographe", async () => {
  const doc = "MARC\nBonjour.\n\nMarc sourit.";
  const s = setup(doc, { "Marc sourit.": { grammar: [], spelling: [{ start: 0, end: 4, word: "Marc" }] } }, { format: "scenario" });
  await s.corrector.check();
  assert.deepEqual(s.remarks(), []);
});

test("si le moteur ne démarre pas, le pied de page le dit", async () => {
  const s = setup(DOC, {}, { failing: true });
  await s.corrector.check();
  assert.deepEqual(s.statuses.at(-1), [START_FAILED, true]);
  assert.equal(s.corrector.running, false);
  assert.deepEqual(s.remarks(), []);
});

test("changer d'orthographe de référence efface les remarques et oublie les réponses", async () => {
  const s = setup(DOC, { "Les maison sont grande.": MAISON });
  await s.corrector.check();
  s.corrector.setReference("reforme");
  assert.deepEqual(s.references, ["reforme"]);
  assert.deepEqual(s.remarks(), []);
  assert.deepEqual(s.statuses.at(-1), ["Orthographe de référence changée : vérifie à nouveau le texte (F7).", false]);
  await s.corrector.check();
  assert.equal(s.asked.length, 4);
});

test("pendant la frappe, le paragraphe en cours est relu une seconde après la dernière frappe", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup(DOC, { "Les maison sont grande.": MAISON });
  s.set({ checkWhileTyping: true });
  s.view.dispatch({ selection: { anchor: 3 } });
  s.corrector.typed();
  t.mock.timers.tick(999);
  s.corrector.typed();
  t.mock.timers.tick(999);
  assert.deepEqual(s.asked, []);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(s.asked, ["Les maison sont grande."]);
  assert.deepEqual(s.remarks(), ["maison"]);
  assert.deepEqual(s.statuses.at(-1), ["1 remarque", false]);
});

test("sans la case Vérifier pendant la frappe, rien n'est relu en écrivant", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup(DOC);
  s.corrector.typed();
  t.mock.timers.tick(5000);
  await flush();
  assert.deepEqual(s.asked, []);
});

test("théâtre : les noms des personnages sont acceptés par l'orthographe", async () => {
  const doc = "# ACTE I\n\n## Scène 1\n\nMARC\nBonjour.\n\nMarc sourit.";
  const s = setup(doc, { "Marc sourit.": { grammar: [], spelling: [{ start: 0, end: 4, word: "Marc" }] } }, { format: "theatre" });
  await s.corrector.check();
  assert.deepEqual(s.remarks(), []);
  assert.ok(!s.asked.includes("MARC"));
  assert.ok(!s.asked.includes("ACTE I"));
});

test("les noms des fiches personnage sont acceptés par l'orthographe", async () => {
  const doc = "Lucien Vasseur sourit.";
  const reply = { grammar: [], spelling: [{ start: 0, end: 6, word: "Lucien" }, { start: 7, end: 14, word: "Vasseur" }] };
  const s = setup(doc, { [doc]: reply }, { names: ["Lucien Vasseur"] });
  await s.corrector.check();
  assert.deepEqual(s.remarks(), []);
});

test("la nature d'un mot est demandée une fois au moteur", async () => {
  const s = setup("", {}, { morphs: { Lucien: [">Lucien/:M1:m:i/*"], Lyon: [">Lyon/:MP:e:i#C/*"] } });
  assert.equal(await s.corrector.nature("Lucien"), "prenom");
  assert.equal(await s.corrector.nature("Lucien"), "prenom");
  assert.equal(await s.corrector.nature("Lyon"), "lieu");
  assert.equal(await s.corrector.nature("Zorglub"), "inconnu");
  assert.deepEqual(s.morphsAsked, ["Lucien", "Lyon", "Zorglub"]);
});

test("sans moteur, la nature d'un mot est inconnue", async () => {
  const s = setup("", {}, { failing: true });
  assert.equal(await s.corrector.nature("Lucien"), undefined);
});

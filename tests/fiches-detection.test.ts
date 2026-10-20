import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySheet } from "../src/fiches.ts";
import type { Sheet } from "../src/fiches.ts";
import {
  isGroup,
  isSentenceStart,
  mayBeCharacter,
  natureOf,
  occurrences,
  sheetFromLabel,
  speakerSheet,
  speakers,
  wordBefore,
} from "../src/fiches-detection.ts";

test("nature d'un mot", () => {
  assert.equal(natureOf([">Lucien/:M1:m:i/*"]), "prenom");
  assert.equal(natureOf([">Marie/:M1:f:i/*", ">marier/:V1__t_q_zz:E:2s/*"]), "prenom");
  assert.equal(natureOf([">Lyon/:MP:e:i#C/*"]), "lieu");
  assert.equal(natureOf([">dehors/:N:m:i/*", ">dehors/:W/*"]), "courant");
  assert.equal(natureOf([]), "inconnu");
});

test("début de phrase", () => {
  const t = "Il vit Lucien. Lucien rit. « Lucien ! »\n— Lucien, viens.";
  assert.equal(isSentenceStart(t, t.indexOf("Lucien")), false);
  assert.equal(isSentenceStart(t, t.indexOf("Lucien rit")), true);
  assert.equal(isSentenceStart(t, t.indexOf("Lucien !")), true);
  assert.equal(isSentenceStart(t, t.lastIndexOf("Lucien")), true);
  assert.equal(isSentenceStart(t, 0), true);
});

test("mot qui finit avant le curseur", () => {
  assert.deepEqual(wordBefore("la voiture de Lucien ", 20), { word: "Lucien", from: 14, to: 20 });
  assert.equal(wordBefore("Lucien", 3), undefined);
  assert.equal(wordBefore("la voiture, ", 12), undefined);
});

test("occurrences", () => {
  assert.equal(occurrences("Lucien, Lucienne, lucien. LUCIEN. Lucien", "Lucien"), 2);
});

test("candidat", () => {
  const marie = { ...emptySheet("m", 1), firstName: "Marie" };
  assert.equal(mayBeCharacter("Lucien", [marie], []), true);
  assert.equal(mayBeCharacter("Marie", [marie], []), false);
  assert.equal(mayBeCharacter("Lucien", [], ["lucien"]), false);
  assert.equal(mayBeCharacter("SNCF", [], []), false);
  assert.equal(mayBeCharacter("A", [], []), false);
  assert.equal(mayBeCharacter("lucien", [], []), false);
});

test("personnages qui parlent, au théâtre", () => {
  const play = "# ACTE I\n\n## Scène 1\n\nCLAIRE\nTu rentres tard ce soir.\n\nTHÉO\n(Il pose son manteau.)\nJ'ai marché.\n\nCLAIRE (à part)\nMenteur.\n";
  const list = speakers(play, "theatre");
  assert.deepEqual(list.map((s) => [s.label, s.words, s.first]), [["CLAIRE", 6, 0], ["THÉO", 2, 1]]);
  assert.equal(list[0].replies.length, 2);
  assert.equal(list[0].replies[0].where, "Acte I, scène 1");
  assert.deepEqual(list[1].replies[0].parts.map((p) => p.stage), [true, false]);
  assert.equal(play.slice(list[0].replies[0].from, list[0].replies[0].to), "Tu rentres tard ce soir.");
});

test("au scénario, la mention entre parenthèses ne crée pas un autre personnage", () => {
  const script = "INT. CUISINE - JOUR\n\nÉLISE\nBonjour.\n\nÉLISE (V.O.)\nAu revoir.\n";
  const list = speakers(script, "scenario");
  assert.deepEqual(list.map((s) => [s.label, s.words]), [["ÉLISE", 3]]);
  assert.equal(list[0].replies[0].where, "INT. CUISINE - JOUR");
});

test("ELISE sans accent est Élise", () => {
  const elise = { ...emptySheet("e", 1), firstName: "Élise" };
  assert.equal(speakerSheet({ label: "ELISE", words: 0, first: 0, replies: [] }, [elise]), elise);
  const antoine = { ...emptySheet("a", 1), firstName: "Antoine", lastName: "Delorme" };
  assert.equal(speakerSheet({ label: "ANTOINE", words: 0, first: 0, replies: [] }, [antoine]), antoine);
  assert.equal(speakerSheet({ label: "ANTOINE DELORME", words: 0, first: 0, replies: [] }, [antoine]), antoine);
  assert.equal(speakerSheet({ label: "MAXIME", words: 0, first: 0, replies: [] }, [antoine]), undefined);
});

test("fiche à partir d'un nom en capitales", () => {
  const pick = (s: Sheet) => [s.firstName, s.lastName, s.nickname];
  assert.deepEqual(pick(sheetFromLabel("ANTOINE DELORME", "a", 1)), ["Antoine", "Delorme", ""]);
  assert.deepEqual(pick(sheetFromLabel("MAXIME", "a", 1)), ["Maxime", "", ""]);
  assert.deepEqual(pick(sheetFromLabel("MADAME FERRAND", "a", 1)), ["", "", "Madame Ferrand"]);
  assert.deepEqual(pick(sheetFromLabel("DEUX GARDES", "a", 1)), ["", "", "Deux gardes"]);
  assert.deepEqual(pick(sheetFromLabel("LA COMTESSE", "a", 1)), ["", "", "La comtesse"]);
  assert.deepEqual(pick(sheetFromLabel("JEAN-PIERRE", "a", 1)), ["Jean-Pierre", "", ""]);
});

test("deux personnages qui parlent ensemble ne sont pas un troisième", () => {
  const antoine = { ...emptySheet("a", 1), firstName: "Antoine", lastName: "Delorme" };
  const josephine = { ...emptySheet("j", 2), firstName: "Joséphine" };
  const sheets = [antoine, josephine];
  const speaker = (label: string) => ({ label, words: 0, first: 0, replies: [] });
  assert.equal(isGroup(speaker("ANTOINE ET JOSÉPHINE"), sheets), true);
  assert.equal(isGroup(speaker("ANTOINE & JOSÉPHINE"), sheets), true);
  assert.equal(isGroup(speaker("ANTOINE, JOSÉPHINE"), sheets), true);
  assert.equal(isGroup(speaker("ANTOINE ET MAXIME"), sheets), false);
  assert.equal(isGroup(speaker("ANTOINE"), sheets), false);
  // Sans fiche : chacun des noms parle aussi seul dans la pièce.
  const others = [speaker("ANTOINE"), speaker("JOSÉPHINE")];
  assert.equal(isGroup(speaker("ANTOINE ET JOSÉPHINE"), [], others), true);
  assert.equal(isGroup(speaker("ANTOINE ET MAXIME"), [], others), false);
});

test("les personnages qui parlent se trouvent vite dans une longue pièce", () => {
  let play = "";
  for (let act = 1; act <= 5; act++) {
    play += `# ACTE ${act}\n\n`;
    for (let scene = 1; scene <= 8; scene++) {
      play += `## Scène ${scene}\n\n`;
      for (let i = 0; i < 100; i++) play += `${i % 2 ? "CLAIRE" : "THÉO"}\nUne réplique de quelques mots, pas plus.\n\n`;
    }
  }
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const list = speakers(play, "theatre");
    best = Math.min(best, performance.now() - start);
    assert.equal(list[0].replies.length, 2000);
    assert.equal(list[0].replies[1999].where, "Acte 5, scène 8");
  }
  assert.ok(best < 150, `${Math.round(best)} ms`);
});

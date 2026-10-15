// Correcteur de Schreibdrang : Grammalecte 2.3.0 (licence GPL 3) dans un
// worker classique. Il charge le moteur une fois, puis répond aux messages de
// la page dans leur ordre d'arrivée :
// - { type: "check", id, text } → { type: "checked", id, grammar, spelling } ;
// - { type: "suggest", id, word } → { type: "suggestions", id, suggestions } ;
// - { type: "dictionary", file } change le dictionnaire principal, sans réponse.
// Au démarrage, il envoie { type: "ready" }, ou { type: "failed", message }.
"use strict";

const ROOT = self.location.origin + "/grammalecte/";
const SCRIPTS = [
  "graphspell/helpers.js",
  "graphspell/str_transform.js",
  "graphspell/char_player.js",
  "graphspell/lexgraph_fr.js",
  "graphspell/ibdawg.js",
  "graphspell/spellchecker.js",
  "text.js",
  "graphspell/tokenizer.js",
  "fr/conj.js",
  "fr/mfsp.js",
  "fr/phonet.js",
  "fr/cregex.js",
  "fr/gc_options.js",
  "fr/gc_functions.js",
  "fr/gc_rules.js",
  "fr/gc_rules_graph.js",
  "fr/gc_engine.js",
];
// Nombre de suggestions proposées pour un mot inconnu.
const SUGGESTIONS = 6;

// Le correcteur orthographique de Grammalecte ; nul si le moteur n'a pas démarré.
let speller = null;

function data(file) {
  const text = helpers.loadFile(ROOT + file);
  if (text === null) throw new Error(`${file} est introuvable`);
  return text;
}

try {
  importScripts(...SCRIPTS.map((script) => "/grammalecte/" + script));
  conj.init(data("fr/conj_data.json"));
  phonet.init(data("fr/phonet_data.json"));
  mfsp.init(data("fr/mfsp_data.json"));
  gc_engine.load("JavaScript", "aHSL", ROOT + "graphspell/_dictionaries");
  // Options activées en plus des réglages par défaut de Grammalecte : les
  // mots composés absents du dictionnaire (décidé le 15 octobre 2026).
  gc_engine.setOption("mc", true);
  speller = gc_engine.getSpellChecker();
  if (!speller) throw new Error("le dictionnaire n'a pas pu être chargé");
  postMessage({ type: "ready" });
} catch (error) {
  postMessage({ type: "failed", message: String((error && error.message) || error) });
}

function check(text) {
  const grammar = gc_engine.parse(text, "FR", false, null, false, false).map((error) => ({
    start: error.nStart,
    end: error.nEnd,
    type: error.sType,
    rule: error.sRuleId,
    message: error.sMessage,
    suggestions: error.aSuggestions || [],
  }));
  const spelling = speller.parseParagraph(text).map((token) => ({ start: token.nStart, end: token.nEnd, word: token.sValue }));
  return { grammar, spelling };
}

function suggest(word) {
  const found = [];
  for (const group of speller.suggest(word, SUGGESTIONS)) {
    for (const suggestion of group) if (!found.includes(suggestion)) found.push(suggestion);
  }
  return found.slice(0, SUGGESTIONS);
}

onmessage = (event) => {
  const message = event.data;
  if (!speller) return;
  if (message.type === "dictionary") {
    speller.setMainDictionary(message.file, ROOT + "graphspell/_dictionaries");
  } else if (message.type === "check") {
    // Un passage que le moteur ne sait pas lire reçoit une réponse vide :
    // la page n'attend jamais en vain.
    let reply = { grammar: [], spelling: [] };
    try {
      reply = check(message.text);
    } catch {}
    postMessage({ type: "checked", id: message.id, ...reply });
  } else if (message.type === "suggest") {
    let suggestions = [];
    try {
      suggestions = suggest(message.word);
    } catch {}
    postMessage({ type: "suggestions", id: message.id, suggestions });
  }
};

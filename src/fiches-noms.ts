// Les noms des fiches dans le texte : où ils se trouvent, et lesquels
// proposer pendant la frappe. Module pur.
//
// Un mot du texte correspond à un mot d'un nom s'il est écrit comme lui, ou
// avec sa première lettre en capitale (en début de phrase), ou entièrement
// en capitales ; dans ce dernier cas seulement, les accents ne comptent pas
// (« ELISE » est Élise). « marie », le verbe, n'est donc pas Marie.

import { sheetNames } from "./fiches.ts";
import type { Sheet } from "./fiches.ts";

export interface NameHit {
  from: number;
  to: number;
  // Toutes les fiches qui portent ce nom.
  ids: string[];
}

export interface NameCompletion {
  label: string;
  ids: string[];
}

// Un mot : des lettres, avec des traits d'union à l'intérieur ; l'apostrophe
// sépare (« d'Antoine »).
const WORD = /[\p{L}\p{M}]+(?:[-‑][\p{L}\p{M}]+)*/gu;
// Ce qui peut séparer les mots d'un même nom.
const GAP = /^[ \t  ]+$/;

// Capitales, sans accents : pour comparer sans tenir compte ni des unes ni
// des autres.
export function fold(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

function isAllCaps(word: string): boolean {
  return !/\p{Ll}/u.test(word) && /\p{Lu}/u.test(word);
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function wordsMatch(textWord: string, nameWord: string): boolean {
  if (textWord === nameWord) return true;
  if (textWord === capitalized(nameWord)) return true;
  return isAllCaps(textWord) && fold(textWord) === fold(nameWord);
}

const ARTICLES_AND_TITLES = new Set(
  [
    "le", "la", "les", "l", "un", "une", "des", "du", "de",
    "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
    "madame", "monsieur", "mademoiselle", "mme", "m", "mlle", "maître", "docteur", "dr",
    "père", "mère", "frère", "sœur", "oncle", "tante",
    "comte", "comtesse", "baron", "baronne", "duc", "duchesse", "marquis", "marquise",
    "roi", "reine", "prince", "princesse", "capitaine", "sergent", "abbé",
  ].map(fold),
);

// Un nom qui commence par un article, un nombre ou un titre (« Madame
// Ferrand », « Deux gardes ») n'est pas un prénom suivi d'un nom.
export function startsWithArticleOrTitle(name: string): boolean {
  const first = name.trim().split(/[\s'’.]+/)[0] ?? "";
  return /^\d/.test(first) || ARTICLES_AND_TITLES.has(fold(first));
}

interface Phrase {
  words: string[];
  ids: string[];
}

// Les noms des fiches, rangés par le premier mot, les plus longs d'abord.
function phraseIndex(sheets: Sheet[]): Map<string, Phrase[]> {
  const byText = new Map<string, Phrase>();
  for (const sheet of sheets) {
    for (const name of sheetNames(sheet)) {
      const words = name.match(WORD);
      if (!words) continue;
      const key = words.join(" ");
      const phrase = byText.get(key);
      if (!phrase) byText.set(key, { words, ids: [sheet.id] });
      else if (!phrase.ids.includes(sheet.id)) phrase.ids.push(sheet.id);
    }
  }
  // Chaque nom se cherche par les formes possibles de son premier mot : sa
  // graphie, celle d'un début de phrase, et en capitales, avec ou sans accents.
  const index = new Map<string, Phrase[]>();
  for (const phrase of byText.values()) {
    const first = phrase.words[0];
    for (const form of new Set([first, capitalized(first), first.toUpperCase(), fold(first)])) {
      const list = index.get(form) ?? [];
      list.push(phrase);
      index.set(form, list);
    }
  }
  for (const list of index.values()) list.sort((a, b) => b.words.length - a.words.length);
  return index;
}

const LETTER = "[\\p{L}\\p{M}]";
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Les noms des fiches présents dans un texte (ou un passage qui commence à
// `offset` dans le document). La correspondance la plus longue l'emporte, sans
// chevauchement. Une seule expression régulière trouve les premiers mots : sur
// un roman entier, c'est bien plus rapide que de comparer chaque mot.
export function findNames(text: string, sheets: Sheet[], offset = 0): NameHit[] {
  const index = phraseIndex(sheets);
  if (index.size === 0) return [];
  const forms = [...index.keys()].sort((a, b) => b.length - a.length).map(escape).join("|");
  const firsts = new RegExp(`(?<!${LETTER}|${LETTER}[-‑])(?:${forms})(?!${LETTER}|[-‑]${LETTER})`, "gu");
  const next = new RegExp(WORD.source, "gu");
  const hits: NameHit[] = [];
  firsts.lastIndex = 0;
  for (let match = firsts.exec(text); match; match = firsts.exec(text)) {
    const from = match.index;
    let found: { to: number; ids: string[] } | undefined;
    for (const phrase of index.get(match[0]) ?? []) {
      let to = from + match[0].length;
      const ok = phrase.words.every((word, j) => {
        if (j === 0) return wordsMatch(match[0], word);
        next.lastIndex = to;
        const following = next.exec(text);
        if (!following || !GAP.test(text.slice(to, following.index)) || !wordsMatch(following[0], word)) return false;
        to = following.index + following[0].length;
        return true;
      });
      if (ok) {
        found = { to, ids: [...phrase.ids] };
        break;
      }
    }
    if (!found) continue;
    hits.push({ from: offset + from, to: offset + found.to, ids: found.ids });
    firsts.lastIndex = found.to;
  }
  return hits;
}

// Le nom qui contient la position, bornes comprises.
export function hitAt(hits: NameHit[], pos: number): NameHit | undefined {
  return hits.find((hit) => hit.from <= pos && pos <= hit.to);
}

// Les noms qui commencent par ce que l'on vient de taper, à partir de deux
// lettres, sans tenir compte des capitales ni des accents.
export function completionsFor(prefix: string, sheets: Sheet[]): NameCompletion[] {
  if ((prefix.match(/\p{L}/gu) ?? []).length < 2) return [];
  const wanted = fold(prefix);
  const byLabel = new Map<string, string[]>();
  for (const sheet of sheets) {
    for (const name of sheetNames(sheet)) {
      if (!fold(name).startsWith(wanted)) continue;
      const ids = byLabel.get(name) ?? [];
      if (!ids.includes(sheet.id)) ids.push(sheet.id);
      byLabel.set(name, ids);
    }
  }
  return [...byLabel]
    .map(([label, ids]) => ({ label, ids }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

// Ce qui fait proposer une fiche : les mots qui ressemblent à un nom de
// personnage, en prose ; les personnages qui parlent, au théâtre et au
// scénario, avec leurs répliques. Module pur.

import { emptySheet, sheetNames } from "./fiches.ts";
import type { Sheet } from "./fiches.ts";
import { fold, startsWithArticleOrTitle, wordsMatch } from "./fiches-noms.ts";
import { classifyPlay, playPosition } from "./theatre.ts";
import { classifyLines, sceneTitle } from "./fountain.ts";

// Nature d'un mot d'après le dictionnaire de Grammalecte : prénom ou
// patronyme (:M1, :M2), nom de lieu (:MP), mot courant, ou mot inconnu.
export type WordNature = "prenom" | "lieu" | "courant" | "inconnu";

export function natureOf(morphs: string[]): WordNature {
  if (morphs.length === 0) return "inconnu";
  if (morphs.some((morph) => /:M[12](?![\p{L}\d])/u.test(morph))) return "prenom";
  if (morphs.some((morph) => morph.includes(":MP"))) return "lieu";
  return "courant";
}

export interface Candidate {
  word: string;
  from: number;
  to: number;
}

const LETTER = /[\p{L}\p{M}]/u;
const WORD_END = /[\p{L}\p{M}]+(?:[-‑][\p{L}\p{M}]+)*$/u;

// Le mot qui se termine juste avant `pos`, si `pos` n'est pas au milieu d'un mot.
export function wordBefore(text: string, pos: number): Candidate | undefined {
  if (pos < text.length && LETTER.test(text[pos])) return undefined;
  const match = WORD_END.exec(text.slice(Math.max(0, pos - 100), pos));
  if (!match) return undefined;
  return { word: match[0], from: pos - match[0].length, to: pos };
}

const SPACE = /[ \t  ]/;
const CLOSING = /[»”"’)\]]/;

// Vrai si le mot qui commence à `from` ouvre une phrase : début du texte ou
// d'une ligne, après une ponctuation finale, après « « », ou après un tiret de
// dialogue en début de ligne. Un nom propre s'y reconnaît mal : sa majuscule
// ne dit rien.
export function isSentenceStart(text: string, from: number): boolean {
  let i = from - 1;
  while (i >= 0 && SPACE.test(text[i])) i--;
  if (i < 0 || text[i] === "\n" || text[i] === "«" || text[i] === "“") return true;
  if (text[i] === "—" || text[i] === "–") {
    let j = i - 1;
    while (j >= 0 && SPACE.test(text[j])) j--;
    return j < 0 || text[j] === "\n";
  }
  while (i >= 0 && (CLOSING.test(text[i]) || SPACE.test(text[i]))) i--;
  return i >= 0 && /[.!?…]/.test(text[i]);
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Le nombre de fois où le mot apparaît, avec la même graphie, en mot entier.
export function occurrences(text: string, word: string): number {
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}]|[\\p{L}\\p{M}][-‑])${escape(word)}(?![\\p{L}\\p{M}]|[-‑][\\p{L}\\p{M}])`, "gu");
  return (text.match(pattern) ?? []).length;
}

// La proposition vient à la troisième apparition du mot.
export const PROPOSAL_THRESHOLD = 3;

// Vrai si le mot peut être un nom de personnage sans fiche : une majuscule
// initiale, pas tout en capitales (un sigle), au moins deux lettres, aucune
// fiche qui le porte, et pas écarté par l'auteur.
export function mayBeCharacter(word: string, sheets: Sheet[], ignored: string[]): boolean {
  if ((word.match(/\p{L}/gu) ?? []).length < 2) return false;
  if (!/^\p{Lu}/u.test(word) || !/\p{Ll}/u.test(word)) return false;
  const folded = fold(word);
  if (ignored.some((item) => fold(item) === folded)) return false;
  return !sheets.some((sheet) => sheetNames(sheet).some((name) => name.split(/\s+/).some((part) => wordsMatch(word, part))));
}

export interface ReplyPart {
  text: string;
  stage: boolean;
}

export interface Reply {
  from: number;
  to: number;
  where: string;
  parts: ReplyPart[];
}

export interface Speaker {
  label: string;
  words: number;
  first: number;
  replies: Reply[];
}

// Le nom au-dessus d'une réplique, sans « @ » ni mention entre parenthèses.
function speakerLabel(line: string): string {
  return line.trim().replace(/^@/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

const countWords = (text: string) => text.split(/\s+/).filter((part) => /\p{L}/u.test(part)).length;

// Les personnages qui parlent, dans l'ordre de leur première réplique, avec
// leurs répliques et le nombre de mots qu'ils prononcent (didascalies exclues).
export function speakers(text: string, format: "scenario" | "theatre"): Speaker[] {
  const lines = text.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const play = format === "theatre" ? classifyPlay(lines) : undefined;
  const screen = format === "scenario" ? classifyLines(lines) : undefined;
  const kind = (i: number): string => (play ? play[i] : screen![i]);
  const isStage = (i: number) => kind(i) === (play ? "stage" : "parenthetical");

  const byKey = new Map<string, Speaker>();
  let scene = "";
  // Au théâtre, la position (« Acte II, scène 3 ») est calculée une fois par
  // scène : la chercher pour chaque réplique reparcourrait toute la pièce.
  let where: string | undefined;
  let replyCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (screen && kind(i) === "scene") scene = sceneTitle(lines[i].trim());
    if (play && (kind(i) === "act" || kind(i) === "scene")) where = undefined;
    if (kind(i) !== "character") continue;
    const label = speakerLabel(lines[i]);
    if (!label) continue;
    const parts: ReplyPart[] = [];
    let j = i + 1;
    while (j < lines.length && (kind(j) === "dialogue" || isStage(j))) {
      parts.push({ text: lines[j].trim(), stage: isStage(j) });
      j++;
    }
    if (parts.length === 0) continue;
    const key = fold(label);
    let speaker = byKey.get(key);
    if (!speaker) {
      speaker = { label, words: 0, first: replyCount, replies: [] };
      byKey.set(key, speaker);
    }
    replyCount++;
    speaker.words += parts.filter((part) => !part.stage).reduce((sum, part) => sum + countWords(part.text), 0);
    if (play) where ??= playPosition(lines, play, i);
    speaker.replies.push({ from: starts[i + 1], to: starts[j - 1] + lines[j - 1].length, where: play ? where! : scene, parts });
    i = j - 1;
  }
  return [...byKey.values()];
}

// Les mots d'un nom correspondent un à un.
function phraseMatches(label: string, name: string): boolean {
  const a = label.split(/\s+/).filter(Boolean);
  const b = name.split(/\s+/).filter(Boolean);
  return a.length === b.length && a.every((word, i) => wordsMatch(word, b[i]));
}

// La fiche d'un personnage qui parle : par l'un de ses noms, par « Prénom Nom »,
// ou par son prénom seul (« ANTOINE » est Antoine Delorme).
export function speakerSheet(speaker: Speaker, sheets: Sheet[]): Sheet | undefined {
  return sheets.find((sheet) => {
    const full = [sheet.firstName.trim(), sheet.lastName.trim()].filter(Boolean).join(" ");
    return [...sheetNames(sheet), full].some((name) => name && phraseMatches(speaker.label, name));
  });
}

// Une réplique dite à plusieurs (« ANTOINE ET JOSÉPHINE ») : chaque nom a sa
// fiche, ou parle aussi seul dans le texte ; l'ensemble n'est pas un
// personnage de plus.
export function isGroup(speaker: Speaker, sheets: Sheet[], others: Speaker[] = []): boolean {
  const parts = speaker.label.split(/\s+(?:ET|&)\s+|\s*,\s*/u).filter(Boolean);
  if (parts.length < 2) return false;
  const alone = new Set(others.map((other) => fold(other.label)));
  return parts.every((part) => alone.has(fold(part)) || speakerSheet({ ...speaker, label: part }, sheets) !== undefined);
}

const ARTICLE_OR_NUMBER = /^(le|la|les|l|un|une|des|du|de|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|\d+)$/iu;

const capitalize = (word: string) =>
  word
    .toLocaleLowerCase("fr")
    .split(/([-‑])/)
    .map((part) => part.charAt(0).toLocaleUpperCase("fr") + part.slice(1))
    .join("");

// Une fiche à partir d'un nom écrit en capitales (« ANTOINE DELORME »). Un nom
// qui commence par un article, un nombre ou un titre va entier en surnom ; un
// mot qui suit un article ou un nombre y reste en minuscules (« Deux gardes »,
// « La comtesse »), les autres prennent une majuscule (« Madame Ferrand »).
export function sheetFromLabel(label: string, id: string, created: number): Sheet {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const sheet = emptySheet(id, created);
  if (words.length === 0) return sheet;
  const written = words.map((word, i) =>
    i > 0 && ARTICLE_OR_NUMBER.test(words[i - 1]) ? word.toLocaleLowerCase("fr") : capitalize(word),
  );
  if (startsWithArticleOrTitle(label)) sheet.nickname = written.join(" ");
  else if (written.length === 1) sheet.firstName = written[0];
  else {
    sheet.firstName = written[0];
    sheet.lastName = written.slice(1).join(" ");
  }
  return sheet;
}

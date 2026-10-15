// Correction : les réponses du moteur, traduites en remarques placées dans le
// document, et filtrées selon les réglages, les dictionnaires et ce que
// l'utilisateur a ignoré.

import { toDocument } from "./extraction.ts";
import type { Passage } from "./extraction.ts";

export type Kind = "grammaire" | "orthographe" | "typographie";

export const KIND_LABELS: Record<Kind, string> = {
  grammaire: "Grammaire",
  orthographe: "Orthographe",
  typographie: "Typographie",
};

// Réponse du moteur pour un passage (voir public/correction/worker.js). Les
// positions sont celles du texte du passage, la fin exclue.
export interface GrammarError {
  start: number;
  end: number;
  type: string;
  rule: string;
  message: string;
  suggestions: string[];
}

export interface UnknownWord {
  start: number;
  end: number;
  word: string;
}

export interface EngineReply {
  grammar: GrammarError[];
  spelling: UnknownWord[];
}

export interface Remark {
  // Place dans le document.
  from: number;
  to: number;
  kind: Kind;
  message: string;
  // Vide pour un mot inconnu : ses suggestions sont demandées à l'ouverture
  // de la bulle, parce qu'elles prennent du temps à trouver.
  suggestions: string[];
  // Identifiant de la règle de Grammalecte ; SPELLING_RULE pour un mot inconnu.
  rule: string;
  // Nom de la règle dans la liste des règles ignorées.
  label: string;
  // Ce que le moteur a relevé, tel qu'il l'a lu.
  excerpt: string;
  // Identité de la remarque pour « Ignorer » ; voir remarkKey.
  key: string;
  // Le passage où elle se trouve : le modifier la fait disparaître.
  passage: { from: number; to: number };
}

export interface RemarkFilter {
  kinds: Record<Kind, boolean>;
  ignoredRules: ReadonlySet<string>;
  ignoredRemarks: ReadonlySet<string>;
  accepts(word: string): boolean;
}

export const SPELLING_RULE = "orthographe";
export const SPELLING_MESSAGE = "Ce mot n'est pas dans le dictionnaire.";
// Type des remarques de Grammalecte sur les mots composés inconnus.
const COMPOUND = "mc";

// Options du groupe « Typographie » de Grammalecte (lStructOpt, dans
// fr/gc_options.js). Les autres options sont de la grammaire.
const TYPOGRAPHY = new Set([
  "typo", "apos", "eepi", "esp", "tab", "nbsp", "unit", "tu", "maj",
  "minis", "num", "nf", "virg", "poncfin", "ocr", "chim", "liga", "mapos",
]);

export function kindOf(type: string): Kind {
  return TYPOGRAPHY.has(type) ? "typographie" : "grammaire";
}

// Une remarque ignorée est reconnue par sa règle, ce qu'elle relève et les
// douze caractères qui l'entourent de chaque côté : elle le reste quand le
// paragraphe change ailleurs, ou quand il change de place.
const CONTEXT = 12;

export function remarkKey(rule: string, text: string, start: number, end: number): string {
  return [rule, text.slice(Math.max(0, start - CONTEXT), start), text.slice(start, end), text.slice(end, end + CONTEXT)].join("\u0000");
}

// Les dictionnaires ne tiennent compte ni de la casse ni de la forme de
// l'apostrophe.
function fold(word: string): string {
  return word.replace(/'/g, "’").toLocaleLowerCase("fr");
}

export function wordAcceptor(...lists: Iterable<string>[]): (word: string) => boolean {
  const known = new Set<string>();
  for (const list of lists) for (const word of list) known.add(fold(word));
  return (word) => known.has(fold(word));
}

export function remarksOf(passage: Passage, reply: EngineReply, filter: RemarkFilter): Remark[] {
  const remarks: Remark[] = [];
  const add = (start: number, end: number, kind: Kind, rule: string, message: string, suggestions: string[]) => {
    const key = remarkKey(rule, passage.text, start, end);
    if (!filter.kinds[kind] || filter.ignoredRules.has(rule) || filter.ignoredRemarks.has(key)) return;
    const { from, to } = toDocument(passage, start, end);
    remarks.push({
      from,
      to,
      kind,
      message,
      suggestions,
      rule,
      label: message,
      excerpt: passage.text.slice(start, end),
      key,
      passage: { from: passage.from, to: passage.to },
    });
  };
  // Un mot composé absent du dictionnaire (option « mc ») est traité comme un
  // mot inconnu, et une seule fois s'il l'est déjà par l'orthographe.
  const unknown = [...reply.spelling];
  for (const error of reply.grammar) {
    if (error.type === COMPOUND) {
      if (!unknown.some((word) => word.start === error.start && word.end === error.end)) {
        unknown.push({ start: error.start, end: error.end, word: passage.text.slice(error.start, error.end) });
      }
    } else {
      add(error.start, error.end, kindOf(error.type), error.rule, error.message, error.suggestions);
    }
  }
  for (const word of unknown) {
    if (!filter.accepts(word.word)) add(word.start, word.end, "orthographe", SPELLING_RULE, SPELLING_MESSAGE, []);
  }
  return remarks.sort((a, b) => a.from - b.from || a.to - b.to);
}

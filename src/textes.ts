// Ce que l'app retient de chaque fichier, par son chemin et sans limite de
// nombre : le format du texte, que le fichier lui-même ne dit pas. Ce module
// n'accède à la page que dans loadTexts et saveTexts.

import { FORMATS } from "./recents.ts";
import type { Format, Recent } from "./recents.ts";

export type Texts = Record<string, Format>;

const KEY = "schreibdrang.textes";

// Nature d'un fichier d'après son extension : un scénario en Fountain, un
// texte que l'app lit tel quel, ou un document à convertir.
export function fileKind(path: string): "fountain" | "texte" | "import" {
  if (/\.fountain$/i.test(path)) return "fountain";
  return /\.(odt|docx)$/i.test(path) ? "import" : "texte";
}

// Nom proposé pour enregistrer un document importé : le sien, sans extension.
export function importedName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
}

// Format retenu pour ce fichier ; rien s'il est inconnu. Un fichier .fountain
// est toujours un scénario.
export function knownFormat(texts: Texts, path: string): Format | undefined {
  if (fileKind(path) === "fountain") return "scenario";
  return Object.prototype.hasOwnProperty.call(texts, path) ? texts[path] : undefined;
}

export function withFormat(texts: Texts, path: string, format: Format): Texts {
  return { ...texts, [path]: format };
}

// Reprend les formats retenus jusque-là avec les textes récents.
export function withRecents(texts: Texts, recents: Recent[]): Texts {
  const next = { ...texts };
  for (const recent of recents) if (!Object.prototype.hasOwnProperty.call(next, recent.path)) next[recent.path] = recent.format;
  return next;
}

// Des données illisibles donnent une liste vide ; une entrée invalide est écartée.
export function normalizeTexts(raw: unknown): Texts {
  const texts: Texts = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return texts;
  for (const [path, format] of Object.entries(raw)) {
    if (path && FORMATS.includes(format as Format)) texts[path] = format as Format;
  }
  return texts;
}

export function loadTexts(): Texts {
  try {
    return normalizeTexts(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return {};
  }
}

export function saveTexts(texts: Texts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(texts));
  } catch {
    // Stockage plein ou indisponible : les formats restent valables pour la session.
  }
}

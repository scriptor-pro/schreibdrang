// Textes récents, du plus récent au plus ancien, conservés dans le stockage
// local. Ce module n'accède à la page que dans loadRecents et saveRecents.

// Formats de texte disponibles dans le prototype.
export type Format = "roman" | "vanilla" | "scenario";

export interface Recent {
  path: string;
  // Date de la dernière ouverture ou du dernier enregistrement, au format ISO.
  date: string;
  // Le fichier lui-même ne dit pas son format : il est retenu ici.
  format: Format;
}

export const MAX_RECENTS = 5;

const KEY = "schreibdrang.recents";

export function addRecent(list: Recent[], path: string, format: Format, now: Date): Recent[] {
  return [{ path, date: now.toISOString(), format }, ...removeRecent(list, path)].slice(0, MAX_RECENTS);
}

// Format retenu pour un texte. Un texte inconnu est un scénario si son nom se
// termine par « .fountain », un roman sinon.
export function formatOf(list: Recent[], path: string): Format {
  const known = list.find((recent) => recent.path === path)?.format;
  return known ?? (/\.fountain$/i.test(path) ? "scenario" : "roman");
}

export function removeRecent(list: Recent[], path: string): Recent[] {
  return list.filter((recent) => recent.path !== path);
}

// Des données illisibles donnent une liste vide ; une entrée invalide est écartée.
export function normalizeRecents(raw: unknown): Recent[] {
  if (!Array.isArray(raw)) return [];
  const list: Recent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { path, date, format } = entry as Record<string, unknown>;
    if (typeof path !== "string" || !path || typeof date !== "string" || Number.isNaN(Date.parse(date))) continue;
    list.push({ path, date, format: format === "vanilla" || format === "scenario" ? format : "roman" });
  }
  return list.slice(0, MAX_RECENTS);
}

export function loadRecents(): Recent[] {
  try {
    return normalizeRecents(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return [];
  }
}

export function saveRecents(list: Recent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Stockage plein ou indisponible : la liste reste valable pour la session.
  }
}

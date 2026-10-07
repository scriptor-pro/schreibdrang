// Textes récents, du plus récent au plus ancien, conservés dans le stockage
// local. Ce module n'accède à la page que dans loadRecents et saveRecents.

export interface Recent {
  path: string;
  // Date de la dernière ouverture ou du dernier enregistrement, au format ISO.
  date: string;
}

export const MAX_RECENTS = 5;

const KEY = "schreibdrang.recents";

export function addRecent(list: Recent[], path: string, now: Date): Recent[] {
  return [{ path, date: now.toISOString() }, ...removeRecent(list, path)].slice(0, MAX_RECENTS);
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
    const { path, date } = entry as Record<string, unknown>;
    if (typeof path !== "string" || !path || typeof date !== "string" || Number.isNaN(Date.parse(date))) continue;
    list.push({ path, date });
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

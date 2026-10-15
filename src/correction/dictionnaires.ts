// Correction : ce que l'app retient. Pour l'utilisateur, sur cet ordinateur :
// son dictionnaire (« Tous mes textes ») et les règles qu'il a coupées. Pour
// chaque texte, par son chemin, comme son format : le dictionnaire du texte
// et les remarques ignorées une à une. Ce module n'accède à la page que dans
// les fonctions load… et save….

export interface IgnoredRule {
  rule: string;
  // Le message de la règle, pour la liste des paramètres.
  label: string;
}

export interface Personal {
  words: string[];
  rules: IgnoredRule[];
}

export interface TextData {
  words: string[];
  // Clés des remarques ignorées (voir remarkKey, dans remarques.ts).
  ignored: string[];
}

export type TextsData = Record<string, TextData>;

const PERSONAL_KEY = "schreibdrang.correction";
const TEXTS_KEY = "schreibdrang.correction-textes";

const collator = new Intl.Collator("fr");

export function emptyTextData(): TextData {
  return { words: [], ignored: [] };
}

// Ajoute un mot ou une clé, sans doublon, dans l'ordre alphabétique.
export function withItem(list: string[], item: string): string[] {
  return list.includes(item) ? list : [...list, item].sort(collator.compare);
}

export function withoutItem(list: string[], item: string): string[] {
  return list.filter((entry) => entry !== item);
}

export function withRule(rules: IgnoredRule[], rule: IgnoredRule): IgnoredRule[] {
  return rules.some((entry) => entry.rule === rule.rule) ? rules : [...rules, rule];
}

export function withoutRule(rules: IgnoredRule[], id: string): IgnoredRule[] {
  return rules.filter((entry) => entry.rule !== id);
}

function strings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((item): item is string => typeof item === "string" && item !== ""))];
}

function record(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

// Des données illisibles donnent des listes vides ; une entrée invalide est écartée.
export function normalizePersonal(raw: unknown): Personal {
  const data = record(raw) ?? {};
  const rules: IgnoredRule[] = [];
  if (Array.isArray(data.rules)) {
    for (const item of data.rules) {
      const entry = record(item);
      if (entry && typeof entry.rule === "string" && entry.rule && typeof entry.label === "string") {
        if (!rules.some((rule) => rule.rule === entry.rule)) rules.push({ rule: entry.rule, label: entry.label });
      }
    }
  }
  return { words: strings(data.words), rules };
}

export function normalizeTextsData(raw: unknown): TextsData {
  const texts: TextsData = {};
  for (const [path, value] of Object.entries(record(raw) ?? {})) {
    const data = record(value);
    if (path && data) texts[path] = { words: strings(data.words), ignored: strings(data.ignored) };
  }
  return texts;
}

export function knownTextData(texts: TextsData, path: string): TextData {
  return Object.prototype.hasOwnProperty.call(texts, path) ? texts[path] : emptyTextData();
}

export function withTextData(texts: TextsData, path: string, data: TextData): TextsData {
  return { ...texts, [path]: data };
}

export function loadPersonal(): Personal {
  try {
    return normalizePersonal(JSON.parse(localStorage.getItem(PERSONAL_KEY) ?? "null"));
  } catch {
    return { words: [], rules: [] };
  }
}

export function savePersonal(personal: Personal) {
  try {
    localStorage.setItem(PERSONAL_KEY, JSON.stringify(personal));
  } catch {
    // Stockage plein ou indisponible : le dictionnaire reste valable pour la session.
  }
}

export function loadTextsData(): TextsData {
  try {
    return normalizeTextsData(JSON.parse(localStorage.getItem(TEXTS_KEY) ?? "null"));
  } catch {
    return {};
  }
}

export function saveTextsData(texts: TextsData) {
  try {
    localStorage.setItem(TEXTS_KEY, JSON.stringify(texts));
  } catch {
    // Stockage plein ou indisponible : les données restent valables pour la session.
  }
}

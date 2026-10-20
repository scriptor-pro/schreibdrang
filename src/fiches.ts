// Fiches personnage : la fiche, et le fichier où elles sont rangées, à côté
// du texte (`mon-roman.md` → `mon-roman.fiches.json`). Module pur : il ne lit
// ni n'écrit rien lui-même.

export type Importance = "" | "principal" | "secondaire" | "figurant";

// Un lien vers une autre fiche, par son identifiant.
export interface Relation {
  to: string;
  nature: string;
}

export interface CustomField {
  label: string;
  value: string;
}

export interface Sheet {
  id: string;
  created: number;
  // En-tête
  firstName: string;
  lastName: string;
  nickname: string;
  importance: Importance;
  functions: string[];
  summary: string;
  castLine: string; // présentation dans la liste des personnages
  // Identité
  age: string;
  job: string;
  place: string;
  physical: string;
  voice: string;
  // Moteur dramatique
  desire: string;
  need: string;
  flaw: string;
  wound: string;
  belief: string;
  fear: string;
  secret: string;
  // Arc
  arcStart: string;
  arcEnd: string;
  arcChange: string;
  relations: Relation[];
  notes: string;
  custom: CustomField[];
}

export interface SheetsFile {
  version: 1;
  personnages: Sheet[];
  // Mots écartés par « Ignorer » : l'app ne les propose plus.
  ecartes: string[];
  // Théâtre : null si la question n'a jamais été posée, true si l'app tient
  // la liste en tête de pièce, false si l'auteur a refusé.
  listeTenue: boolean | null;
}

export const DRAMATIC_FUNCTIONS: readonly string[] = [
  "protagoniste",
  "antagoniste",
  "allié",
  "mentor",
  "faux allié",
  "faux adversaire",
  "intérêt amoureux",
  "confident",
  "faire-valoir",
  "messager",
  "gardien du seuil",
  "tentateur",
  "arbitre",
  "ressort comique",
  "objet de la quête",
  "narrateur",
  "personnage de sous-intrigue",
];

const TEXT_FIELDS = [
  "firstName",
  "lastName",
  "nickname",
  "summary",
  "castLine",
  "age",
  "job",
  "place",
  "physical",
  "voice",
  "desire",
  "need",
  "flaw",
  "wound",
  "belief",
  "fear",
  "secret",
  "arcStart",
  "arcEnd",
  "arcChange",
  "notes",
] as const;

const IMPORTANCES: Importance[] = ["", "principal", "secondaire", "figurant"];

export function emptySheet(id: string, created: number): Sheet {
  const sheet = { id, created, importance: "" as Importance, functions: [], relations: [], custom: [] } as unknown as Sheet;
  for (const field of TEXT_FIELDS) sheet[field] = "";
  return sheet;
}

export function emptySheetsFile(): SheetsFile {
  return { version: 1, personnages: [], ecartes: [], listeTenue: null };
}

export function newSheetId(): string {
  return crypto.randomUUID();
}

// Prénom, nom et surnom renseignés, sans les espaces autour.
export function sheetNames(sheet: Sheet): string[] {
  return [sheet.firstName, sheet.lastName, sheet.nickname].map((name) => name.trim()).filter(Boolean);
}

export function isValidSheet(sheet: Sheet): boolean {
  return sheetNames(sheet).length > 0;
}

// « Prénom Nom », ou le surnom s'il n'y a ni l'un ni l'autre.
export function displayName(sheet: Sheet): string {
  const full = [sheet.firstName.trim(), sheet.lastName.trim()].filter(Boolean).join(" ");
  return full || sheet.nickname.trim();
}

// Un figurant n'a par défaut que l'en-tête et l'identité.
export function isFullSheet(sheet: Sheet): boolean {
  return sheet.importance !== "figurant";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function normalizeSheet(raw: unknown): Sheet | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return undefined;
  const sheet = emptySheet(raw.id, typeof raw.created === "number" ? raw.created : 0);
  for (const field of TEXT_FIELDS) if (typeof raw[field] === "string") sheet[field] = raw[field] as string;
  if (IMPORTANCES.includes(raw.importance as Importance)) sheet.importance = raw.importance as Importance;
  sheet.functions = strings(raw.functions);
  if (Array.isArray(raw.relations)) {
    sheet.relations = raw.relations
      .filter((r): r is Record<string, unknown> => isObject(r) && typeof r.to === "string" && typeof r.nature === "string")
      .map((r) => ({ to: r.to as string, nature: r.nature as string }));
  }
  if (Array.isArray(raw.custom)) {
    sheet.custom = raw.custom
      .filter((c): c is Record<string, unknown> => isObject(c) && typeof c.label === "string" && typeof c.value === "string")
      .map((c) => ({ label: c.label as string, value: c.value as string }));
  }
  return isValidSheet(sheet) ? sheet : undefined;
}

// Le contenu d'un fichier de fiches ; undefined s'il est illisible ou d'une
// version que cette app ne connaît pas : il ne doit alors pas être écrasé.
export function normalizeSheetsFile(raw: string): SheetsFile | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObject(data) || data.version !== 1) return undefined;
  const file = emptySheetsFile();
  if (Array.isArray(data.personnages)) {
    for (const item of data.personnages) {
      const sheet = normalizeSheet(item);
      if (sheet) file.personnages.push(sheet);
    }
  }
  file.ecartes = strings(data.ecartes);
  if (typeof data.listeTenue === "boolean") file.listeTenue = data.listeTenue;
  return file;
}

export function serializeSheets(file: SheetsFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

// Le fichier des fiches d'un texte : son nom, sans extension, suivi de
// `.fiches.json`, dans le même dossier.
export function sidecarPath(textPath: string): string {
  const cut = Math.max(textPath.lastIndexOf("/"), textPath.lastIndexOf("\\"));
  const dir = textPath.slice(0, cut + 1);
  const name = textPath.slice(cut + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${dir}${stem}.fiches.json`;
}

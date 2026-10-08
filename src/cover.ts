// Page de couverture d'un scénario : le titre, les auteurs, et les champs qui
// manquent. Ce module n'accède à la page que dans loadCover et saveCover.

export interface Author {
  name: string;
  email: string;
  phone: string;
  // L'agent est facultatif, et propre à chaque auteur.
  agentFirstName: string;
  agentLastName: string;
  agency: string;
  agencyEmail: string;
  agencyPhone: string;
}

export interface Cover {
  title: string;
  // Un scénario peut être écrit à plusieurs : au moins un auteur.
  authors: Author[];
}

export type AuthorField = keyof Author;

// Un champ à remplir : le titre, ou un champ d'un auteur (compté à partir de 0).
export type Missing = { field: "title" } | { field: AuthorField; author: number };

export const AUTHOR_FIELDS: AuthorField[] = [
  "name",
  "email",
  "phone",
  "agentFirstName",
  "agentLastName",
  "agency",
  "agencyEmail",
  "agencyPhone",
];

const REQUIRED: AuthorField[] = ["name", "email", "phone"];
const AGENT: AuthorField[] = ["agentFirstName", "agentLastName", "agency", "agencyEmail", "agencyPhone"];
const AGENT_REQUIRED: AuthorField[] = ["agentFirstName", "agentLastName", "agency"];

const KEY = "schreibdrang.couverture";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeAuthor(raw: unknown): Author {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const author = {} as Author;
  for (const field of AUTHOR_FIELDS) author[field] = text(source[field]);
  return author;
}

export function normalizeCover(raw: unknown): Cover {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const authors = Array.isArray(source.authors) ? source.authors.map(normalizeAuthor) : [];
  return { title: text(source.title), authors: authors.length ? authors : [normalizeAuthor(null)] };
}

// Champs à remplir avant de créer la couverture, dans l'ordre de la boîte.
export function missingFields(cover: Cover): Missing[] {
  const missing: Missing[] = cover.title ? [] : [{ field: "title" }];
  cover.authors.forEach((author, index) => {
    const required = AGENT.some((field) => author[field]) ? [...REQUIRED, ...AGENT_REQUIRED] : REQUIRED;
    for (const field of required) if (!author[field]) missing.push({ field, author: index });
  });
  return missing;
}

// Les auteurs sont retenus d'une fois sur l'autre ; le titre, propre à chaque
// scénario, ne l'est pas.
export function loadCover(): Cover {
  try {
    return { ...normalizeCover(JSON.parse(localStorage.getItem(KEY) ?? "null")), title: "" };
  } catch {
    return normalizeCover(null);
  }
}

export function saveCover(cover: Cover) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...cover, title: "" }));
  } catch {
    // Stockage plein ou indisponible : la couverture est créée quand même.
  }
}

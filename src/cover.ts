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
  // Œuvre dont le scénario est l'adaptation (« d'après… ») ; facultatif.
  source: string;
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
  return {
    title: text(source.title),
    source: text(source.source),
    authors: authors.length ? authors : [normalizeAuthor(null)],
  };
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

// « A », « A et B », « A, B et C ».
export function joinNames(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

// Page de titre d'un fichier Fountain, tirée de la couverture. Elle ne peut
// pas contenir de ligne vide : c'est une ligne vide qui la termine.
export function titlePage(cover: Cover): string {
  const contact = cover.authors.flatMap((author) => {
    const agent = `${author.agentFirstName} ${author.agentLastName}`.trim();
    return [
      author.name,
      author.email,
      author.phone,
      agent && `Représenté par ${agent}`,
      author.agency,
      author.agencyEmail,
      author.agencyPhone,
    ].filter(Boolean);
  });
  return [
    `Title: ${cover.title}`,
    "Credit: écrit par",
    `Author: ${joinNames(cover.authors.map((author) => author.name))}`,
    ...(cover.source ? [`Source: D'après ${cover.source}`] : []),
    "Contact:",
    ...contact.map((line) => `    ${line}`),
    "",
  ].join("\n");
}

// Les auteurs sont retenus d'une fois sur l'autre. Le titre et l'œuvre
// d'origine sont propres à chaque scénario : ils ne sont rendus que pour le
// fichier où ils ont été saisis.
export function loadCover(path: string | undefined): Cover {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const cover = normalizeCover(raw);
    const same = Boolean(path) && raw?.titlePath === path;
    return { ...cover, title: same ? cover.title : "", source: same ? cover.source : "" };
  } catch {
    return normalizeCover(null);
  }
}

export function saveCover(cover: Cover, path: string | undefined) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...cover, titlePath: path ?? "" }));
  } catch {
    // Stockage plein ou indisponible : la couverture est créée quand même.
  }
}

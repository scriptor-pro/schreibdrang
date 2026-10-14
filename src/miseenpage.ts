// Mise en page d'un texte vanilla : l'interligne et les quatre marges, que
// l'app retient pour chaque fichier, par son chemin. Ce module n'accède à la
// page que dans loadSetups et saveSetups.

export interface PageSetup {
  // Interligne, en nombre de lignes.
  spacing: number;
  // Marges, en centimètres.
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const DEFAULT_SETUP: PageSetup = { spacing: 1.5, top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 };

export const MIN_SPACING = 1;
export const MAX_SPACING = 3;
export const MIN_MARGIN = 0;
export const MAX_MARGIN = 7;

const FIELDS = ["spacing", "top", "bottom", "left", "right"] as const;

// Un nombre tel qu'on le tape, avec une virgule ou un point ; NaN sinon.
export function parseDecimal(text: string): number {
  const typed = text.trim();
  return /^\d+([.,]\d+)?$/.test(typed) ? Number(typed.replace(",", ".")) : NaN;
}

// Un nombre tel qu'on l'écrit, avec une virgule.
export function formatDecimal(value: number): string {
  return String(value).replace(".", ",");
}

// La valeur d'un champ, arrondie au dixième ; rien si elle est illisible ou
// hors limites.
function fieldValue(field: (typeof FIELDS)[number], raw: unknown): number | undefined {
  const typed = typeof raw === "string" ? parseDecimal(raw) : typeof raw === "number" ? raw : NaN;
  const value = Math.round(typed * 10) / 10;
  const [min, max] = field === "spacing" ? [MIN_SPACING, MAX_SPACING] : [MIN_MARGIN, MAX_MARGIN];
  return value >= min && value <= max ? value : undefined;
}

// Des données absentes, illisibles ou hors limites donnent les valeurs par
// défaut, champ par champ.
export function normalizeSetup(raw: unknown): PageSetup {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const setup = { ...DEFAULT_SETUP };
  for (const field of FIELDS) setup[field] = fieldValue(field, data[field]) ?? DEFAULT_SETUP[field];
  return setup;
}

// Ce que l'app répond après un réglage : un message court, que le pied de
// page montre en entier. Elle dit si une saisie, telle qu'elle a été tapée, a
// dû être ramenée à sa valeur par défaut.
export function setupMessage(typed: Record<(typeof FIELDS)[number], string>): string {
  const kept = FIELDS.every((field) => fieldValue(field, typed[field]) !== undefined);
  return kept ? "Mise en page appliquée." : "Mise en page appliquée, sauf une valeur hors limites, remise par défaut.";
}

// Largeur d'une feuille A4, en centimètres.
const SHEET_WIDTH = 21;

// Un centimètre, en corps du texte : la feuille est dessinée pour un texte en
// corps 12, et suit donc la taille du texte choisie dans les paramètres.
const EM_PER_CM = 72 / 2.54 / 12;

const em = (cm: number) => `${(cm * EM_PER_CM).toFixed(3)}em`;

// La feuille à l'écran : sa largeur, l'interligne et les marges du haut, de
// gauche et de droite ; la marge du bas ne se voit qu'à l'export. Dans une
// fenêtre plus étroite que la feuille, les marges rétrécissent avec elle.
export function sheetStyle(setup: PageSetup) {
  const side = (cm: number) => `min(${em(cm)}, ${Number(((cm / SHEET_WIDTH) * 100).toFixed(3))}%)`;
  return {
    lineHeight: String(setup.spacing),
    maxWidth: em(SHEET_WIDTH),
    paddingTop: em(setup.top),
    paddingLeft: side(setup.left),
    paddingRight: side(setup.right),
  };
}

// Mise en page retenue pour chaque texte vanilla.
export type Setups = Record<string, PageSetup>;

const KEY = "schreibdrang.mises-en-page";

// Mise en page retenue pour ce fichier ; celle par défaut s'il n'y en a pas.
export function knownSetup(setups: Setups, path: string): PageSetup {
  return Object.prototype.hasOwnProperty.call(setups, path) ? setups[path] : { ...DEFAULT_SETUP };
}

export function withSetup(setups: Setups, path: string, setup: PageSetup): Setups {
  return { ...setups, [path]: setup };
}

// Des données illisibles donnent une liste vide ; une mise en page invalide
// est ramenée aux valeurs par défaut.
export function normalizeSetups(raw: unknown): Setups {
  const setups: Setups = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return setups;
  for (const [path, setup] of Object.entries(raw)) if (path) setups[path] = normalizeSetup(setup);
  return setups;
}

export function loadSetups(): Setups {
  try {
    return normalizeSetups(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return {};
  }
}

export function saveSetups(setups: Setups) {
  try {
    localStorage.setItem(KEY, JSON.stringify(setups));
  } catch {
    // Stockage plein ou indisponible : les mises en page restent valables pour la session.
  }
}

// Réglages de l'app, conservés dans le stockage local. Ce module n'accède à
// la page que dans loadSettings, saveSettings et applySettings.

// Orthographe de référence : les trois dictionnaires de Grammalecte.
export type Reference = "toutes" | "classique" | "reforme";

export interface Settings {
  theme: "systeme" | "clair" | "sombre";
  // Nom d'une police à chasse fixe installée ; vide pour Courier Prime.
  font: string;
  // Taille du texte de l'éditeur, en pixels.
  size: number;
  startup: "accueil" | "dernier";
  // Vrai si l'éditeur signale les espaces insécables par un petit « ° ».
  nbsp: boolean;
  // Vrai si l'éditeur montre les consignes du modèle d'un scénario.
  consignes: boolean;
  // Correction : relire le paragraphe en cours pendant la frappe.
  checkWhileTyping: boolean;
  // Correction : les sortes de remarques montrées.
  grammar: boolean;
  spelling: boolean;
  typography: boolean;
  // Correction : le dictionnaire principal de Grammalecte.
  reference: Reference;
  // Vrai si l'apostrophe droite tapée devient l'apostrophe typographique.
  apostrophe: boolean;
  // Vrai si les espaces insécables sont posées à la frappe (voir espaces.ts).
  spaces: boolean;
  // Fiches personnage : proposer les noms pendant la frappe.
  nameCompletion: boolean;
}

export const DEFAULTS: Settings = {
  theme: "systeme",
  font: "",
  size: 17,
  startup: "accueil",
  nbsp: true,
  consignes: true,
  checkWhileTyping: false,
  grammar: true,
  spelling: true,
  typography: true,
  reference: "toutes",
  apostrophe: true,
  spaces: true,
  nameCompletion: true,
};

export const MIN_SIZE = 14;
export const MAX_SIZE = 24;

const KEY = "schreibdrang.reglages";
const DEFAULT_STACK = '"Courier Prime App", "Courier New", Courier, monospace';

// Des données absentes, illisibles ou hors limites donnent les valeurs par
// défaut, réglage par réglage.
export function normalizeSettings(raw: unknown): Settings {
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const theme = data.theme === "clair" || data.theme === "sombre" ? data.theme : DEFAULTS.theme;
  const font = typeof data.font === "string" ? data.font : DEFAULTS.font;
  const rounded = typeof data.size === "number" ? Math.round(data.size) : NaN;
  const size = rounded >= MIN_SIZE && rounded <= MAX_SIZE ? rounded : DEFAULTS.size;
  const startup = data.startup === "dernier" ? "dernier" : DEFAULTS.startup;
  const nbsp = typeof data.nbsp === "boolean" ? data.nbsp : DEFAULTS.nbsp;
  const consignes = typeof data.consignes === "boolean" ? data.consignes : DEFAULTS.consignes;
  const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  const checkWhileTyping = flag(data.checkWhileTyping, DEFAULTS.checkWhileTyping);
  const grammar = flag(data.grammar, DEFAULTS.grammar);
  const spelling = flag(data.spelling, DEFAULTS.spelling);
  const typography = flag(data.typography, DEFAULTS.typography);
  const reference = data.reference === "classique" || data.reference === "reforme" ? data.reference : DEFAULTS.reference;
  const apostrophe = flag(data.apostrophe, DEFAULTS.apostrophe);
  const spaces = flag(data.spaces, DEFAULTS.spaces);
  const nameCompletion = flag(data.nameCompletion, DEFAULTS.nameCompletion);
  return { theme, font, size, startup, nbsp, consignes, checkWhileTyping, grammar, spelling, typography, reference, apostrophe, spaces, nameCompletion };
}

export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Stockage plein ou indisponible : le réglage reste valable pour la session.
  }
}

export function applySettings(settings: Settings) {
  const root = document.documentElement;
  if (settings.theme === "systeme") delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  // Courier Prime suit toujours la police choisie : si celle-ci n'est plus
  // installée, le texte reste en chasse fixe.
  const font = settings.font.replace(/["\\]/g, "");
  root.style.setProperty("--font-text", font ? `"${font}", ${DEFAULT_STACK}` : DEFAULT_STACK);
  root.style.setProperty("--text-size", `${settings.size}px`);
}

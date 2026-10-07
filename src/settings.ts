// Réglages de l'app, conservés dans le stockage local. Ce module n'accède à
// la page que dans loadSettings, saveSettings et applySettings.

export interface Settings {
  theme: "systeme" | "clair" | "sombre";
  // Nom d'une police à chasse fixe installée ; vide pour Courier Prime.
  font: string;
  // Taille du texte de l'éditeur, en pixels.
  size: number;
  startup: "accueil" | "dernier";
}

export const DEFAULTS: Settings = { theme: "systeme", font: "", size: 17, startup: "accueil" };

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
  return { theme, font, size, startup };
}

export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
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

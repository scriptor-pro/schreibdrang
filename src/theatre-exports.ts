// Mise en page et format de page choisis au dernier export de chaque pièce,
// retenus par le chemin du fichier, comme son format. Ce module n'accède à la
// page que dans loadPlayExports et savePlayExports.

import type { PlayLayout, PlayPage } from "./theatre-pandoc.ts";

export interface PlayExport {
  layout: PlayLayout;
  page: PlayPage;
}

export const DEFAULT_PLAY_EXPORT: PlayExport = { layout: "manuscrit", page: "a4" };

export type PlayExports = Record<string, PlayExport>;

const KEY = "schreibdrang.export-theatre";

// Des données illisibles donnent une liste vide ; une entrée invalide est écartée.
export function normalizePlayExports(raw: unknown): PlayExports {
  const exports: PlayExports = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return exports;
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!path || !value || typeof value !== "object") continue;
    const { layout, page } = value as Record<string, unknown>;
    if ((layout === "manuscrit" || layout === "edition") && (page === "a4" || page === "a5")) exports[path] = { layout, page };
  }
  return exports;
}

export function knownPlayExport(exports: PlayExports, path: string | undefined): PlayExport {
  return path !== undefined && Object.prototype.hasOwnProperty.call(exports, path) ? exports[path] : DEFAULT_PLAY_EXPORT;
}

export function withPlayExport(exports: PlayExports, path: string, value: PlayExport): PlayExports {
  return { ...exports, [path]: value };
}

export function loadPlayExports(): PlayExports {
  try {
    return normalizePlayExports(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return {};
  }
}

export function savePlayExports(exports: PlayExports) {
  try {
    localStorage.setItem(KEY, JSON.stringify(exports));
  } catch {
    // Stockage plein ou indisponible : le choix reste valable pour la session.
  }
}

// Comment s'exporte une pièce dans ce format : selon sa mise en page (PDF,
// Word, OpenDocument), ou telle quelle (Markdown, texte brut), sans que
// Pandoc ne recolle les noms à leurs répliques.
export function playExportKind(format: string): "layout" | "raw" {
  return format === "pdf" || format === "docx" || format === "odt" ? "layout" : "raw";
}

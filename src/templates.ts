// Modèles de structure d'un scénario : la page de chaque étape pour une
// longueur cible, et les consignes à montrer. Ce module n'accède pas à la page.

import { TEMPLATES } from "./consignes.ts";

export { TEMPLATES };

// Part du texte où commence une étape : numérateur et dénominateur.
export type Part = readonly [number, number];

export interface Step {
  name: string;
  part: Part;
  // Consigne affichée ; « {25} » y désigne la page 25 d'un scénario de 110 pages.
  text: string;
}

export interface Template {
  id: string;
  name: string;
  // Une ligne de présentation, pour la boîte de choix.
  line: string;
  steps: Step[];
}

// Modèle choisi pour un scénario, et longueur visée en pages. Sans modèle,
// l'identifiant est vide.
export interface Choice {
  model: string;
  target: number;
}

export interface Consigne {
  name: string;
  text: string;
}

export const DEFAULT_TARGET = 110;
export const MIN_TARGET = 1;
export const MAX_TARGET = 999;

export const NO_MODEL: Choice = { model: "", target: DEFAULT_TARGET };

export function findTemplate(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

// Page d'un repère : la part du texte multipliée par la longueur cible,
// arrondie à l'entier le plus proche. Une moitié exacte va à l'entier pair,
// comme dans consignes-templates.md ; le calcul reste en nombres entiers.
export function pageOf(part: Part, target: number): number {
  const product = part[0] * target;
  const whole = Math.floor(product / part[1]);
  const rest = 2 * (product - whole * part[1]);
  const up = rest > part[1] || (rest === part[1] && whole % 2 === 1);
  return Math.max(1, up ? whole + 1 : whole);
}

// Texte d'une consigne pour une longueur cible : les pages citées sont recalculées.
export function consigneText(text: string, target: number): string {
  return text.replace(/\{(\d+)\}/g, (_, page: string) => String(pageOf([Number(page), 110], target)));
}

// Une longueur illisible donne la longueur par défaut ; une longueur hors
// limites, la borne la plus proche.
export function normalizeTarget(raw: unknown): number {
  const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_TARGET;
  return Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(value)));
}

// Un choix absent ou illisible donne « sans modèle » ; un modèle inconnu aussi.
export function normalizeChoice(raw: unknown): Choice {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...NO_MODEL };
  const { model, target } = raw as Record<string, unknown>;
  return { model: typeof model === "string" && findTemplate(model) ? model : "", target: normalizeTarget(target) };
}

// Consignes d'un choix, regroupées par page et dans l'ordre du modèle.
export function consignesByPage(choice: Choice): Map<number, Consigne[]> {
  const groups = new Map<number, Consigne[]>();
  for (const step of findTemplate(choice.model)?.steps ?? []) {
    const page = pageOf(step.part, choice.target);
    const consigne = { name: step.name, text: consigneText(step.text, choice.target) };
    const group = groups.get(page);
    if (group) group.push(consigne);
    else groups.set(page, [consigne]);
  }
  return groups;
}

// Consignes à montrer pour un scénario de ce nombre de pages : celles des
// pages déjà atteintes, dans l'ordre des pages.
export function shownConsignes(groups: Map<number, Consigne[]>, pages: number): [number, Consigne[]][] {
  return [...groups].filter(([page]) => page <= Math.max(1, pages)).sort(([a], [b]) => a - b);
}

// Ce que l'app répond après un choix. Elle dit si la longueur saisie, telle
// qu'elle a été tapée, a dû être ramenée à une autre valeur.
export function choiceMessage(choice: Choice, typed: string): string {
  const template = findTemplate(choice.model);
  const pages = choice.target > 1 ? "pages" : "page";
  const applied = template ? `Modèle appliqué : ${template.name}, pour ${choice.target} ${pages}.` : "Ce scénario est sans modèle.";
  const kept = typed.trim() !== "" && Number(typed) === choice.target;
  return kept ? applied : `${applied} La longueur cible est un nombre entier de 1 à 999 pages : elle est ramenée à ${choice.target}.`;
}

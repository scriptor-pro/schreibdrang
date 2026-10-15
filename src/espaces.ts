// Espaces insécables à la frappe, selon l'usage français : une espace fine
// insécable avant ; ! ?, une espace insécable avant : et », après « et
// autour du « h » de l'heure (« 15 h 35 »). Seule l'espace que l'on vient de
// taper est remplacée : rien n'est ajouté là où l'on n'en a pas mis, si bien
// que « Title: » d'une page de titre ou une adresse restent tels quels.

export const NBSP = " ";
export const NNBSP = " ";

// Ce que devient la saisie : les `back` derniers caractères avant le curseur
// et le texte tapé sont remplacés par `insert`.
export interface SpacingChange {
  back: number;
  insert: string;
}

// `before` : le texte de la ligne avant le curseur ; `typed` : ce qui est tapé.
export function frenchSpacing(before: string, typed: string): SpacingChange | null {
  if (typed.length !== 1) return null;
  if (before.endsWith(" ")) {
    if (";!?".includes(typed)) return { back: 1, insert: NNBSP + typed };
    if (":»".includes(typed)) return { back: 1, insert: NBSP + typed };
    // L'heure : « 15 h », puis « 15 h 35 ».
    if (typed === "h" && /\d $/.test(before)) return { back: 1, insert: NBSP + typed };
    if (/\d/.test(typed) && /\d h $/.test(before)) return { back: 1, insert: NBSP + typed };
    return null;
  }
  if (typed === " " && before.endsWith("«")) return { back: 0, insert: NBSP };
  // L'heure tapée sans espaces : « 15h35 » devient « 15 h 35 ».
  if (/\d/.test(typed) && /\dh$/.test(before)) return { back: 1, insert: `${NBSP}h${NBSP}${typed}` };
  return null;
}

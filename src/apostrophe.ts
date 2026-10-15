// Apostrophe typographique : l'apostrophe droite tapée au clavier devient
// « ’ », celle du français imprimé. Le texte déjà écrit n'est pas modifié.

export function typographicApostrophes(text: string): string {
  return text.replace(/'/g, "’");
}

// Correction > Utiliser l'apostrophe typographique : les apostrophes droites
// du texte, à remplacer en une seule modification, que Ctrl+Z annule.
export function apostropheChanges(text: string): { from: number; to: number; insert: string }[] {
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let index = text.indexOf("'"); index !== -1; index = text.indexOf("'", index + 1)) {
    changes.push({ from: index, to: index + 1, insert: "’" });
  }
  return changes;
}

const fmt = new Intl.NumberFormat("fr-FR");

export function apostrophesMessage(count: number): string {
  if (count === 0) return "Aucune apostrophe droite dans le texte.";
  if (count === 1) return "1 apostrophe remplacée par l’apostrophe typographique.";
  return `${fmt.format(count)} apostrophes remplacées par l’apostrophe typographique.`;
}

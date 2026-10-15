// Apostrophe typographique : l'apostrophe droite tapée au clavier devient
// « ’ », celle du français imprimé. Le texte déjà écrit n'est pas modifié.

export function typographicApostrophes(text: string): string {
  return text.replace(/'/g, "’");
}

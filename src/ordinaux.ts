// Nombres ordinaux : « 1er », « 2ème », « XIXe » s'écrivent « 1ᵉʳ », « 2ᵉ »,
// « XIXᵉ », avec les lettres en exposant d'Unicode, comme le propose
// Grammalecte. Les exports en font un véritable exposant (voir lib.rs).

const ORDINAL =
  /(?<![\p{L}\p{N}])(\d+|[IVXLCDM]+)(ères|ère|ers|er|res|re|ièmes|ième|iemes|ieme|èmes|ème|emes|eme|ndes|nde|nds|nd|es|e|è)(?![\p{L}\p{N}])/gu;

// L'exposant d'un ordinal, ou undefined si ce n'en est pas un.
function superscript(number: string, suffix: string): string | undefined {
  const one = number === "1" || number === "I";
  // « Ce », « De », « Le », « Me » ne sont pas des ordinaux : seuls I, V et X
  // prennent la terminaison courte « e ».
  const shortEnding = /^\d+$/.test(number) || /^[IVX]+$/.test(number);
  switch (suffix) {
    case "er":
      return one ? "ᵉʳ" : undefined;
    case "ers":
      return one ? "ᵉʳˢ" : undefined;
    case "re":
    case "ère":
      return one ? "ʳᵉ" : undefined;
    case "res":
    case "ères":
      return one ? "ʳᵉˢ" : undefined;
    case "nd":
      return number === "2" ? "ᵈ" : undefined;
    case "nde":
      return number === "2" ? "ᵈᵉ" : undefined;
    case "nds":
      return number === "2" ? "ᵈˢ" : undefined;
    case "ndes":
      return number === "2" ? "ᵈᵉˢ" : undefined;
    case "e":
      return !one && shortEnding ? "ᵉ" : undefined;
    case "es":
      return !one && shortEnding ? "ᵉˢ" : undefined;
    case "è":
    case "ème":
    case "ième":
    case "eme":
    case "ieme":
      return one ? undefined : "ᵉ";
    default:
      // « èmes », « ièmes », « emes », « iemes ».
      return one ? undefined : "ᵉˢ";
  }
}

// Correction > Mettre en forme les nombres ordinaux : les terminaisons à
// remplacer, en une seule modification que Ctrl+Z annule.
export function ordinalChanges(text: string): { from: number; to: number; insert: string }[] {
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const match of text.matchAll(ORDINAL)) {
    const [whole, number, suffix] = match;
    const insert = superscript(number, suffix);
    if (insert) changes.push({ from: match.index + number.length, to: match.index + whole.length, insert });
  }
  return changes;
}

const fmt = new Intl.NumberFormat("fr-FR");

export function ordinalsMessage(count: number): string {
  if (count === 0) return "Aucun nombre ordinal à mettre en forme dans le texte.";
  if (count === 1) return "1 nombre ordinal mis en forme.";
  return `${fmt.format(count)} nombres ordinaux mis en forme.`;
}

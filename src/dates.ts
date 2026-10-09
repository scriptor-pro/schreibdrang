// Dates écrites en toutes lettres, pour les messages de l'app.

const DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long" });
const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long" });

// « vendredi 9 octobre 2026 » ; le premier du mois s'écrit « 1er ».
export function longDate(date: Date): string {
  const day = date.getDate() === 1 ? "1er" : String(date.getDate());
  return `${DAY.format(date)} ${day} ${MONTH.format(date)} ${date.getFullYear()}`;
}

// Quand le texte a été enregistré pour la dernière fois : par son heure s'il
// l'a été depuis moins de 24 heures, par sa date sinon. Après un
// enregistrement, l'heure change à chaque fois, ce qui montre qu'il a eu lieu.
export function savedMessage(saved: Date, now: Date, path: string): string {
  const name = path.split(/[\\/]/).pop();
  if (now.getTime() - saved.getTime() >= 24 * 60 * 60 * 1000) return `Enregistré le ${longDate(saved)} : ${name}`;
  const time = `${saved.getHours()}\u00a0h\u00a0${String(saved.getMinutes()).padStart(2, "0")}`;
  return `Enregistré à ${time} : ${name}`;
}

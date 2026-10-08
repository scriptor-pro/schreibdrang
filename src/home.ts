// Ce que l'écran d'accueil affiche sans l'éditeur : la liste des textes
// récents. main.ts s'en sert au lancement, app.ts à chaque retour à l'accueil.

import type { Format, Recent } from "./recents";

export const FORMAT_NAMES: Record<Format, string> = { roman: "roman", vanilla: "vanilla" };

export const recentsList = document.querySelector<HTMLUListElement>("#recents")!;
const recentsEmpty = document.querySelector<HTMLParagraphElement>("#recents-empty")!;
const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

// Chaque ligne porte le chemin de son fichier : c'est app.ts qui l'ouvre.
export function renderRecents(recents: Recent[]) {
  recentsList.replaceChildren(
    ...recents.map((recent) => {
      const parts = recent.path.split(/[\\/]/);
      const name = document.createElement("strong");
      name.textContent = parts.pop() ?? recent.path;
      const folder = document.createElement("small");
      folder.textContent = `Format ${FORMAT_NAMES[recent.format]}, ${parts.join("/") || "/"}`;
      const time = document.createElement("time");
      time.dateTime = recent.date;
      time.textContent = dateFormat.format(new Date(recent.date));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "recent";
      button.dataset.path = recent.path;
      button.append(name, " ", time, " ", folder);
      const item = document.createElement("li");
      item.append(button);
      return item;
    }),
  );
  recentsEmpty.hidden = recents.length > 0;
}

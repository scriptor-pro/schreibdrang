// Lancement : l'accueil est complété tout de suite, avec un script léger ;
// l'app (éditeur, cork board, dialogues) est chargée ensuite, depuis app.ts.

import { fillIcons } from "./icons";
import { renderRecents } from "./home";
import { loadRecents } from "./recents";
import { applySettings, loadSettings } from "./settings";

const settings = loadSettings();
applySettings(settings);
fillIcons(document);

const recents = loadRecents();
// Si le réglage demande de rouvrir le dernier texte, l'accueil n'est pas
// préparé : app.ts affichera ce texte.
if (settings.startup !== "dernier" || !recents.length) {
  renderRecents(recents);
  // Au lancement, il n'y a aucun texte à enregistrer ni à exporter.
  for (const id of ["btn-save", "btn-save-as", "btn-export"]) {
    document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = true;
  }
  document.querySelector<HTMLButtonElement>("#home-open")!.focus();
}

// Un clic fait avant la fin du chargement de l'app est rejoué ensuite.
const early: HTMLElement[] = [];
function keepClick(event: MouseEvent) {
  if (event.target instanceof HTMLElement) early.push(event.target);
}
document.addEventListener("click", keepClick, true);

import("./app")
  .then(() => {
    document.removeEventListener("click", keepClick, true);
    for (const target of early) {
      let button = target.closest<HTMLButtonElement>("button");
      // La liste des textes récents a été redessinée entre-temps : le clic
      // est rejoué sur la ligne qui porte le même fichier.
      if (button && !button.isConnected && button.dataset.path) {
        const path = button.dataset.path;
        button = [...document.querySelectorAll<HTMLButtonElement>("button.recent")].find((b) => b.dataset.path === path) ?? null;
      }
      button?.click();
    }
  })
  .catch((error) => {
    const status = document.querySelector<HTMLSpanElement>("#export-status")!;
    status.textContent = `Erreur : l'app n'a pas pu être chargée (${error})`;
    status.classList.add("error");
  });

// Pictogrammes Lucide (licence ISC), embarqués à la compilation. Ils sont
// redessinés à extrémités et jonctions carrées, et masqués aux lecteurs
// d'écran : un pictogramme accompagne toujours un libellé visible.
import book from "lucide-static/icons/book.svg?raw";
import bookOpen from "lucide-static/icons/book-open.svg?raw";
import clapperboard from "lucide-static/icons/clapperboard.svg?raw";
import drama from "lucide-static/icons/drama.svg?raw";
import file from "lucide-static/icons/file.svg?raw";
import fileOutput from "lucide-static/icons/file-output.svg?raw";
import filePlus from "lucide-static/icons/file-plus.svg?raw";
import folderOpen from "lucide-static/icons/folder-open.svg?raw";
import layoutGrid from "lucide-static/icons/layout-grid.svg?raw";
import maximize from "lucide-static/icons/maximize.svg?raw";
import save from "lucide-static/icons/save.svg?raw";
import saveAll from "lucide-static/icons/save-all.svg?raw";
import text from "lucide-static/icons/text.svg?raw";

const ICONS = {
  book,
  "book-open": bookOpen,
  clapperboard,
  drama,
  file,
  "file-output": fileOutput,
  "file-plus": filePlus,
  "folder-open": folderOpen,
  "layout-grid": layoutGrid,
  maximize,
  save,
  "save-all": saveAll,
  text,
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): string {
  const source = ICONS[name];
  const inner = source.slice(source.indexOf(">", source.indexOf("<svg")) + 1, source.lastIndexOf("</svg>"));
  return (
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    `stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${inner}</svg>`
  );
}

// Place un pictogramme en tête de chaque élément qui porte data-icon.
export function fillIcons(root: ParentNode) {
  for (const element of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const name = element.dataset.icon as string;
    if (name in ICONS) element.insertAdjacentHTML("afterbegin", icon(name as IconName));
  }
}

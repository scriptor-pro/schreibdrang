// Découpage d'un texte au format roman en chapitres (« # ») et en scènes
// (« ## »), pour le cork board, et opération inverse. Tout le texte est
// conservé : ce qui ne fait partie d'aucune scène est rattaché au document
// (avant le premier chapitre) ou au chapitre (avant sa première scène).

export interface Scene {
  heading: string;
  body: string;
}

export interface Chapter {
  heading: string;
  // Texte placé entre le titre du chapitre et sa première scène.
  intro: string;
  scenes: Scene[];
}

export interface Outline {
  // Texte placé avant le premier chapitre.
  preamble: string;
  chapters: Chapter[];
}

export function parseDocument(text: string): Outline {
  const outline: Outline = { preamble: "", chapters: [] };
  let chapter: Chapter | undefined;
  let scene: Scene | undefined;
  const lines: string[] = [];

  // Range les lignes accumulées là où elles se trouvaient : dans la scène en
  // cours, sinon en tête du chapitre en cours, sinon en tête du document.
  const flush = () => {
    const block = lines.join("\n").trim();
    lines.length = 0;
    if (scene) scene.body = block;
    else if (chapter) chapter.intro = block;
    else outline.preamble = block;
  };

  for (const line of text.split("\n")) {
    if (line.startsWith("# ")) {
      flush();
      scene = undefined;
      chapter = { heading: line, intro: "", scenes: [] };
      outline.chapters.push(chapter);
    } else if (line.startsWith("## ") && chapter) {
      flush();
      scene = { heading: line, body: "" };
      chapter.scenes.push(scene);
    } else {
      lines.push(line);
    }
  }
  flush();
  return outline;
}

export function serializeDocument(outline: Outline): string {
  const parts: string[] = [];
  if (outline.preamble) parts.push(outline.preamble);
  for (const chapter of outline.chapters) {
    parts.push(chapter.heading);
    if (chapter.intro) parts.push(chapter.intro);
    for (const scene of chapter.scenes) {
      parts.push(scene.heading);
      if (scene.body) parts.push(scene.body);
    }
  }
  return parts.length ? parts.join("\n\n") + "\n" : "";
}

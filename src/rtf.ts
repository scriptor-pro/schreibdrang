// Export au format RTF, écrit par l'app elle-même, sans Pandoc : il marche
// sur tous les systèmes sans rien installer. Un roman, une nouvelle ou une
// page blanche devient un document A4 en Literata, avec ses titres, son
// italique, son gras, ses exposants et ses notes ; une pièce suit la mise en
// page choisie, comme ses modèles Word ; un scénario, la mise en page
// standard de son PDF, ligne pour ligne. Les polices sont nommées, pas
// embarquées : sans elles, le traitement de texte en prend une autre.

import type { Cover } from "./cover.ts";
import { joinNames } from "./cover.ts";
import type { PageSetup } from "./miseenpage.ts";
import type { PrintedLine } from "./pagination.ts";
import { playBlocks } from "./theatre-pandoc.ts";
import type { PlayLayout, PlayPage } from "./theatre-pandoc.ts";

// Mise en page des romans et des nouvelles : celle du PDF et de Word.
const DEFAULT_PAGE: PageSetup = { spacing: 1, top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 };

// Un centimètre, en vingtièmes de point.
const TWIPS_PER_CM = 1440 / 2.54;

const twips = (cm: number) => Math.round(cm * TWIPS_PER_CM);

// Les lettres en exposant d'Unicode des ordinaux (« 1ᵉʳ »), comme dans lib.rs.
const SUPERSCRIPT_LETTERS: Record<string, string> = { "ᵉ": "e", "ʳ": "r", "ˢ": "s", "ᵈ": "d" };

// Un caractère du texte, protégé pour RTF : les caractères hors ASCII sont
// écrits par leur numéro Unicode, en deux moitiés au-delà de U+FFFF, suivis,
// comme le font Word et LibreOffice, de leur équivalent Latin-1 (ou d'un
// « ? ») pour les lecteurs qui ignorent Unicode.
function escapeChar(char: string): string {
  if (char === "\\" || char === "{" || char === "}") return `\\${char}`;
  if (char === "\t") return "\\tab ";
  if (char === " ") return "\\~";
  const code = char.codePointAt(0)!;
  if (code < 0x80) return char;
  const fallback = code >= 0xa0 && code <= 0xff ? code.toString(16) : "3f";
  let out = "";
  for (let i = 0; i < char.length; i++) {
    const unit = char.charCodeAt(i);
    out += `\\u${unit > 0x7fff ? unit - 0x10000 : unit}\\'${fallback}`;
  }
  return out;
}

// Du texte sans mise en forme, protégé ; les lettres en exposant d'Unicode
// deviennent un véritable exposant.
function escapeText(text: string): string {
  let out = "";
  let letters = "";
  for (const char of text) {
    const letter = SUPERSCRIPT_LETTERS[char];
    if (letter) {
      letters += letter;
      continue;
    }
    if (letters) {
      out += `{\\super ${letters}}`;
      letters = "";
    }
    out += escapeChar(char);
  }
  if (letters) out += `{\\super ${letters}}`;
  return out;
}

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);
const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

// La position du délimiteur fermant `marker` à partir de `from`, collé au
// texte qui le précède ; -1 s'il n'y en a pas.
function closing(text: string, marker: string, from: number): number {
  let at = text.indexOf(marker, from);
  while (at !== -1) {
    const before = text[at - 1];
    const after = text[at + marker.length];
    const glued = at > from && !isSpace(before) && before !== "\\";
    // « _ » au milieu d'un mot n'est pas un délimiteur.
    const wordSafe = marker[0] !== "_" || !isWordChar(after);
    // « *a**b* » : un « * » simple ne ferme pas sur un « ** ».
    const exact = marker.length > 1 || (text[at + 1] !== marker && text[at - 1] !== marker);
    if (glued && wordSafe && exact) return at;
    at = text.indexOf(marker, at + 1);
  }
  return -1;
}

export interface Notes {
  // Le texte des notes, par identifiant.
  texts: Map<string, string>;
}

// Le Markdown d'une ligne de paragraphe, en RTF : italique, gras, exposants
// de Pandoc (« 1^er^ »), notes, liens (leur texte) ; les images sont retirées.
export function inlineRtf(text: string, notes: Notes = { texts: new Map() }): string {
  let out = "";
  let plain = "";
  const flush = () => {
    out += escapeText(plain);
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const rest = text.slice(i);
    // Caractère protégé par une barre oblique inverse.
    if (char === "\\" && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!^~>|"'<]/.test(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    // Code : son texte, tel quel.
    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        plain += text.slice(i + 1, end);
        i = end + 1;
        continue;
      }
    }
    // Image : retirée, comme à l'import.
    const image = /^!\[[^\]]*\]\([^)]*\)/.exec(rest);
    if (image) {
      i += image[0].length;
      continue;
    }
    // Appel de note.
    const note = /^\[\^([^\]\s]+)\]/.exec(rest);
    if (note && notes.texts.has(note[1])) {
      flush();
      out += `{\\super\\chftn}{\\footnote\\pard\\plain\\f0\\fs20\\lang1036 {\\super\\chftn} ${inlineRtf(notes.texts.get(note[1])!, notes)}}`;
      i += note[0].length;
      continue;
    }
    // Lien : son texte seul.
    const link = /^\[([^\]]*)\]\([^)]*\)/.exec(rest);
    if (link) {
      flush();
      out += inlineRtf(link[1], notes);
      i += link[0].length;
      continue;
    }
    // Exposant de Pandoc.
    if (char === "^") {
      const end = text.indexOf("^", i + 1);
      if (end > i + 1 && !/\s/.test(text.slice(i + 1, end))) {
        flush();
        out += `{\\super ${inlineRtf(text.slice(i + 1, end), notes)}}`;
        i = end + 1;
        continue;
      }
    }
    // Gras, italique, ou les deux. Un délimiteur ouvrant est suivi d'un
    // caractère qui n'est pas une espace ; « _ » ne s'ouvre pas dans un mot.
    if (char === "*" || char === "_") {
      const run = /^(\*+|_+)/.exec(rest)![1];
      const opensWord = char === "_" && isWordChar(text[i - 1]);
      if (!isSpace(text[i + run.length]) && !opensWord) {
        let done = false;
        for (const size of [Math.min(run.length, 3), 2, 1].filter((n, k, all) => n <= run.length && all.indexOf(n) === k)) {
          const marker = char.repeat(size);
          const end = closing(text, marker, i + size);
          if (end === -1) continue;
          flush();
          const inner = inlineRtf(text.slice(i + size, end), notes);
          out += size === 3 ? `{\\b\\i ${inner}}` : size === 2 ? `{\\b ${inner}}` : `{\\i ${inner}}`;
          i = end + size;
          done = true;
          break;
        }
        if (done) continue;
        plain += run;
        i += run.length;
        continue;
      }
    }
    plain += char;
    i += 1;
  }
  flush();
  return out;
}

// Les lignes d'un paragraphe, jointes : une ligne qui finit par deux espaces
// ou par « \ » force un retour à la ligne, les autres sont jointes par une
// espace, comme en Markdown.
function joinLines(lines: string[], notes: Notes): string {
  return lines
    .map((line, index) => {
      const last = index === lines.length - 1;
      const hard = !last && (/ {2,}$/.test(line) || /\\$/.test(line));
      const text = line.replace(/\\$/, "").trim();
      return inlineRtf(text, notes) + (last ? "" : hard ? "\\line " : " ");
    })
    .join("");
}

// Les définitions de notes (« [^1]: texte », suivies de lignes en retrait),
// retirées du texte.
function extractNotes(lines: string[]): { lines: string[]; notes: Notes } {
  const texts = new Map<string, string>();
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const def = /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(lines[i]);
    if (!def) {
      kept.push(lines[i]);
      continue;
    }
    const parts = [def[2]];
    while (i + 1 < lines.length && (/^( {4}|\t)/.test(lines[i + 1]) || (lines[i + 1].trim() === "" && /^( {4}|\t)/.test(lines[i + 2] ?? "")))) {
      i += 1;
      if (lines[i].trim()) parts.push(lines[i].trim());
    }
    texts.set(def[1], parts.join(" "));
  }
  return { lines: kept, notes: { texts } };
}

const HEADINGS = [
  "\\fs32\\b\\sb480\\sa240",
  "\\fs28\\b\\sb360\\sa180",
  "\\fs24\\b\\sb240\\sa120",
  "\\fs24\\b\\i\\sb240\\sa120",
  "\\fs24\\i\\sb240\\sa120",
  "\\fs24\\i\\sb240\\sa120",
];

// Le texte Markdown en document RTF. `setup` : l'interligne et les marges
// d'une page blanche ; sinon, A4, interligne simple, marges de 2,5 cm.
export function markdownToRtf(markdown: string, setup: PageSetup | null = null): string {
  const page = setup ?? DEFAULT_PAGE;
  const spacing = page.spacing === 1 ? "" : `\\sl${Math.round(240 * page.spacing)}\\slmult1`;
  const base = `\\pard\\plain\\f0\\fs24\\lang1036${spacing}`;
  const { lines, notes } = extractNotes(markdown.replace(/\r\n?/g, "\n").split("\n"));
  const body: string[] = [];
  let paragraph: string[] = [];
  let kind: "para" | "quote" = "para";

  const flush = () => {
    if (paragraph.length) {
      const indent = kind === "quote" ? "\\li567\\ri567" : "";
      body.push(`{${base}\\sa180${indent} ${joinLines(paragraph, notes)}\\par}`);
    }
    paragraph = [];
    kind = "para";
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*?)(\s+#+)?\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length - 1;
      body.push(`{${base}${HEADINGS[level]}\\keepn\\outlinelevel${level} ${inlineRtf(heading[2], notes)}\\par}`);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    // Séparateur (« *** », « --- », « * * * ») : trois astérisques centrés.
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      body.push(`{${base}\\qc\\sa180 *\\~*\\~*\\par}`);
      continue;
    }
    const item = /^\s{0,3}([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const mark = /\d/.test(item[1]) ? escapeText(item[1]) : "\\u8226\\'3f";
      body.push(`{${base}\\sa60\\fi-360\\li720 ${mark}\\tab ${inlineRtf(item[2], notes)}\\par}`);
      continue;
    }
    const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quote) {
      if (kind !== "quote") flush();
      kind = "quote";
      paragraph.push(quote[1]);
      continue;
    }
    if (kind === "quote") flush();
    paragraph.push(line);
  }
  flush();

  return rtfDocument("{\\f0\\froman\\fcharset0 Literata;}", A4, page, body.join("\n"));
}

// Format de page, en vingtièmes de point.
interface Paper {
  width: number;
  height: number;
}

const A4: Paper = { width: 11906, height: 16838 };
const A5: Paper = { width: 8391, height: 11906 };

interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// Un document RTF : sa police (la seule, \f0), son format de page, ses marges
// en centimètres et son contenu (sections, en-têtes et paragraphes).
function rtfDocument(font: string, paper: Paper, margins: Margins, content: string): string {
  const header = [
    "{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1036\\uc1",
    `{\\fonttbl${font}}`,
    `\\paperw${paper.width}\\paperh${paper.height}\\margl${twips(margins.left)}\\margr${twips(margins.right)}\\margt${twips(margins.top)}\\margb${twips(margins.bottom)}`,
    "\\widowctrl\\ftnbj\\fet0",
  ];
  return `${header.join("\n")}\n${content}\n}\n`;
}

// Numéro de page en bas, au centre.
const FOOTER_PAGE_NUMBER = "{\\footer\\pard\\plain\\qc\\f0\\fs20 \\chpgn\\par}";

const COURIER = "{\\f0\\fmodern\\fprq1\\fcharset0 Courier Prime{\\*\\falt Courier New};}";
const GARAMOND = "{\\f0\\froman\\fcharset0 EB Garamond;}";

// Les styles d'une pièce, repris des modèles Word (theatre-*.docx) : espaces
// avant et après, en vingtièmes de point, alignement, retraits, graisse.
const PLAY_RTF: Record<string, string> = {
  Acte: "\\pagebb\\keepn\\sb0\\sa480\\qc\\b",
  Scene: "\\keepn\\sb360\\sa240\\qc\\b",
  Personnages: "\\keepn\\sb0\\sa360\\qc\\b",
  Distribution: "\\sb0\\sa120",
  Personnage: "\\keepn\\sb240\\sa0\\qc",
  Replique: "\\sb0\\sa120",
  Didascalie: "\\sb60\\sa120\\li1134\\ri567\\i",
  Texte: "\\sb0\\sa120",
};

// Une pièce en RTF, dans la mise en page choisie : manuscrit (Courier Prime
// corps 12, A4) ou édition (EB Garamond, A4 corps 12 ou A5 corps 11, noms en
// capitales de corps réduit). Chaque acte commence sur une nouvelle page ;
// les pages sont numérotées en bas, au centre.
export function playToRtf(text: string, layout: PlayLayout, page: PlayPage): string {
  const manuscript = layout === "manuscrit";
  const a5 = !manuscript && page === "a5";
  const size = a5 ? 22 : 24;
  const nameSize = manuscript ? "" : a5 ? "\\caps\\fs18" : "\\caps\\fs20";
  const body = playBlocks(text, layout).map((block) => {
    // Les lignes d'une réplique restent des lignes (un vers reste un vers) ;
    // celles d'un paragraphe de texte se suivent.
    const separator = block.style === "Replique" ? "\\line " : " ";
    const content = block.lines.map((line) => inlineRtf(line)).join(separator);
    const extra = block.style === "Personnage" ? nameSize : "";
    return `{\\pard\\plain\\f0\\fs${size}\\lang1036${PLAY_RTF[block.style]}${extra} ${content}\\par}`;
  });
  const margin = a5 ? 2 : 2.5;
  const margins = { top: margin, bottom: margin, left: margin, right: margin };
  return rtfDocument(manuscript ? COURIER : GARAMOND, a5 ? A5 : A4, margins, `${FOOTER_PAGE_NUMBER}\n${body.join("\n")}`);
}

// Page de titre d'un scénario, comme celle du PDF : le titre en capitales,
// « écrit par », les auteurs, l'œuvre adaptée ; les coordonnées vont en bas à
// gauche, dans le pied de cette seule page (un cadre posé en bas de page
// glissait sur la page suivante dans LibreOffice).
function coverRtf(cover: Cover): { body: string; contact: string } {
  const para = (attrs: string, text: string) => `{\\pard\\plain\\f0\\fs24\\lang1036${attrs} ${text}\\par}`;
  const parts = [
    // Le titre au tiers de la page, comme dans le PDF.
    para("\\qc\\sb3912\\sa480", escapeText(cover.title.trim().toLocaleUpperCase("fr"))),
    para("\\qc\\sa480", "\\u233\\'e9crit par"),
    para("\\qc", escapeText(joinNames(cover.authors.map((author) => author.name.trim())))),
  ];
  if (cover.source.trim()) parts.push(para("\\qc\\sb480", `d'apr\\u232\\'e8s ${escapeText(cover.source.trim())}`));
  const contact = cover.authors
    .map((author) => {
      const agent = `${author.agentFirstName.trim()} ${author.agentLastName.trim()}`.trim();
      return [author.name, author.email, author.phone, agent ? `Représenté par ${agent}` : "", author.agency, author.agencyEmail, author.agencyPhone]
        .map((value) => value.trim())
        .filter((value) => value !== "")
        .map(escapeText)
        .join("\\line ");
    })
    .join("\\line\\line ");
  return { body: parts.join("\n"), contact: `{\\pard\\plain\\f0\\fs24\\lang1036 ${contact}\\par}` };
}

// Un passage d'une ligne imprimée, dans sa graisse.
function runRtf(run: PrintedLine[number]): string {
  // Courier Prime n'a pas d'espace fine insécable.
  const text = escapeText(run.text.replace(/\u202f/g, "\u00a0"));
  if (run.style === "b") return `{\\b ${text}}`;
  if (run.style === "i") return `{\\i ${text}}`;
  if (run.style === "bi") return `{\\b\\i ${text}}`;
  return text;
}

// Un scénario en RTF, à la mise en page standard de son PDF : les pages et
// les lignes déjà découpées par l'éditeur (voir printedPages), en Courier
// Prime corps 12, une ligne tous les 12 points, marge de 1,5 pouce à gauche.
// Le numéro de page est en haut à droite, suivi d'un point, sauf sur la
// première page ; la page de titre, s'il y en a une, précède le texte.
export function screenplayToRtf(pages: PrintedLine[][], cover?: Cover): string {
  const inch = 2.54;
  const sections: string[] = [];
  if (cover) {
    const { body, contact } = coverRtf(cover);
    sections.push(`\\sectd\\titlepg\\marglsxn${twips(3.8)}\\margrsxn${twips(2.5)}\\margtsxn${twips(2.5)}\\margbsxn${twips(2.5)}`);
    sections.push(`{\\footerf${contact}}`, body, "\\sect");
  }
  sections.push(
    `\\sectd\\sbkpage\\pgnrestart\\pgnstarts1\\titlepg\\marglsxn${twips(1.5 * inch)}\\margrsxn${twips(0.77 * inch)}\\margtsxn${twips(inch)}\\margbsxn${twips(inch)}`,
    "{\\header\\pard\\plain\\qr\\f0\\fs24 \\chpgn.\\par}",
    // Vides, pour ne pas hériter du pied de la page de titre.
    "{\\headerf\\pard\\plain\\par}{\\footerf\\pard\\plain\\par}{\\footer\\pard\\plain\\par}",
  );
  // Chaque ligne imprimée est un paragraphe, espaces du retrait comprises ;
  // l'interligne est exactement de 12 points.
  const line = "\\pard\\plain\\f0\\fs24\\lang1036\\sl-240\\sa0\\sb0";
  const body = pages.map((page, index) => {
    const lines = (page.length ? page : [[]]).map((runs) => `{${line}${index > 0 && runs === page[0] ? "\\pagebb" : ""} ${runs.map(runRtf).join("")}\\par}`);
    return lines.join("\n");
  });
  sections.push(body.join("\n"));
  return rtfDocument(COURIER, A4, { top: 2.54, bottom: 2.54, left: 1.5 * inch, right: 0.77 * inch }, sections.join("\n"));
}

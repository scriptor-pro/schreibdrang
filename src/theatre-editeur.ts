// Format théâtre dans l'éditeur : chaque ligne reçoit une classe selon sa
// nature, la saisie est guidée par Tab, Entrée et « ( » (theatre-saisie.ts),
// et un bandeau dit en haut de l'éditeur l'acte et la scène affichés.

import { Prec, RangeSetBuilder } from "@codemirror/state";
import type { Extension, TransactionSpec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Decoration, EditorView, ViewPlugin, keymap, showPanel } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { bannerAt } from "./theatre.ts";
import type { PlayLine } from "./theatre.ts";
import { NO_PLAY_ENTRY, playEnter, playEntry, playInput, playKinds, playShiftEnter, playTab, setPlayEntry } from "./theatre-saisie.ts";

const PLAY_LINES: Partial<Record<PlayLine, Decoration>> = {
  "cast-title": Decoration.line({ class: "cm-play-cast-title" }),
  act: Decoration.line({ class: "cm-play-act" }),
  scene: Decoration.line({ class: "cm-play-scene" }),
  character: Decoration.line({ class: "cm-play-character" }),
  stage: Decoration.line({ class: "cm-play-stage" }),
};

const playLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      const entryChanged = update.startState.field(playEntry) !== update.state.field(playEntry);
      if (update.docChanged || update.viewportChanged || entryChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const kinds = view.state.field(playKinds);
      const entry = view.state.field(playEntry);
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          // Pendant la saisie, le nom tapé a déjà sa mise en page.
          const kind = line.from === entry.character ? "character" : kinds[line.number - 1];
          const decoration = PLAY_LINES[kind];
          if (decoration) builder.add(line.from, line.from, decoration);
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const playTheme = EditorView.theme({
  ".cm-play-act, .cm-play-scene, .cm-play-cast-title": { textAlign: "center", fontWeight: "700" },
  ".cm-play-character": { textAlign: "center" },
  ".cm-play-stage": { fontStyle: "italic", paddingLeft: "calc(4ch + 6px)" },
  ".cm-panels.cm-panels-top": { borderBottom: "none", backgroundColor: "var(--bg)" },
  ".cm-play-banner": {
    minHeight: "1.6em",
    padding: "0.2em 0",
    borderBottom: "1px solid var(--ink)",
    backgroundColor: "var(--bg)",
    color: "var(--ink)",
    fontFamily: "var(--font-text)",
    fontWeight: "700",
    textAlign: "center",
  },
});

function run(view: EditorView, spec: TransactionSpec | null): boolean {
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

const playKeys = Prec.high(
  keymap.of([
    { key: "Tab", run: (view) => run(view, playTab(view.state)) },
    {
      // Maj + Tab quitte la saisie d'un nom ; sinon, le focus sort de l'éditeur.
      key: "Shift-Tab",
      run: (view) => view.state.field(playEntry) !== NO_PLAY_ENTRY && run(view, { effects: setPlayEntry.of(NO_PLAY_ENTRY) }),
    },
    { key: "Enter", run: (view) => run(view, playEnter(view.state)) },
    { key: "Shift-Enter", run: (view) => run(view, playShiftEnter(view.state)) },
  ]),
);

const playInputHandler = EditorView.inputHandler.of((view, from, to, text) => run(view, playInput(view.state, from, to, text)));

// Le bandeau nomme l'acte et la scène de la première ligne affichée, dès que
// leur titre est sorti de l'écran. Il garde toujours sa hauteur : le texte ne
// saute pas quand il apparaît.
const banner = showPanel.of((view) => {
  const dom = document.createElement("div");
  dom.className = "cm-play-banner";
  let cachedDoc = view.state.doc;
  let lines = cachedDoc.toJSON();
  const refresh = () => {
    if (view.state.doc !== cachedDoc) {
      cachedDoc = view.state.doc;
      lines = cachedDoc.toJSON();
    }
    const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
    const top = view.state.doc.lineAt(block.from).number - 1;
    const { title, heading } = bannerAt(lines, view.state.field(playKinds), top);
    dom.textContent = title && heading < top ? title : "";
  };
  const onScroll = () => refresh();
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
  refresh();
  return {
    top: true,
    dom,
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) refresh();
    },
    destroy() {
      view.scrollDOM.removeEventListener("scroll", onScroll);
    },
  };
});

// Le Markdown d'une pièce, pour l'italique et le gras, sans ses raccourcis :
// Entrée dans une réplique qui commence par « - » ou « 1. » ne doit pas
// prolonger une liste.
export function playLanguage(): Extension {
  return markdown({ addKeymap: false });
}

export function theatreExtension(): Extension {
  return [playKinds, playEntry, playLines, playTheme, playKeys, playInputHandler, banner];
}

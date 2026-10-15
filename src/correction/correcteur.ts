// Correction : la vérification d'un texte. Le correcteur envoie les passages
// au moteur un par un, en commençant par ceux qui sont à l'écran ; arrêter
// revient à cesser d'en envoyer. Il garde la réponse de chaque passage relu,
// par son texte, tant que l'app est ouverte, et affiche les remarques des
// passages relus depuis la dernière fois qu'elles ont été effacées.

import type { EditorState, Text, TransactionSpec } from "@codemirror/state";
import { characterNames, extractPassages } from "./extraction.ts";
import { playCharacterNames } from "../theatre.ts";
import type { Passage } from "./extraction.ts";
import { remarksOf, wordAcceptor } from "./remarques.ts";
import type { EngineReply, Remark, RemarkFilter } from "./remarques.ts";
import { correctionField, setRemarks } from "./etat.ts";
import { passagesIn, progressMessage, readingOrder, remarksMessage } from "./verification.ts";
import type { EngineLike } from "./moteur.ts";
import type { Personal, TextData } from "./dictionnaires.ts";
import type { Format } from "../recents.ts";
import type { Reference, Settings } from "../settings.ts";

// Ce que le correcteur utilise de l'éditeur : l'EditorView de l'app.
export interface Target {
  readonly state: EditorState;
  readonly viewport: { from: number; to: number };
  dispatch(spec: TransactionSpec): void;
}

export interface CorrectorHost {
  view: Target;
  format(): Format;
  settings(): Settings;
  personal(): Personal;
  textData(): TextData;
  // Message du pied de page de la correction ; vide pour l'effacer.
  status(message: string, error?: boolean): void;
  createEngine(): EngineLike;
}

export const START_FAILED = "la correction n'a pas pu démarrer";
// Délai entre la dernière frappe et la relecture du paragraphe en cours.
export const TYPING_DELAY = 1000;
// Pendant une vérification, les remarques sont redessinées au plus toutes les 300 ms.
const RENDER_DELAY = 300;

export class Corrector {
  #host: CorrectorHost;
  #engine: EngineLike | undefined;
  // Réponse du moteur pour chaque texte de passage déjà relu.
  #replies = new Map<string, EngineReply>();
  // Textes des passages dont les remarques sont affichées.
  #shown = new Set<string>();
  // Change à chaque vérification, arrêt ou effacement : une réponse qui
  // arrive pour une vérification dépassée est écartée.
  #run = 0;
  #running = false;
  #count = 0;
  #renderTimer: ReturnType<typeof setTimeout> | undefined;
  #typingTimer: ReturnType<typeof setTimeout> | undefined;
  // Les passages du dernier texte découpé : tant que le texte et son format
  // ne changent pas, il n'est pas découpé à nouveau.
  #extracted: { doc: Text; format: Format; passages: Passage[] } | undefined;

  constructor(host: CorrectorHost) {
    this.#host = host;
  }

  get running(): boolean {
    return this.#running;
  }

  // Correction > Vérifier : la sélection s'il y en a une, sinon tout le texte.
  async check(): Promise<void> {
    this.#run += 1;
    const run = this.#run;
    const { state, viewport } = this.#host.view;
    const passages = this.#passages(state);
    const selection = state.selection.main;
    const chosen = selection.empty ? readingOrder(passages, viewport.from, viewport.to) : passagesIn(passages, selection.from, selection.to);
    // Un passage déjà relu est affiché tout de suite ; un texte présent deux
    // fois n'est envoyé qu'une fois.
    const todo: Passage[] = [];
    const queued = new Set<string>();
    for (const passage of chosen) {
      if (this.#replies.has(passage.text)) this.#shown.add(passage.text);
      else if (!queued.has(passage.text)) {
        queued.add(passage.text);
        todo.push(passage);
      }
    }
    this.#running = todo.length > 0;
    this.#render();
    if (!todo.length) {
      this.#showCount();
      return;
    }
    this.#host.status(progressMessage(0, todo.length));
    const engine = await this.#start();
    if (!engine || run !== this.#run) return;
    for (let done = 0; done < todo.length; done += 1) {
      const text = todo[done].text;
      let reply: EngineReply;
      try {
        reply = await engine.check(text);
      } catch {
        this.#fail();
        return;
      }
      if (run !== this.#run) return;
      this.#replies.set(text, reply);
      this.#shown.add(text);
      this.#host.status(progressMessage(done + 1, todo.length));
      this.#scheduleRender();
    }
    this.#running = false;
    this.#render();
    this.#showCount();
  }

  // Échap : la vérification s'arrête ; les remarques déjà trouvées restent.
  // Faux s'il n'y avait pas de vérification en cours.
  stop(): boolean {
    if (!this.#running) return false;
    this.#run += 1;
    this.#running = false;
    this.#render();
    this.#showCount();
    return true;
  }

  // Effacer les remarques, ou afficher un autre texte : ce qui a été relu
  // reste en mémoire.
  clear() {
    this.#run += 1;
    this.#running = false;
    clearTimeout(this.#typingTimer);
    this.#shown.clear();
    this.#render();
    this.#host.status("");
  }

  // Un réglage, un dictionnaire ou une remarque ignorée a changé.
  refresh() {
    this.#render();
    if (!this.#running) this.#showCount();
  }

  // L'orthographe de référence a changé : les réponses gardées ne valent plus.
  setReference(reference: Reference) {
    const shown = this.#shown.size > 0;
    this.#engine?.setReference(reference);
    this.#replies.clear();
    this.clear();
    if (shown) this.#host.status("Orthographe de référence changée : vérifie à nouveau le texte (F7).");
  }

  suggest(word: string): Promise<string[]> {
    return this.#engine ? this.#engine.suggest(word) : Promise.resolve([]);
  }

  // Le texte vient de changer : avec la vérification pendant la frappe, le
  // paragraphe en cours est relu une seconde après la dernière frappe.
  typed() {
    clearTimeout(this.#typingTimer);
    if (!this.#host.settings().checkWhileTyping) return;
    this.#typingTimer = setTimeout(() => void this.#checkCursor(), TYPING_DELAY);
  }

  async #checkCursor() {
    const run = this.#run;
    const state = this.#host.view.state;
    const head = state.selection.main.head;
    const passage = this.#passages(state).find((p) => p.from <= head && head <= p.to);
    if (!passage) return;
    if (!this.#replies.has(passage.text)) {
      const engine = await this.#start();
      if (!engine) return;
      let reply: EngineReply;
      try {
        reply = await engine.check(passage.text);
      } catch {
        this.#fail();
        return;
      }
      if (run !== this.#run) return;
      this.#replies.set(passage.text, reply);
    }
    this.#shown.add(passage.text);
    this.#render();
    if (!this.#running) this.#showCount();
  }

  #passages(state: EditorState): Passage[] {
    const format = this.#host.format();
    const cached = this.#extracted;
    if (cached && cached.doc === state.doc && cached.format === format) return cached.passages;
    const passages = extractPassages(state.doc.toString(), format);
    this.#extracted = { doc: state.doc, format, passages };
    return passages;
  }

  // Le moteur n'est créé qu'à la première vérification.
  async #start(): Promise<EngineLike | undefined> {
    try {
      if (!this.#engine) {
        this.#engine = this.#host.createEngine();
        const reference = this.#host.settings().reference;
        if (reference !== "toutes") this.#engine.setReference(reference);
      }
      await this.#engine.ready;
      return this.#engine;
    } catch {
      this.#fail();
      return undefined;
    }
  }

  // Le moteur est hors d'usage : la prochaine vérification en créera un autre.
  #fail() {
    this.#engine = undefined;
    this.#run += 1;
    this.#running = false;
    this.#host.status(START_FAILED, true);
  }

  #filter(state: EditorState): RemarkFilter {
    const settings = this.#host.settings();
    const personal = this.#host.personal();
    const text = this.#host.textData();
    const format = this.#host.format();
    const names =
      format === "scenario" ? characterNames(state.doc.toString()) : format === "theatre" ? playCharacterNames(state.doc.toString()) : [];
    return {
      kinds: { grammaire: settings.grammar, orthographe: settings.spelling, typographie: settings.typography },
      ignoredRules: new Set(personal.rules.map((rule) => rule.rule)),
      ignoredRemarks: new Set(text.ignored),
      accepts: wordAcceptor(personal.words, text.words, names),
    };
  }

  // Les remarques sont recalculées à partir du texte actuel : celles qui
  // arrivent pendant qu'on écrit tombent à la bonne place.
  #render() {
    clearTimeout(this.#renderTimer);
    this.#renderTimer = undefined;
    const view = this.#host.view;
    const remarks: Remark[] = [];
    if (this.#shown.size) {
      const filter = this.#filter(view.state);
      for (const passage of this.#passages(view.state)) {
        const reply = this.#shown.has(passage.text) ? this.#replies.get(passage.text) : undefined;
        if (reply) remarks.push(...remarksOf(passage, reply, filter));
      }
    }
    this.#count = remarks.length;
    const current = view.state.field(correctionField, false)?.remarks ?? [];
    if (remarks.length || current.length) view.dispatch({ effects: setRemarks.of(remarks) });
  }

  #scheduleRender() {
    if (this.#renderTimer === undefined) this.#renderTimer = setTimeout(() => this.#render(), RENDER_DELAY);
  }

  #showCount() {
    this.#host.status(this.#shown.size ? remarksMessage(this.#count) : "");
  }
}

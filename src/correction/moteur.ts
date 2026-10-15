// Correction : le moteur Grammalecte, dans son worker
// (public/correction/worker.js). Chaque demande reçoit sa réponse par son
// numéro.

import type { EngineReply, GrammarError, UnknownWord } from "./remarques.ts";
import type { Reference } from "../settings.ts";

export type WorkerLike = Pick<Worker, "postMessage" | "onmessage" | "onerror" | "terminate">;

// Les trois dictionnaires de Grammalecte.
export const DICTIONARIES: Record<Reference, string> = {
  toutes: "fr-allvars.json",
  classique: "fr-classic.json",
  reforme: "fr-reform.json",
};

export interface EngineLike {
  readonly ready: Promise<void>;
  check(text: string): Promise<EngineReply>;
  suggest(word: string): Promise<string[]>;
  setReference(reference: Reference): void;
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "checked"; id: number; grammar: GrammarError[]; spelling: UnknownWord[] }
  | { type: "suggestions"; id: number; suggestions: string[] };

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class Engine implements EngineLike {
  readonly ready: Promise<void>;
  #worker: WorkerLike;
  #next = 1;
  #pending = new Map<number, Pending>();
  #failure: Error | undefined;

  constructor(createWorker: () => WorkerLike) {
    let started!: () => void;
    let failed!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      started = resolve;
      failed = reject;
    });
    // Un échec que personne n'attend encore ne doit pas être signalé comme oublié.
    this.ready.catch(() => {});
    const fail = (error: Error) => {
      this.#failure = error;
      failed(error);
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    };
    this.#worker = createWorker();
    this.#worker.onmessage = (event) => {
      const data = event.data as WorkerMessage;
      if (data.type === "ready") {
        started();
      } else if (data.type === "failed") {
        fail(new Error(data.message));
      } else {
        const pending = this.#pending.get(data.id);
        this.#pending.delete(data.id);
        pending?.resolve(data.type === "checked" ? { grammar: data.grammar, spelling: data.spelling } : data.suggestions);
      }
    };
    this.#worker.onerror = (event) => fail(new Error(event.message || "le correcteur n'a pas pu être chargé"));
  }

  #ask<T>(message: Record<string, unknown>): Promise<T> {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = this.#next;
    this.#next += 1;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.#worker.postMessage({ ...message, id });
    });
  }

  check(text: string): Promise<EngineReply> {
    return this.#ask<EngineReply>({ type: "check", text });
  }

  suggest(word: string): Promise<string[]> {
    return this.#ask<string[]>({ type: "suggest", word });
  }

  setReference(reference: Reference) {
    this.#worker.postMessage({ type: "dictionary", file: DICTIONARIES[reference] });
  }
}

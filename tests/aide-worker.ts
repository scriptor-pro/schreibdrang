// Charge public/correction/worker.js dans Node comme dans un worker de l'app :
// importScripts et la requête synchrone de Grammalecte lisent les fichiers
// sur le disque, sous la racine donnée.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const PUBLIC = path.resolve(import.meta.dirname, "..", "public");
const ORIGIN = "app://schreibdrang";

export function chargerWorker(racine = PUBLIC) {
  const recus: unknown[] = [];
  const disque = (url: string) => path.join(racine, decodeURI(new URL(url, ORIGIN).pathname));
  const contexte: Record<string, unknown> = {
    console: { log() {}, warn() {}, error() {} },
    location: { origin: ORIGIN },
    postMessage: (message: unknown) => recus.push(JSON.parse(JSON.stringify(message))),
    XMLHttpRequest: class {
      url = "";
      responseText = "";
      open(_method: string, url: string) {
        this.url = url;
      }
      overrideMimeType() {}
      send() {
        this.responseText = fs.readFileSync(disque(this.url), "utf8");
      }
    },
  };
  contexte.self = contexte;
  contexte.importScripts = (...urls: string[]) => {
    for (const url of urls) vm.runInContext(fs.readFileSync(disque(url), "utf8"), contexte, { filename: url });
  };
  vm.createContext(contexte);
  const worker = path.join(PUBLIC, "correction", "worker.js");
  vm.runInContext(fs.readFileSync(worker, "utf8"), contexte, { filename: worker });
  return {
    recus,
    envoyer(message: unknown) {
      (contexte.onmessage as (event: { data: unknown }) => void)({ data: message });
    },
  };
}

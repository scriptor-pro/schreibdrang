// Le panneau des personnages, à droite du texte : la liste de toutes les
// fiches, une fiche à modifier, ou le choix entre deux fiches qui portent le
// même nom. Chaque saisie est prise en compte aussitôt ; la fiche s'enregistre
// avec le texte, par Ctrl+S ou par le bouton « Enregistrer » en bas de la fiche,
// qui ferme ensuite le panneau (et demande d'abord, pour un texte jamais
// enregistré, s'il faut l'enregistrer).

import { DRAMATIC_FUNCTIONS, UNNAMED, displayName, emptySheet, isFullSheet, isValidSheet, newSheetId } from "./fiches.ts";
import type { CustomField, Importance, Relation, Sheet, SheetsFile } from "./fiches.ts";
import type { Reply } from "./fiches-detection.ts";

export interface PanelHost {
  file(): SheetsFile;
  // Une fiche a été modifiée, ajoutée ou supprimée ; castChanged : ce qui
  // compose la liste en tête de pièce a changé (nom, présentation, fiche).
  changed(file: SheetsFile, castChanged: boolean): void;
  // Les répliques du personnage ; undefined hors scénario et théâtre.
  replies(sheet: Sheet): Reply[] | undefined;
  // Au théâtre, si l'auteur a refusé que l'app tienne la liste : l'action
  // qui refait la proposition.
  castOffer(): (() => void) | undefined;
  // Enregistre le texte et ses fiches, comme Ctrl+S ; true si c'est fait.
  save(): Promise<boolean>;
  // Vrai si le texte n'a encore jamais été enregistré.
  untitled(): boolean;
  goTo(pos: number): void;
  // La fiche affichée change (undefined : aucune), pour surligner ses noms.
  shown(id: string | undefined): void;
  closed(): void;
}

export interface Panel {
  showList(): void;
  showSheet(id: string, focus?: boolean): void;
  showChoice(ids: string[]): void;
  newSheet(firstName?: string, focus?: boolean): void;
  showReplies(id: string): void;
  close(): void;
  isOpen(): boolean;
  refresh(): void;
}

type FieldKey = Exclude<keyof Sheet, "id" | "created" | "importance" | "functions" | "relations" | "custom">;

const IMPORTANCES: [Importance, string][] = [
  ["", "—"],
  ["principal", "Principal"],
  ["secondaire", "Secondaire"],
  ["figurant", "Figurant"],
];

// Ce qui compose une ligne de la liste en tête de pièce.
const CAST_FIELDS = new Set<FieldKey>(["firstName", "lastName", "nickname", "castLine"]);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "class") node.className = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

function button(label: string, action: () => void, className = "button"): HTMLButtonElement {
  const node = el("button", { type: "button", class: className }, label);
  node.addEventListener("click", action);
  return node;
}

export function createPanel(root: HTMLElement, host: PanelHost): Panel {
  let view: { kind: "list" } | { kind: "sheet"; id: string } | { kind: "choice"; ids: string[] } = { kind: "list" };
  // Une fiche neuve, pas encore nommée : elle n'entre dans le fichier qu'avec
  // un prénom, un nom ou un surnom.
  let draft: Sheet | undefined;
  // Les figurants dont on a demandé toute la fiche.
  const expanded = new Set<string>();
  let fieldCount = 0;

  const file = () => host.file();

  // Redessine la fiche, puis rend le focus clavier à l'élément voulu : sans
  // lui, il tomberait sur la page, et Échap ne fermerait plus le panneau.
  function rerender(sheet: Sheet, selector: string) {
    api.showSheet(sheet.id, false);
    (root.querySelector<HTMLElement>(selector) ?? root.querySelector<HTMLElement>("button"))?.focus();
  }
  const sheetById = (id: string) => (draft?.id === id ? draft : file().personnages.find((s) => s.id === id));

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      api.close();
    }
  });

  function header(title: string, back: boolean): HTMLElement {
    const bar = el("div", { class: "people-bar" });
    if (back) bar.append(button("Tous les personnages", () => api.showList(), "people-link"));
    const close = button("✕", () => api.close(), "people-close");
    close.setAttribute("aria-label", "Fermer le panneau des personnages");
    bar.append(close);
    return el("header", {}, bar, el("h2", { id: "people-title" }, title));
  }

  function render(nodes: Node[]) {
    root.replaceChildren(...nodes);
    root.hidden = false;
  }

  // Le contenu a changé : le fichier est prévenu, et la fiche neuve y entre
  // dès qu'elle a un nom.
  function commit(sheet: Sheet, cast: boolean) {
    const current = file();
    if (draft && sheet === draft && isValidSheet(draft)) {
      current.personnages.push(draft);
      draft = undefined;
      cast = true;
    }
    host.changed(current, cast);
  }

  function textField(sheet: Sheet, key: FieldKey, label: string, long = false): HTMLElement {
    const id = `people-field-${fieldCount++}`;
    const input = long ? el("textarea", { id, rows: "2" }) : el("input", { id, type: "text" });
    input.value = sheet[key];
    input.addEventListener("input", () => {
      sheet[key] = input.value;
      if (CAST_FIELDS.has(key) && key !== "castLine") {
        const title = root.querySelector("#people-title");
        if (title) title.textContent = displayName(sheet) || "Nouveau personnage";
        warning.hidden = isValidSheet(sheet);
      }
      commit(sheet, false);
    });
    // La liste en tête de pièce n'est refaite qu'en quittant le champ.
    if (CAST_FIELDS.has(key)) input.addEventListener("change", () => commit(sheet, true));
    return el("div", { class: "people-field" }, el("label", { for: id }, label), input);
  }

  const warning = el("p", { class: "people-warning", role: "alert" }, "Il faut au moins un prénom, un nom ou un surnom.");

  function block(title: string, ...children: Node[]): HTMLElement {
    return el("section", { class: "people-block" }, el("h3", {}, title), ...children);
  }

  function keyedBlock(key: string, title: string, ...children: Node[]): HTMLElement {
    const section = block(title, ...children);
    section.dataset.block = key;
    return section;
  }

  function importanceField(sheet: Sheet): HTMLElement {
    const id = `people-field-${fieldCount++}`;
    const select = el("select", { id, "data-field": "importance" });
    for (const [value, label] of IMPORTANCES) select.append(el("option", { value }, label));
    select.value = sheet.importance;
    select.addEventListener("change", () => {
      sheet.importance = select.value as Importance;
      commit(sheet, false);
      rerender(sheet, 'select[data-field="importance"]');
    });
    return el("div", { class: "people-field" }, el("label", { for: id }, "Importance"), select);
  }

  function functionsField(sheet: Sheet): HTMLElement {
    const box = el("fieldset", { class: "people-functions" }, el("legend", {}, "Fonction dramatique"));
    for (const name of DRAMATIC_FUNCTIONS) {
      const check = el("input", { type: "checkbox" });
      check.checked = sheet.functions.includes(name);
      check.addEventListener("change", () => {
        sheet.functions = check.checked ? [...sheet.functions, name] : sheet.functions.filter((f) => f !== name);
        commit(sheet, false);
      });
      box.append(el("label", {}, check, name));
    }
    // Saisie libre : les fonctions qui ne sont pas dans la liste, séparées par des virgules.
    const id = `people-field-${fieldCount++}`;
    const other = el("input", { id, type: "text" });
    other.value = sheet.functions.filter((f) => !DRAMATIC_FUNCTIONS.includes(f)).join(", ");
    other.addEventListener("input", () => {
      const free = other.value.split(",").map((f) => f.trim()).filter(Boolean);
      sheet.functions = [...sheet.functions.filter((f) => DRAMATIC_FUNCTIONS.includes(f)), ...free];
      commit(sheet, false);
    });
    box.append(el("div", { class: "people-field" }, el("label", { for: id }, "Autre fonction"), other));
    return box;
  }

  function relationsField(sheet: Sheet): HTMLElement {
    const others = file().personnages.filter((s) => s.id !== sheet.id);
    const list = el("ul", { class: "people-rows" });
    sheet.relations.forEach((relation: Relation, index) => {
      const select = el("select", { "aria-label": "Autre personnage" });
      for (const other of others) select.append(el("option", { value: other.id }, displayName(other)));
      select.value = relation.to;
      select.addEventListener("change", () => {
        relation.to = select.value;
        commit(sheet, false);
      });
      const nature = el("input", { type: "text", "aria-label": "Nature du lien", placeholder: "nature du lien" });
      nature.value = relation.nature;
      nature.addEventListener("input", () => {
        relation.nature = nature.value;
        commit(sheet, false);
      });
      list.append(
        el("li", {}, select, nature, button("Retirer", () => {
          sheet.relations.splice(index, 1);
          commit(sheet, false);
          rerender(sheet, '[data-block="relations"] > button');
        })),
      );
    });
    const add = button("Ajouter une relation", () => {
      sheet.relations.push({ to: others[0].id, nature: "" });
      commit(sheet, false);
      rerender(sheet, '[data-block="relations"] li:last-child select');
    });
    add.disabled = others.length === 0;
    return keyedBlock("relations", "Relations", list, add);
  }

  function customField(sheet: Sheet): HTMLElement {
    const list = el("ul", { class: "people-rows" });
    sheet.custom.forEach((field: CustomField, index) => {
      const label = el("input", { type: "text", "aria-label": "Nom du champ", placeholder: "nom du champ" });
      label.value = field.label;
      label.addEventListener("input", () => {
        field.label = label.value;
        commit(sheet, false);
      });
      const value = el("input", { type: "text", "aria-label": "Valeur", placeholder: "valeur" });
      value.value = field.value;
      value.addEventListener("input", () => {
        field.value = value.value;
        commit(sheet, false);
      });
      list.append(
        el("li", {}, label, value, button("Retirer", () => {
          sheet.custom.splice(index, 1);
          commit(sheet, false);
          rerender(sheet, '[data-block="custom"] > button');
        })),
      );
    });
    return keyedBlock("custom", "Champs personnalisés", list, button("Ajouter un champ", () => {
      sheet.custom.push({ label: "", value: "" });
      commit(sheet, false);
      rerender(sheet, '[data-block="custom"] li:last-child input');
    }));
  }

  function repliesBlock(replies: Reply[]): HTMLElement {
    const list = el("ol", { class: "people-replies" });
    for (const reply of replies) {
      const text = el("span", {});
      for (const part of reply.parts) text.append(part.stage ? el("em", {}, part.text, " ") : `${part.text} `);
      const go = el("button", { type: "button", class: "people-reply" }, el("small", {}, reply.where || "—"), text);
      go.addEventListener("click", () => host.goTo(reply.from));
      list.append(el("li", {}, go));
    }
    if (replies.length === 0) list.append(el("li", { class: "empty" }, "Aucune réplique."));
    return el("section", { class: "people-block", id: "people-replies" }, el("h3", { tabindex: "-1" }, "Répliques"), list);
  }

  function confirmDelete(sheet: Sheet) {
    const dialog = el("dialog", { "aria-labelledby": "people-delete-title" });
    const form = el(
      "form",
      { method: "dialog" },
      el("h2", { id: "people-delete-title" }, "Supprimer la fiche"),
      el("p", {}, `La fiche de ${displayName(sheet) || "ce personnage"} sera supprimée. Le texte ne change pas.`),
      el("div", { class: "actions" }, el("button", { value: "cancel" }, "Annuler"), el("button", { value: "confirm", class: "primary" }, "Supprimer")),
    );
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (dialog.returnValue !== "confirm") return;
      const current = file();
      current.personnages = current.personnages.filter((s) => s.id !== sheet.id);
      for (const other of current.personnages) other.relations = other.relations.filter((r) => r.to !== sheet.id);
      if (draft?.id === sheet.id) draft = undefined;
      host.changed(current, true);
      api.showList();
    });
    dialog.showModal();
  }

  // Enregistrée, la fiche se ferme ; le pied de page le confirme. Un texte
  // jamais enregistré demande d'abord s'il faut l'enregistrer.
  async function saveSheet() {
    if (host.untitled() && !(await confirmSaveText())) return;
    if (await host.save()) api.close();
  }

  function confirmSaveText(): Promise<boolean> {
    const dialog = el("dialog", { "aria-labelledby": "people-save-title", "aria-describedby": "people-save-message" });
    const form = el(
      "form",
      { method: "dialog" },
      el("h2", { id: "people-save-title" }, "Enregistrer le texte"),
      el("p", { id: "people-save-message" }, "Ce texte n'a pas encore été enregistré. La fiche s'enregistre avec lui."),
      el("div", { class: "actions" }, el("button", { value: "cancel" }, "Annuler"), el("button", { value: "confirm", class: "primary" }, "Enregistrer le texte…")),
    );
    dialog.append(form);
    document.body.append(dialog);
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        dialog.remove();
        resolve(dialog.returnValue === "confirm");
      });
      dialog.showModal();
    });
  }

  function renderSheet(sheet: Sheet, focus: boolean) {
    fieldCount = 0;
    const full = isFullSheet(sheet) || expanded.has(sheet.id);
    warning.hidden = isValidSheet(sheet);
    const nodes: Node[] = [
      header(displayName(sheet) || "Nouveau personnage", true),
      warning,
      block(
        "En-tête",
        textField(sheet, "firstName", "Prénom"),
        textField(sheet, "lastName", "Nom"),
        textField(sheet, "nickname", "Surnom"),
        importanceField(sheet),
        functionsField(sheet),
        textField(sheet, "summary", "Résumé en une phrase"),
        textField(sheet, "castLine", "Présentation dans la liste des personnages"),
      ),
      block(
        "Identité",
        textField(sheet, "age", "Âge"),
        textField(sheet, "job", "Métier"),
        textField(sheet, "place", "Lieu"),
        textField(sheet, "physical", "Description physique", true),
        textField(sheet, "voice", "Voix", true),
      ),
    ];
    if (full) {
      nodes.push(
        keyedBlock(
          "moteur",
          "Moteur dramatique",
          textField(sheet, "desire", "Désir", true),
          textField(sheet, "need", "Besoin", true),
          textField(sheet, "flaw", "Faille", true),
          textField(sheet, "wound", "Blessure", true),
          textField(sheet, "belief", "Croyance erronée", true),
          textField(sheet, "fear", "Plus grande peur", true),
          textField(sheet, "secret", "Secret", true),
        ),
        block("Arc", textField(sheet, "arcStart", "Au début", true), textField(sheet, "arcEnd", "À la fin", true), textField(sheet, "arcChange", "Ce qui le fait changer", true)),
        relationsField(sheet),
        block("Notes", textField(sheet, "notes", "Notes libres", true)),
        customField(sheet),
      );
    } else {
      nodes.push(button("Afficher toute la fiche", () => {
        expanded.add(sheet.id);
        rerender(sheet, '[data-block="moteur"] textarea');
      }));
    }
    const replies = host.replies(sheet);
    if (replies) nodes.push(repliesBlock(replies));
    const end = el("div", { class: "people-end" }, button("Enregistrer", saveSheet, "button primary"));
    if (sheet !== draft) end.append(button("Supprimer la fiche", () => confirmDelete(sheet)));
    nodes.push(end);
    render(nodes);
    host.shown(sheet === draft ? undefined : sheet.id);
    if (focus) root.querySelector<HTMLInputElement>("input")?.focus();
  }

  function renderList() {
    const current = file();
    const sheets = [...current.personnages].sort((a, b) => displayName(a).localeCompare(displayName(b), "fr"));
    const list = el("ul", { class: "people-list" });
    for (const sheet of sheets) {
      const open = button(displayName(sheet) || UNNAMED, () => api.showSheet(sheet.id, true), "people-entry");
      const importance = IMPORTANCES.find(([value]) => value === sheet.importance)?.[1];
      if (sheet.importance && importance) open.append(el("small", {}, importance));
      list.append(el("li", {}, open));
    }
    const nodes: Node[] = [header("Personnages", false), button("Nouveau personnage", () => api.newSheet(undefined, true), "button primary")];
    nodes.push(sheets.length ? list : el("p", { class: "people-empty" }, "Aucune fiche pour l'instant."));
    const offer = host.castOffer();
    if (offer) nodes.push(button("Tenir la liste en tête de pièce à jour", offer));
    if (current.ecartes.length) {
      const ignored = el("ul", { class: "people-list" });
      for (const word of current.ecartes) {
        ignored.append(
          el("li", {}, el("span", {}, word), button("Ne plus écarter", () => {
            current.ecartes = current.ecartes.filter((w) => w !== word);
            host.changed(current, false);
            renderList();
          })),
        );
      }
      nodes.push(el("section", { class: "people-block" }, el("h3", {}, "Mots écartés"), ignored));
    }
    render(nodes);
    host.shown(undefined);
  }

  function renderChoice(ids: string[]) {
    const list = el("ul", { class: "people-list" });
    for (const id of ids) {
      const sheet = sheetById(id);
      if (sheet) list.append(el("li", {}, button(displayName(sheet), () => api.showSheet(id, true), "people-entry")));
    }
    render([header("Quel personnage ?", true), el("p", {}, "Plusieurs fiches portent ce nom."), list]);
    root.querySelector<HTMLButtonElement>(".people-entry")?.focus();
  }

  const api: Panel = {
    showList() {
      view = { kind: "list" };
      renderList();
      root.querySelector<HTMLButtonElement>(".button.primary")?.focus();
    },
    showSheet(id, focus = false) {
      const sheet = sheetById(id);
      if (!sheet) return api.showList();
      view = { kind: "sheet", id };
      renderSheet(sheet, focus);
    },
    showChoice(ids) {
      view = { kind: "choice", ids };
      renderChoice(ids);
    },
    newSheet(firstName, focus = true) {
      const sheet = emptySheet(newSheetId(), Date.now());
      if (firstName) {
        sheet.firstName = firstName;
        const current = file();
        current.personnages.push(sheet);
        host.changed(current, true);
      } else {
        draft = sheet;
      }
      view = { kind: "sheet", id: sheet.id };
      renderSheet(sheet, focus);
    },
    showReplies(id) {
      api.showSheet(id, false);
      const heading = root.querySelector<HTMLElement>("#people-replies h3");
      heading?.scrollIntoView({ block: "start" });
      heading?.focus();
    },
    close() {
      root.hidden = true;
      root.replaceChildren();
      draft = undefined;
      host.shown(undefined);
      host.closed();
    },
    isOpen: () => !root.hidden,
    // Redessine la vue affichée (le texte ou les fiches ont changé), sauf
    // pendant une saisie dans le panneau, pour ne pas perdre le curseur.
    refresh() {
      if (root.hidden || root.contains(document.activeElement)) return;
      if (view.kind === "list") renderList();
      else if (view.kind === "choice") renderChoice(view.ids);
      else {
        const sheet = sheetById(view.id);
        if (sheet) renderSheet(sheet, false);
        else renderList();
      }
    },
  };
  return api;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { keymap } from "@codemirror/view";
import { playLanguage } from "../src/theatre-editeur.ts";

test("dans une pièce, Entrée ne prolonge pas une liste Markdown commencée dans une réplique", () => {
  const state = EditorState.create({ doc: "CLAIRE\n- Non, je reste.", extensions: [playLanguage()] });
  const bindings = state.facet(keymap).flat();
  assert.ok(!bindings.some((binding) => binding.run === insertNewlineContinueMarkup));
});

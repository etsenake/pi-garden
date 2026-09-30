import assert from "node:assert/strict";
import test from "node:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
  composeAutocompleteProviders,
  cursorToLineCol,
  lineColToCursor,
  runAutocompleteApply,
  runAutocompleteQuery,
} from "../dist/editor-autocomplete.js";

function provider(trigger: string, prefix: string, replacement: string): AutocompleteProvider {
  return {
    triggerCharacters: [trigger],
    async getSuggestions(lines, line, col, context) {
      if (context.signal.aborted) return null;
      const current = lines[line] ?? "";
      if (!current.slice(0, col).endsWith(trigger) && !context.force) return null;
      return {
        items: [{ value: replacement, label: replacement }],
        prefix,
      };
    },
    applyCompletion(lines, line, col, item, appliedPrefix) {
      const current = lines[line] ?? "";
      const start = Math.max(0, col - appliedPrefix.length);
      const next = `${current.slice(0, start)}${item.value}${current.slice(col)}`;
      const copy = [...lines];
      copy[line] = next;
      return { lines: copy, cursorLine: line, cursorCol: start + item.value.length };
    },
  };
}

test("cursor coordinates survive a multiline draft", () => {
  const text = "one\ntwo\nthree";
  const cursor = text.indexOf("three") + 2;
  const position = cursorToLineCol(text, cursor);
  assert.equal(position.line, 2);
  assert.equal(position.col, 2);
  assert.equal(lineColToCursor(position.lines, position.line, position.col), cursor);
});

test("providers wrap in registration order and union trigger characters", () => {
  const base = provider(":", ":", "base");
  const chain = composeAutocompleteProviders(base, [
    (current) => {
      const wrapped = provider("@", "@", "inner");
      const getSuggestions = wrapped.getSuggestions.bind(wrapped);
      return {
        ...wrapped,
        triggerCharacters: ["@", ...(current.triggerCharacters ?? [])],
        getSuggestions,
        applyCompletion: (lines, line, col, item, prefix) =>
          current.applyCompletion(lines, line, col, item, prefix),
      };
    },
    () => {
      throw new Error("broken provider");
    },
  ]);
  assert.deepEqual(chain.triggerCharacters, ["@", ":"]);
  assert.deepEqual(chain.errors, ["broken provider"]);
});

test("completion uses the provider prefix and returned cursor", async () => {
  const active = provider("@", "@jo", "josh");
  const applied = runAutocompleteApply(active, {
    text: "hello @jo",
    cursor: "hello @jo".length,
    prefix: "@jo",
    item: { label: "josh", value: "josh" },
  });
  assert.deepEqual(applied, { text: "hello josh", cursor: "hello josh".length });
});

test("an aborted query does not return suggestions", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runAutocompleteQuery(
    provider("@", "@", "josh"),
    { text: "@", cursor: 1 },
    controller.signal,
  );
  assert.deepEqual(result.items, []);
});

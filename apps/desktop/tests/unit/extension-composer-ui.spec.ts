import { expect, test } from "@playwright/test";
import type { SessionExtensionUiStateRecord } from "../../contracts/desktop-state";
import {
  MAX_WIDGET_LINES,
  plainText,
  statusesForDisplay,
  widgetsForPlacement,
} from "../../src/features/extensions/extension-session-ui";

function uiState(
  overrides: Partial<SessionExtensionUiStateRecord> = {},
): SessionExtensionUiStateRecord {
  return {
    instanceId: "instance",
    statuses: [],
    widgets: [],
    pendingDialogs: [],
    working: { visible: true },
    toolsExpanded: false,
    ...overrides,
  };
}

test("keeps widget insertion order inside each placement and drops blank widgets", () => {
  const state = uiState({
    widgets: [
      { key: "zeta", lines: ["Zeta", "  child"], placement: "aboveComposer" },
      { key: "alpha", lines: ["\u001b[32mAlpha\u001b[0m"], placement: "aboveComposer" },
      { key: "blank", lines: ["\u001b[31m\u001b[0m", "   "], placement: "aboveComposer" },
      { key: "below", lines: ["Below"], placement: "belowComposer" },
    ],
  });

  const above = widgetsForPlacement(state, "aboveComposer");
  expect(above.map((widget) => widget.key)).toEqual(["zeta", "alpha"]);
  expect(above[0]?.lines.map(plainText)).toEqual(["Zeta", "  child"]);
  expect(above[1]?.lines).toEqual([
    [{ text: "Alpha", style: { foreground: { name: "green", bright: false } } }],
  ]);
  const below = widgetsForPlacement(state, "belowComposer");
  expect(
    below.map((widget) => [widget.key, widget.lines.map(plainText), widget.truncated]),
  ).toEqual([["below", ["Below"], false]]);
  expect(widgetsForPlacement(undefined, "aboveComposer")).toEqual([]);
});

test("applies Pi's widget line cap and marks truncation", () => {
  const lines = Array.from({ length: MAX_WIDGET_LINES + 3 }, (_, index) => `line ${index + 1}`);
  const state = uiState({ widgets: [{ key: "long", lines, placement: "aboveComposer" }] });

  const [widget] = widgetsForPlacement(state, "aboveComposer");
  expect(widget?.lines).toHaveLength(MAX_WIDGET_LINES);
  expect(widget?.lines.map(plainText).at(-1)).toBe(`line ${MAX_WIDGET_LINES}`);
  expect(widget?.truncated).toBe(true);

  // Embedded newlines count as lines too, as they render that way.
  const joined = uiState({
    widgets: [{ key: "joined", lines: ["a\nb\r\nc"], placement: "aboveComposer" }],
  });
  expect(widgetsForPlacement(joined, "aboveComposer")[0]?.lines.map(plainText)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

test("sorts status text by key, flattens it to one line, and keeps styling", () => {
  const state = uiState({
    statuses: [
      { key: "zeta", text: "Last\nkey" },
      { key: "alpha", text: "  \u001b[32mFirst\tkey\u001b[0m  " },
      { key: "empty", text: "   " },
    ],
  });

  const statuses = statusesForDisplay(state);
  expect(statuses.map((status) => [status.key, plainText(status.segments)])).toEqual([
    ["alpha", "First key"],
    ["zeta", "Last key"],
  ]);
  expect(statuses[0]?.segments[0]?.style).toEqual({ foreground: { name: "green", bright: false } });
  expect(statusesForDisplay(undefined)).toEqual([]);
});

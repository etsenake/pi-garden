import { expect, test } from "@playwright/test";
import type { SessionExtensionUiStateRecord } from "../../contracts/desktop-state";
import {
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

  expect(widgetsForPlacement(state, "aboveComposer").map((widget) => widget.key)).toEqual([
    "zeta",
    "alpha",
  ]);
  expect(widgetsForPlacement(state, "aboveComposer")[0]?.lines).toEqual(["Zeta", "  child"]);
  expect(widgetsForPlacement(state, "aboveComposer")[1]?.lines).toEqual(["Alpha"]);
  expect(widgetsForPlacement(state, "belowComposer")).toEqual([{ key: "below", lines: ["Below"] }]);
  expect(widgetsForPlacement(undefined, "aboveComposer")).toEqual([]);
});

test("sorts status text by key and flattens it to one line", () => {
  const state = uiState({
    statuses: [
      { key: "zeta", text: "Last\nkey" },
      { key: "alpha", text: "\u001b[32mFirst\tkey\u001b[0m" },
      { key: "empty", text: "   " },
    ],
  });

  expect(statusesForDisplay(state)).toEqual([
    { key: "alpha", text: "First key" },
    { key: "zeta", text: "Last key" },
  ]);
  expect(statusesForDisplay(undefined)).toEqual([]);
});

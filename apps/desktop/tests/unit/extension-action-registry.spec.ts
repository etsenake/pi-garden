import { expect, test } from "@playwright/test";
import { STALE_EXTENSION_ACTION_MESSAGE } from "@pi-garden/extension-ui";
import { resolveExtensionActions } from "../../contracts/extension-actions";
import { ExtensionActionRegistry } from "../../electron/extensions/extension-action-registry";

const sessionA = { workspaceId: "workspace-a", sessionId: "session-a" };
const sessionB = { workspaceId: "workspace-b", sessionId: "session-b" };

test("built-in chords win, the earlier extension path wins, and duplicate ids stay explicit", () => {
  const resolved = resolveExtensionActions(
    [
      {
        id: "later",
        kind: "action",
        title: "Later",
        extensionPath: "/ext/zzz.ts",
        shortcut: "ctrl+shift+y",
      },
      {
        id: "earlier",
        kind: "action",
        title: "Earlier",
        extensionPath: "/ext/aaa.ts",
        shortcut: "ctrl+shift+y",
      },
      {
        id: "palette",
        kind: "shortcut",
        title: "Palette",
        extensionPath: "/ext/clash.ts",
        shortcut: "super+k",
      },
      {
        id: "mark-plot",
        kind: "action",
        title: "First",
        extensionPath: "/ext/aaa.ts",
      },
      {
        id: "mark-plot",
        kind: "action",
        title: "Duplicate",
        extensionPath: "/ext/zzz.ts",
      },
    ],
    "darwin",
  );

  expect(resolved.actions.find((action) => action.id === "earlier")?.shortcut).toBe("ctrl+shift+y");
  expect(resolved.actions.find((action) => action.id === "later")?.shortcut).toBeUndefined();
  expect(resolved.actions.find((action) => action.id === "palette")?.shortcut).toBeUndefined();
  expect(resolved.actions.filter((action) => action.id === "mark-plot")).toEqual([
    {
      id: "mark-plot",
      kind: "action",
      title: "First",
      extensionPath: "/ext/aaa.ts",
    },
  ]);
  expect(resolved.conflicts.map((conflict) => conflict.reason).sort()).toEqual([
    "builtin-shortcut",
    "duplicate-action",
    "extension-shortcut",
  ]);
});

test("a replaced generation cannot be listed or invoked, and another session stays independent", async () => {
  const invoked: string[] = [];
  const registry = new ExtensionActionRegistry();
  registry.bind({
    invoke: async (_target, generation, actionId) => {
      invoked.push(`${generation}:${actionId}`);
    },
    complete: async () => [{ value: "plot", label: "plot" }],
  });
  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-1",
    actions: [
      {
        id: "mark-plot",
        kind: "action",
        title: "Mark",
        extensionPath: "/ext/garden.ts",
        shortcut: "ctrl+shift+m",
      },
      {
        id: "command:garden-echo",
        kind: "command",
        title: "Echo a garden plot",
        extensionPath: "/ext/garden.ts",
        commandName: "garden-echo",
        hasArgumentCompletions: true,
      },
    ],
  });
  registry.replaceRuntime({
    target: sessionB,
    generation: "gen-b",
    actions: [
      {
        id: "mark-plot",
        kind: "action",
        title: "Other",
        extensionPath: "/other/garden.ts",
      },
    ],
  });

  expect(registry.catalog(sessionA)?.actions.map((action) => action.id)).toEqual([
    "command:garden-echo",
    "mark-plot",
  ]);
  await registry.invoke(sessionA, "gen-1", "mark-plot", undefined);
  expect(invoked).toEqual(["gen-1:mark-plot"]);

  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-2",
    actions: [
      {
        id: "mark-plot",
        kind: "action",
        title: "Mark",
        extensionPath: "/ext/garden.ts",
      },
    ],
  });
  expect(registry.catalog(sessionA)?.generation).toBe("gen-2");
  expect(registry.catalog(sessionA)?.actions).toHaveLength(1);
  await expect(registry.invoke(sessionA, "gen-1", "mark-plot", undefined)).rejects.toThrow(
    STALE_EXTENSION_ACTION_MESSAGE,
  );
  expect(await registry.complete(sessionA, "gen-1", "garden-echo", "pl")).toEqual([]);
  expect(registry.catalog(sessionB)?.generation).toBe("gen-b");

  registry.invalidateRuntime(sessionA, "gen-2");
  expect(registry.catalog(sessionA)).toBeUndefined();
  await expect(registry.invoke(sessionA, "gen-2", "mark-plot", undefined)).rejects.toThrow(
    STALE_EXTENSION_ACTION_MESSAGE,
  );
  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-2",
    actions: [
      {
        id: "mark-plot",
        kind: "action",
        title: "Mark",
        extensionPath: "/ext/garden.ts",
      },
    ],
  });
  expect(registry.catalog(sessionA)).toBeUndefined();
  expect(invoked).toEqual(["gen-1:mark-plot"]);
});

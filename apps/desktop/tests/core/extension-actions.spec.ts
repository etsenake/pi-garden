import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { ExtensionActionCatalog } from "../../contracts/extension-actions";
import {
  addWorkspaceViaIpc,
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openWindowViaShortcut,
  seedAgentDir,
  selectSession,
  writeProjectExtension,
} from "../helpers/electron-app";
import { desktopShortcut } from "../helpers/native-input";

const require = createRequire(__filename);
const helperPath = require.resolve("@pi-garden/extension-ui");

async function logLines(logPath: string): Promise<string[]> {
  const text = await readFile(logPath, "utf8").catch(() => "");
  return text.split("\n").filter((line) => line.length > 0);
}

async function catalog(window: Page): Promise<ExtensionActionCatalog | null> {
  return window.evaluate(async () => {
    const app = globalThis.window.piApp;
    if (!app) throw new Error("piApp IPC bridge is unavailable");
    const state = await app.getState();
    if (!state.selectedWorkspaceId || !state.selectedSessionId) return null;
    return app.listExtensionActions({
      workspaceId: state.selectedWorkspaceId,
      sessionId: state.selectedSessionId,
    });
  });
}

test("extension actions, commands, and shortcuts share one identity", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspaceA = await makeWorkspace("garden-a");
  const workspaceB = await makeWorkspace("garden-b");
  const logPath = join(workspaceA, "garden-actions.log");
  await seedAgentDir(agentDir);
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(
    join(agentDir, "extensions", "garden-global.ts"),
    `export default function gardenGlobal(pi) {
  pi.registerCommand("garden-global", {
    description: "Global garden command",
    handler: async () => {},
  });
}
`,
    "utf8",
  );
  const extensionPath = await writeProjectExtension(
    workspaceA,
    "garden-interaction.ts",
    `import { appendFileSync } from "node:fs";
import { registerAction, registerComposerBefore } from ${JSON.stringify(helperPath)};
const logPath = ${JSON.stringify(logPath)};
export default function gardenInteraction(pi) {
  pi.registerCommand("garden-echo", {
    description: "Echo a garden plot",
    getArgumentCompletions: (prefix) => {
      if (prefix.startsWith("slow")) return new Promise(() => {});
      if (prefix.startsWith("fail")) throw new Error("completion failed");
      return ["plot", "plan", "patch"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value, description: "A garden " + value }));
    },
    handler: async (args, ctx) => {
      appendFileSync(logPath, "command:" + args + "\\n");
      ctx.ui.setStatus("garden-action", "echo " + args);
    },
  });
  registerAction(pi, {
    id: "mark-plot",
    title: "Mark garden plot",
    source: import.meta.url,
    shortcut: "ctrl+shift+m",
    handler: async (ctx) => {
      appendFileSync(logPath, "action\\n");
      ctx.ui.setStatus("garden-action", "marked");
    },
  });
  registerComposerBefore(pi, { id: "mark-plot", text: "Mark plot", actionId: "mark-plot" });
}
`,
  );
  await writeProjectExtension(
    workspaceA,
    "aaa-keys.ts",
    `export default function aaaKeys(pi) {
  pi.registerShortcut("ctrl+shift+y", {
    description: "Earlier clash",
    handler: async (ctx) => {
      ctx.ui.setStatus("clash", "aaa");
    },
  });
}
`,
  );
  await writeProjectExtension(
    workspaceA,
    "zzz-keys.ts",
    `export default function zzzKeys(pi) {
  pi.registerShortcut("ctrl+shift+y", {
    description: "Later clash",
    handler: async (ctx) => {
      ctx.ui.setStatus("clash", "zzz");
    },
  });
}
`,
  );
  const builtinModifier = process.platform === "darwin" ? "super" : "ctrl";
  await writeProjectExtension(
    workspaceA,
    "builtin-clash.ts",
    `export default function builtinClash(pi) {
  pi.registerShortcut(${JSON.stringify(`${builtinModifier}+k`)}, {
    description: "Should not replace the palette",
    handler: async (ctx) => {
      ctx.ui.setStatus("builtin-clash", "ran");
    },
  });
}
`,
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspaceA],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Alpha thread");
    await createNamedThread(window, "Beta thread");
    const button = window.locator("[data-action-id='mark-plot']");
    await expect(button).toHaveCount(1);
    await expect(button).toHaveText("Mark plot");

    const initial = await catalog(window);
    expect(initial?.actions.some((action) => action.id === "mark-plot" && action.shortcut)).toBe(
      true,
    );
    expect(
      initial?.actions.find((action) => action.commandName === "garden-echo")?.description,
    ).toBe("Echo a garden plot");
    expect(initial?.conflicts.some((conflict) => conflict.reason === "builtin-shortcut")).toBe(
      true,
    );
    expect(initial?.conflicts.some((conflict) => conflict.reason === "extension-shortcut")).toBe(
      true,
    );
    const boundClash = initial?.actions.filter((action) => action.shortcut === "ctrl+shift+y");
    expect(boundClash).toHaveLength(1);
    expect(boundClash?.[0]?.extensionPath).toMatch(/aaa-keys\.ts$/);

    await button.click();
    await expect.poll(() => logLines(logPath)).toEqual(["action"]);
    await expect(window.locator("[data-status-key='garden-action']")).toHaveText("marked");

    await window.keyboard.press(desktopShortcut("K"));
    const palette = window.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await window.getByTestId("command-palette-input").fill("Mark garden plot");
    await palette.getByRole("option", { name: "Mark garden plot" }).click();
    await expect.poll(() => logLines(logPath)).toEqual(["action", "action"]);

    await window.keyboard.press("Control+Shift+M");
    await expect.poll(() => logLines(logPath)).toEqual(["action", "action", "action"]);

    await window.keyboard.press(desktopShortcut("K"));
    await expect(palette).toBeVisible();
    await expect(window.locator("[data-status-key='builtin-clash']")).toHaveCount(0);
    await window.keyboard.press("Escape");

    await window.keyboard.press("Control+Shift+Y");
    await expect(window.locator("[data-status-key='clash']")).toHaveText("aaa");

    const composer = window.getByTestId("composer");
    await composer.click();
    await composer.fill("/garden-echo");
    await expect(window.getByTestId("slash-menu")).toContainText("Echo a garden plot");
    await composer.fill("/garden-echo pl");
    const options = window.getByTestId("slash-options-menu");
    await expect(options).toBeVisible();
    await expect(options).toContainText("plot");
    await expect(options).toContainText("plan");
    await options.getByText("plot", { exact: true }).click();
    await expect(composer).toHaveValue("/garden-echo plot");
    await composer.press("Escape");
    await composer.press("Enter");
    await expect
      .poll(() => logLines(logPath))
      .toEqual(["action", "action", "action", "command:plot"]);

    await composer.fill("/garden-echo slow");
    await expect(options).toHaveCount(0);
    await expect(composer).toHaveValue("/garden-echo slow");
    await composer.fill("/garden-echo fail");
    await expect(options).toHaveCount(0);

    const staleGeneration = initial?.generation;
    expect(staleGeneration).toBeTruthy();
    await composer.fill("/reload ");
    await composer.press("Enter");
    await expect(button).toHaveCount(1);
    const reloaded = await catalog(window);
    expect(reloaded?.generation).not.toBe(staleGeneration);
    expect(reloaded?.actions.filter((action) => action.id === "mark-plot")).toHaveLength(1);
    const stale = await window.evaluate(async (generation) => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      try {
        await app.invokeExtensionAction({ actionId: "mark-plot", generation });
        return "invoked";
      } catch (error) {
        return error instanceof Error ? error.message : "failed";
      }
    }, staleGeneration ?? "");
    expect(stale).toMatch(/no longer available/);
    await expect
      .poll(() => logLines(logPath))
      .toEqual(["action", "action", "action", "command:plot"]);

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await window.getByRole("button", { name: /builtin-clash/i }).click();
    await expect(window.getByText(/built-in shortcut/)).toBeVisible();
    await window.getByRole("button", { name: "All extensions", exact: true }).click();
    await window.getByRole("button", { name: /garden-interaction/i }).click();
    await window.getByRole("switch", { name: "Enabled", exact: true }).click();
    await expect(window.getByRole("switch", { name: "Enabled", exact: true })).not.toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(button).toHaveCount(0);
    const disabled = await catalog(window);
    expect(disabled?.actions.some((action) => action.commandName === "garden-echo")).toBe(false);
    expect(disabled?.actions.some((action) => action.id === "mark-plot")).toBe(false);

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await window.getByRole("button", { name: /garden-interaction/i }).click();
    await window.getByRole("switch", { name: "Enabled", exact: true }).click();
    await expect(window.getByRole("switch", { name: "Enabled", exact: true })).toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(button).toHaveCount(1);

    await addWorkspaceViaIpc(window, workspaceB);
    await createNamedThread(window, "Other workspace thread", { workspaceName: "garden-b" });
    await expect(window.locator("[data-action-id='mark-plot']")).toHaveCount(0);
    const other = await catalog(window);
    expect(other?.actions.some((action) => action.commandName === "garden-echo")).toBe(false);
    expect(other?.actions.some((action) => action.commandName === "garden-global")).toBe(true);

    await selectSession(window, "Alpha thread");
    await expect(button).toHaveCount(1);
    const owner = await catalog(window);
    const secondWindow = await openWindowViaShortcut(harness, window);
    await selectSession(secondWindow, "Beta thread");
    await secondWindow.bringToFront();
    const before = (await logLines(logPath)).length;
    await window.evaluate(async (generation) => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.invokeExtensionAction({ actionId: "mark-plot", generation });
    }, owner?.generation ?? "");
    await expect(window.locator("[data-status-key='garden-action']")).toHaveText("marked");
    await expect(secondWindow.locator("[data-status-key='garden-action']")).toHaveCount(0);
    expect((await logLines(logPath)).length).toBe(before + 1);

    await unlink(extensionPath);
    await composer.fill("/reload ");
    await composer.press("Enter");
    await expect(button).toHaveCount(0);
    const removed = await catalog(window);
    expect(removed?.actions.some((action) => action.id === "mark-plot")).toBe(false);
    expect(removed?.actions.some((action) => action.commandName === "garden-global")).toBe(true);
  } finally {
    await harness.close();
  }
});

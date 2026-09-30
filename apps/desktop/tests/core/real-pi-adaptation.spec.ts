import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { createJiti } from "jiti";
import {
  createSessionViaIpc,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import {
  customHeaderFrontend,
  todoToolRendererFrontend,
  writeRealPiExtension,
} from "../helpers/real-pi-extension-fixtures";

/**
 * Real upstream Pi examples on the Electron surface after Adapt for Desktop
 * scaffolding plus semantic fill. Placeholder text alone is not enough.
 */
const nodeRequire = createRequire(__filename);
const jiti = createJiti(__filename);

test("adapted real Pi custom-header mounts its semantic app-header surface", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const workspacePath = await makeWorkspace("real-pi-custom-header");
  const entry = await writeRealPiExtension("custom-header", join(agentDir, "extensions"));
  const helper = dirname(dirname(nodeRequire.resolve("@pi-garden/extension-ui")));
  const { applyDesktopAdaptation } = await jiti.import<
    typeof import("../../electron/extensions/apply-desktop-adaptation")
  >("../../electron/extensions/apply-desktop-adaptation.ts");
  await applyDesktopAdaptation(entry, helper);
  await writeFile(join(dirname(entry), "pi-garden-desktop", "header.js"), customHeaderFrontend());

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Header session");
    await selectSession(window, "Header session");
    await expect(
      window
        .getByTestId("rich-surface-app-header")
        .frameLocator('[data-testid="rich-surface-frame"]')
        .getByTestId("pi-custom-header"),
    ).toHaveText("pi custom header", { timeout: 20_000 });
  } finally {
    await harness.close();
  }
});

test("adapted real Pi todo tool renderer shows tool arguments after a streamed call", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const workspacePath = await makeWorkspace("real-pi-todo");
  const entry = await writeRealPiExtension("todo", join(agentDir, "extensions"));
  const helper = dirname(dirname(nodeRequire.resolve("@pi-garden/extension-ui")));
  const { applyDesktopAdaptation } = await jiti.import<
    typeof import("../../electron/extensions/apply-desktop-adaptation")
  >("../../electron/extensions/apply-desktop-adaptation.ts");
  const result = await applyDesktopAdaptation(entry, helper);
  const toolId = result.pairs.find((pair) => pair.api === "registerDesktopToolRenderer")!.id;
  await writeFile(
    join(dirname(entry), "pi-garden-desktop", `${toolId}.js`),
    todoToolRendererFrontend(),
  );
  await writeFile(
    join(dirname(entry), "pi-garden-desktop", "custom.js"),
    `export function mount(root, host) {
  root.dataset.testid = "todo-overlay";
  root.textContent = "todos";
  return () => {};
}
`,
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Todo session");
    await selectSession(window, "Todo session");

    const state = await getDesktopState(window);
    const workspace = state.workspaces.find((entry) => entry.path === workspacePath)!;
    const session = workspace.sessions.find((entry) => entry.title === "Todo session")!;
    const sessionRef = { workspaceId: workspace.id, sessionId: session.id };
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "toolUpdated",
      sessionRef,
      timestamp,
      callId: "todo-1",
      toolName: "todo",
      input: { action: "add", text: "ship freeze" },
      argumentsComplete: true,
      executionStarted: true,
    });
    const row = window.locator('[data-tool-name="todo"]').first();
    await expect(row).toHaveAttribute("data-tool-renderer", "custom", { timeout: 20_000 });
    await expect(
      row.frameLocator('[data-testid="rich-surface-frame"]').getByTestId("todo-tool-renderer"),
    ).toContainText("add", { timeout: 20_000 });

    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "todo-1",
      success: true,
      output: {
        content: [{ type: "text", text: "Added todo #1: ship freeze" }],
        details: {
          action: "add",
          todos: [{ id: 1, text: "ship freeze", done: false }],
          nextId: 2,
        },
        isError: false,
      },
    });
    await expect(
      row.frameLocator('[data-testid="rich-surface-frame"]').getByTestId("todo-tool-renderer"),
    ).toContainText("Added todo #1", { timeout: 20_000 });
  } finally {
    await harness.close();
  }
});

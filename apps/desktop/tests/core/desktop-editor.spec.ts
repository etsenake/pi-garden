import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";
import type { SessionDriverEvent, SessionQueuedMessage } from "@pi-garden/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openWindowViaShortcut,
  seedAgentDir,
  selectSession,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { installDesktopEditorFixture } from "../helpers/desktop-editor-fixture";

const visible = { timeout: 20_000 };
const FRAME = '[data-testid="desktop-editor-frame"]';

function editorFrame(window: Page): FrameLocator {
  return window.frameLocator(FRAME);
}

/** Types into the sandboxed editor and waits for the canonical draft to follow. */
async function typeDraft(window: Page, text: string): Promise<Locator> {
  const field = editorFrame(window).locator("textarea");
  await field.fill(text);
  await expect(window.getByTestId("desktop-editor")).toHaveAttribute("data-draft", text, visible);
  return field;
}

async function pressInEditor(window: Page, key: string): Promise<void> {
  const field = editorFrame(window).locator("textarea");
  await field.focus();
  await window.keyboard.press(key);
}

async function sendSlash(window: Page, text: string): Promise<void> {
  await typeDraft(window, text);
  await pressInEditor(window, "Enter");
}

async function selectedItem(window: Page): Promise<string> {
  return window
    .getByTestId("editor-autocomplete-menu")
    .locator(".slash-menu__option--active .slash-menu__option-title")
    .innerText();
}

async function connectionOf(window: Page): Promise<string> {
  const src = await window.locator(FRAME).getAttribute("src");
  if (!src) throw new Error("The editor frame has no src");
  return new URL(src).hostname;
}

async function canMessageConnection(window: Page, connectionId: string): Promise<boolean> {
  return window.evaluate(async (id) => {
    try {
      await globalThis.window.piApp.sendExtensionViewMessage({
        connectionId: id,
        message: { type: "closed", reason: "probe" },
      });
      return true;
    } catch {
      return false;
    }
  }, connectionId);
}

async function launchWithEditor(name: string, withEditor = true) {
  const userDataDir = await makeUserDataDir();
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace(name);
  await seedAgentDir(agentDir);
  const fixture = await installDesktopEditorFixture({ workspacePath, withEditor });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const window = await harness.firstWindow();
  await waitForWorkspaceByPath(window, workspacePath);
  return { harness, window, workspacePath, extensionPath: fixture.extensionPath };
}

test("a custom editor replaces only the textarea and routes host menus, submit, and theme", async () => {
  test.setTimeout(180_000);
  const { harness, window } = await launchWithEditor("editor-garden");
  try {
    await createNamedThread(window, "Editor garden");
    const editor = window.getByTestId("desktop-editor");
    await expect(editor).toBeVisible(visible);
    await expect(window.getByTestId("composer")).toHaveCount(0);
    await expect(window.getByRole("button", { name: "Attach files" })).toBeVisible();
    await expect(window.getByTestId("send")).toBeVisible();
    const frame = editorFrame(window);
    await expect(frame.locator("#boundary")).toHaveText(
      JSON.stringify({
        preload: "undefined",
        process: "undefined",
        require: "undefined",
        parentAccess: "blocked",
        origin: "null",
      }),
      visible,
    );
    await expect(window.locator("[data-status-key='tui-editor']")).toHaveText(
      "function:false",
      visible,
    );

    // Extension trigger opens the shared host menu; arrows move the selection.
    const menu = window.getByTestId("editor-autocomplete-menu");
    const field = await typeDraft(window, ":");
    await expect(menu).toBeVisible(visible);
    await expect(menu.locator(".slash-menu__option")).toHaveCount(2);
    expect(await selectedItem(window)).toBe("garden");
    await pressInEditor(window, "ArrowDown");
    await expect.poll(() => selectedItem(window)).toBe("grove");
    await pressInEditor(window, "ArrowUp");
    await expect.poll(() => selectedItem(window)).toBe("garden");
    await expect(editor).toHaveAttribute("data-draft", ":");

    // Escape closes without submitting or changing the draft.
    await pressInEditor(window, "Escape");
    await expect(menu).toHaveCount(0);
    await expect(editor).toHaveAttribute("data-draft", ":");
    await expect(window.locator(".timeline")).not.toContainText(":");

    // Enter accepts the selected item: one host write, cursor after the completion.
    await typeDraft(window, "");
    await typeDraft(window, ":");
    await expect(menu).toBeVisible(visible);
    await pressInEditor(window, "ArrowDown");
    await expect.poll(() => selectedItem(window)).toBe("grove");
    await pressInEditor(window, "Enter");
    await expect(editor).toHaveAttribute("data-draft", "grove", visible);
    await expect(field).toHaveValue("grove");
    await expect(frame.locator("#host-updates")).toHaveText("1");
    await expect
      .poll(() => field.evaluate((node: HTMLTextAreaElement) => node.selectionStart))
      .toBe(5);
    await expect(field).toBeFocused();
    await expect(window.locator(".timeline")).not.toContainText("grove");

    // Tab accepts the selection while the menu is open.
    await typeDraft(window, "");
    await typeDraft(window, ":g");
    await expect(menu).toBeVisible(visible);
    await pressInEditor(window, "Tab");
    await expect(editor).toHaveAttribute("data-draft", "garden", visible);
    await expect(frame.locator("#host-updates")).toHaveText("2");
    await expect
      .poll(() => field.evaluate((node: HTMLTextAreaElement) => node.selectionStart))
      .toBe(6);

    // Tab with the menu closed forces a completion; a single match applies directly.
    await typeDraft(window, "");
    await typeDraft(window, "gr");
    await expect(menu).toHaveCount(0);
    await pressInEditor(window, "Tab");
    await expect(editor).toHaveAttribute("data-draft", "grove", visible);
    await expect(frame.locator("#host-updates")).toHaveText("3");
    await expect(field).toBeFocused();

    // Slash and @ mention contexts suppress extension autocomplete.
    await typeDraft(window, "");
    await typeDraft(window, "/model");
    await expect(menu).toHaveCount(0);
    await typeDraft(window, "");
    await typeDraft(window, "hello @jo");
    await expect(menu).toHaveCount(0);
    await expect(editor).toHaveAttribute("data-draft", "hello @jo");

    // Live theme change reaches the mounted frontend without a remount.
    const mountToken = await frame.locator("#mount").innerText();
    const connection = await connectionOf(window);
    await window.evaluate(async () => {
      await globalThis.window.piApp.setThemePresetId("tokyo-night");
    });
    await expect(frame.locator("#theme")).toHaveText("tokyo-night", visible);
    await expect(frame.locator("#mount")).toHaveText(mountToken);
    expect(await connectionOf(window)).toBe(connection);

    // Host commands still round-trip through the canonical draft.
    await sendSlash(window, "/editor-roundtrip ");
    await expect(window.locator(".timeline")).toContainText(
      "Editor before: [] after: [Prefilled +pasted]",
      visible,
    );
    await expect(field).toHaveValue("Prefilled +pasted", visible);
  } finally {
    await harness.close();
  }
});

test("a custom editor follows windows, reloads, crashes, and disabling without losing the draft", async () => {
  test.setTimeout(240_000);
  const { harness, window, workspacePath, extensionPath } =
    await launchWithEditor("editor-lifecycle");
  try {
    await createNamedThread(window, "Editor garden");
    const editor = window.getByTestId("desktop-editor");
    await expect(editor).toBeVisible(visible);
    const frame = editorFrame(window);
    const field = await typeDraft(window, "keep me");

    // Two windows: separate connections, each bound to its own window.
    const firstConnection = await connectionOf(window);
    const second = await openWindowViaShortcut(harness, window);
    await selectSession(second, "Editor garden");
    await expect(second.getByTestId("desktop-editor")).toBeVisible(visible);
    const secondConnection = await connectionOf(second);
    expect(secondConnection).not.toBe(firstConnection);
    expect(await canMessageConnection(second, firstConnection)).toBe(false);
    expect(await canMessageConnection(window, secondConnection)).toBe(false);
    await expect(editorFrame(second).locator("textarea")).toHaveValue("keep me", visible);

    // A new session in the first window gets its own connection.
    await createNamedThread(window, "Second garden");
    await expect.poll(() => connectionOf(window)).not.toBe(firstConnection);
    await selectSession(window, "Editor garden");
    await expect(field).toHaveValue("keep me", visible);

    // Reload replaces the generation; the stale connection cannot come back.
    const beforeReload = await connectionOf(window);
    const generationBefore = await editorGeneration(window);
    await typeDraft(window, "/reload ");
    await pressInEditor(window, "Enter");
    await expect.poll(() => connectionOf(window), visible).not.toBe(beforeReload);
    await expect.poll(() => editorGeneration(window)).not.toBe(generationBefore);
    await expect(window.locator(FRAME)).toHaveCount(1);
    await expect(frame.locator("#boundary")).toBeVisible(visible);
    expect(await canMessageConnection(window, beforeReload)).toBe(false);
    await expect.poll(() => readyEditors(window)).toEqual(["prompt"]);

    // A frontend crash falls back to the textarea and keeps the draft.
    await typeDraft(window, "keep me after crash");
    await field.evaluate(() => {
      setTimeout(() => {
        throw new Error("editor crashed");
      });
    });
    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible(visible);
    await expect(editor).toHaveCount(0);
    await expect(composer).toHaveValue("keep me after crash");

    // Reloading restores the editor with the same draft.
    await composer.fill("/reload ");
    await composer.press("Enter");
    await expect(editor).toBeVisible(visible);
    await expect(frame.locator("textarea")).toHaveValue("", visible);
    await typeDraft(window, "keep me after disable");

    // Disabling the owning extension falls back to the textarea and keeps the draft.
    await window.evaluate(
      async ({ targetWorkspacePath, targetExtensionPath }) => {
        const app = globalThis.window.piApp;
        const state = await app.getState();
        const workspace = state.workspaces.find((entry) => entry.path === targetWorkspacePath);
        if (!workspace) throw new Error(`Workspace not found: ${targetWorkspacePath}`);
        await app.setExtensionEnabled(workspace.id, targetExtensionPath, false);
      },
      { targetWorkspacePath: workspacePath, targetExtensionPath: extensionPath },
    );
    await expect(composer).toBeVisible(visible);
    await expect(editor).toHaveCount(0);
    await expect(composer).toHaveValue("keep me after disable");
  } finally {
    await harness.close();
  }
});

test("editing and cancelling a queued message focuses the custom editor", async () => {
  test.setTimeout(120_000);
  const { harness, window } = await launchWithEditor("editor-queued");
  try {
    await createNamedThread(window, "Editor garden");
    await expect(window.getByTestId("desktop-editor")).toBeVisible(visible);
    const field = await typeDraft(window, "local scratch draft");

    const queued: SessionQueuedMessage = {
      id: "queued-message-1",
      mode: "followUp",
      text: "Inspect the queued screenshot",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      updatedAt: new Date(Date.now() - 5_000).toISOString(),
    };
    await emitRunningSnapshot(harness, window, [queued]);
    const queuedCard = window.getByTestId("queued-composer-message").first();
    await expect(queuedCard).toBeVisible(visible);

    await queuedCard.getByRole("button", { name: "Edit" }).click();
    await expect(window.getByTestId("queued-composer-editing")).toContainText(
      "Editing queued message",
    );
    await expect(field).toHaveValue("Inspect the queued screenshot", visible);
    await expect(field).toBeFocused();
    await expect(window.locator(FRAME)).toBeFocused();

    await window.getByRole("button", { name: "Cancel" }).click();
    await expect(field).toHaveValue("local scratch draft", visible);
    await expect(field).toBeFocused();
    await expect(window.locator(FRAME)).toBeFocused();
  } finally {
    await harness.close();
  }
});

test("extension autocomplete applies on the default textarea without replacing it", async () => {
  test.setTimeout(180_000);
  const { harness, window } = await launchWithEditor("autocomplete-garden", false);
  try {
    await createNamedThread(window, "Autocomplete garden");
    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible(visible);
    await expect(window.getByTestId("desktop-editor")).toHaveCount(0);
    const menu = window.getByTestId("editor-autocomplete-menu");
    await composer.fill(":");
    await expect(menu).toBeVisible(visible);
    await expect(menu.locator(".slash-menu__option")).toHaveCount(2);
    await composer.press("ArrowDown");
    await expect.poll(() => selectedItem(window)).toBe("grove");
    await composer.press("ArrowUp");
    await expect.poll(() => selectedItem(window)).toBe("garden");
    await composer.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(composer).toHaveValue(":");
    await composer.fill("");
    await composer.fill(":");
    await expect(menu).toBeVisible(visible);
    await composer.press("ArrowDown");
    await composer.press("Enter");
    await expect(composer).toHaveValue("grove");
    await expect
      .poll(() => composer.evaluate((node: HTMLTextAreaElement) => node.selectionStart))
      .toBe(5);
    await composer.fill("ga");
    await composer.press("Tab");
    await expect(composer).toHaveValue("garden");
    await composer.fill("/editor-roundtrip ");
    await composer.press("Enter");
    await expect(window.locator(".timeline")).toContainText(
      "Editor before: [] after: [Prefilled +pasted]",
      visible,
    );
    await expect(composer).toHaveValue("Prefilled +pasted");
  } finally {
    await harness.close();
  }
});

async function editorGeneration(window: Page): Promise<string> {
  const editors = await listEditors(window);
  return editors.find((entry) => entry.state === "ready")?.generation ?? "";
}

async function readyEditors(window: Page): Promise<string[]> {
  return (await listEditors(window))
    .filter((entry) => entry.state === "ready")
    .map((entry) => entry.id);
}

async function listEditors(window: Page) {
  const state = await getDesktopState(window);
  return window.evaluate(
    ({ workspaceId, sessionId }) =>
      globalThis.window.piApp.listDesktopEditors({ workspaceId, sessionId }),
    { workspaceId: state.selectedWorkspaceId ?? "", sessionId: state.selectedSessionId ?? "" },
  );
}

async function emitRunningSnapshot(
  harness: Awaited<ReturnType<typeof launchDesktop>>,
  window: Page,
  queuedMessages: readonly SessionQueuedMessage[],
): Promise<void> {
  const state = await getDesktopState(window);
  const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
  const session = workspace?.sessions.find((entry) => entry.id === state.selectedSessionId);
  if (!workspace || !session) throw new Error("Expected a selected session");
  const sessionRef = { workspaceId: workspace.id, sessionId: session.id };
  const timestamp = new Date().toISOString();
  const event: Extract<SessionDriverEvent, { type: "sessionUpdated" }> = {
    type: "sessionUpdated",
    sessionRef,
    timestamp,
    runId: "desktop-editor-queued-run",
    snapshot: {
      ref: sessionRef,
      workspace: { workspaceId: workspace.id, path: workspace.path, displayName: workspace.name },
      title: session.title,
      status: "running",
      updatedAt: timestamp,
      preview: "Working…",
      runningRunId: "desktop-editor-queued-run",
      queuedMessages,
    },
  };
  await emitTestSessionEvent(harness, event);
}

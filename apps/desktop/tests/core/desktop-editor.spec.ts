import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { installDesktopEditorFixture } from "../helpers/desktop-editor-fixture";

const visible = { timeout: 20_000 };

async function sendSlash(window: Page, text: string): Promise<void> {
  const frame = window.frameLocator('[data-testid="desktop-editor-frame"]');
  const field = frame.locator("textarea");
  await field.fill(text);
  await expect(window.getByTestId("desktop-editor")).toHaveAttribute("data-draft", text, visible);
  await field.evaluate((node) => {
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

test("a custom editor replaces only the textarea and keeps host submission", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace("editor-garden");
  await seedAgentDir(agentDir);
  await installDesktopEditorFixture({ workspacePath });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Editor garden");
    const editor = window.getByTestId("desktop-editor");
    await expect(editor).toBeVisible(visible);
    await expect(window.getByTestId("composer")).toHaveCount(0);
    await expect(window.getByRole("button", { name: "Attach files" })).toBeVisible();
    await expect(window.getByTestId("send")).toBeVisible();
    const frame = editor.frameLocator('[data-testid="desktop-editor-frame"]');
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
    await sendSlash(window, "/editor-roundtrip ");
    await expect(window.locator(".timeline")).toContainText(
      "Editor before: [] after: [Prefilled +pasted]",
      visible,
    );
    await expect(frame.locator("textarea")).toHaveValue("Prefilled +pasted", visible);
  } finally {
    await harness.close();
  }
});

test("extension autocomplete applies on the default textarea without replacing it", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = `${userDataDir}/agent`;
  const workspacePath = await makeWorkspace("autocomplete-garden");
  await seedAgentDir(agentDir);
  await installDesktopEditorFixture({ workspacePath, withEditor: false });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Autocomplete garden");
    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible(visible);
    await expect(window.getByTestId("desktop-editor")).toHaveCount(0);
    await composer.fill(":");
    await expect(window.getByTestId("editor-autocomplete-menu")).toBeVisible(visible);
    await composer.press("Enter");
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

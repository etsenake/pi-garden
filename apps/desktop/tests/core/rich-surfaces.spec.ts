import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  addWorkspaceViaIpc,
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openWindowViaShortcut,
  seedAgentDir,
  selectSession,
  waitForWorkspaceByPath,
  desktopShortcut,
} from "../helpers/electron-app";
import { installRichSurfaceFixtures } from "../helpers/rich-surface-fixture";

const visible = { timeout: 20_000 };

test("rich surfaces mount in host-owned slots and follow scope, reload, and window ownership", async () => {
  test.setTimeout(240_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("rich-garden");
  const otherPath = await makeWorkspace("rich-other");
  await seedAgentDir(agentDir);
  const fixtures = await installRichSurfaceFixtures({ workspacePath, agentDir });
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Rich garden");
    const header = window.getByTestId("rich-surface-app-header");
    const footer = window.getByTestId("rich-surface-app-footer");
    const sidebar = window.getByTestId("rich-surface-sidebar");
    const thread = window.getByTestId("rich-surface-thread-header");
    const before = window.getByTestId("rich-surface-composer-before");
    const after = window.getByTestId("rich-surface-composer-after");
    await expect(header).toBeVisible(visible);
    await expect(footer).toBeVisible(visible);
    await expect(sidebar).toBeVisible(visible);
    await expect(thread).toBeVisible(visible);
    await expect(before).toBeVisible(visible);
    await expect(after).toBeVisible(visible);

    const headerFrame = header.frameLocator('[data-testid="rich-surface-frame"]');
    await expect(headerFrame.locator(".rich-mark")).toHaveText(/app-header|other-header/, visible);
    await expect(header.getByTestId("rich-surface-conflict")).toContainText("Also registered");
    await expect(header.locator('[data-testid="rich-surface-frame"]')).toHaveCount(1);
    await expect(header.locator('[data-testid="rich-surface-frame"]')).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
    await expect(headerFrame.locator("#boundary")).toHaveText(
      JSON.stringify({
        preload: "undefined",
        process: "undefined",
        require: "undefined",
        parentAccess: "blocked",
        origin: "null",
      }),
      visible,
    );
    await expect(
      footer.frameLocator('[data-testid="rich-surface-frame"]').locator(".rich-mark"),
    ).toHaveText("app-footer", visible);
    await expect
      .poll(async () =>
        sidebar
          .locator(".rich-surface-slot")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-surface-id"))),
      )
      .toEqual(["alpha", "zeta", "middle"]);
    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible();
    await expect
      .poll(() =>
        before.evaluate((node) => {
          const editor = document.querySelector(".conversation--composer");
          return Boolean(
            editor && !editor.contains(node) && editor.parentElement === node.parentElement,
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        after.evaluate((node) => {
          const editor = document.querySelector(".conversation--composer");
          return Boolean(
            editor && !editor.contains(node) && editor.parentElement === node.parentElement,
          );
        }),
      )
      .toBe(true);
    await composer.fill("Garden still owns this composer");
    await expect(composer).toHaveValue("Garden still owns this composer");
    await composer.fill("");

    const threadFrame = thread.frameLocator('[data-testid="rich-surface-frame"]');
    await threadFrame.getByRole("button", { name: "Open picker", exact: true }).click(visible);
    const dialog = window.getByTestId("rich-overlay-dialog");
    await expect(dialog).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate(
          (node) => node === document.activeElement || node.contains(document.activeElement),
        ),
      )
      .toBe(true);
    const overlay = dialog.frameLocator('[data-testid="rich-surface-frame"]');
    await overlay.getByRole("button", { name: "Return north", exact: true }).click();
    await expect(window.getByTestId("rich-overlay")).toHaveCount(0);
    await expect(threadFrame.locator("#overlay-result")).toHaveText(
      JSON.stringify({ status: "result", value: { picked: "north" } }),
    );
    await threadFrame.getByRole("button", { name: "Open picker", exact: true }).click();
    await overlay.getByRole("button", { name: "Cancel pick", exact: true }).click();
    await expect(threadFrame.locator("#overlay-result")).toHaveText(
      JSON.stringify({ status: "cancelled" }),
    );
    await threadFrame.getByRole("button", { name: "Open picker", exact: true }).click();
    await dialog.focus();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("rich-overlay")).toHaveCount(0);

    await window.keyboard.press(desktopShortcut(","));
    const settings = window.getByTestId("settings-surface");
    await settings.getByRole("button", { name: "Project garden", exact: true }).click();
    await expect(
      settings.getByTestId("rich-surface-settings").frameLocator("iframe").locator(".rich-mark"),
    ).toHaveText("project-garden", visible);
    await settings.getByRole("button", { name: "User garden", exact: true }).click();
    await expect(
      settings.getByTestId("rich-surface-settings").frameLocator("iframe").locator(".rich-mark"),
    ).toHaveText("user-garden", visible);
    await settings.getByRole("button", { name: "Back to app", exact: true }).click();

    await window.evaluate(async () => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.setThemePresetId("tokyo-night");
    });
    await expect(headerFrame.locator("#theme")).toHaveText("tokyo-night");
    await expect(footer.frameLocator("iframe").locator("#theme")).toHaveText("tokyo-night");

    await openWorkbench(window, "Legacy workbench");
    const workbenchFrame = window.frameLocator('[data-testid="extension-view-frame"]');
    await expect(workbenchFrame.locator(".rich-mark")).toHaveText("legacy-workbench", visible);
    await openWorkbench(window, "Rich workbench");
    await expect(window.getByRole("tab", { name: "Legacy workbench", exact: true })).toBeVisible();
    await expect(window.getByRole("tab", { name: "Rich workbench", exact: true })).toBeVisible();
    await expect(workbenchFrame.locator(".rich-mark")).toHaveText("rich-workbench", visible);
    await window.getByRole("tab", { name: "Legacy workbench", exact: true }).click();
    await expect(workbenchFrame.locator(".rich-mark")).toHaveText("legacy-workbench");

    const headerElement = header.locator('[data-testid="rich-surface-frame"]');
    const firstUrl = await headerElement.getAttribute("src");
    expect(firstUrl).toBeTruthy();
    await composer.fill("/reload ");
    await composer.press("Enter");
    await expect(headerFrame.locator(".rich-mark")).toHaveText(/app-header|other-header/, visible);
    await expect(headerElement).toHaveCount(1);
    await expect.poll(() => headerElement.getAttribute("src")).not.toBe(firstUrl);
    const owner = await header.getAttribute("data-rich-owner");
    expect(owner === "garden-header" || owner === "other-header").toBe(true);
    const stale = await window.evaluate(async (connectionId) => {
      try {
        await globalThis.window.piApp.sendExtensionViewMessage({
          connectionId,
          message: { type: "closed", reason: "old runtime" },
        });
        return "allowed";
      } catch {
        return "rejected";
      }
    }, new URL(firstUrl!).hostname);
    expect(stale).toBe("rejected");

    const second = await openWindowViaShortcut(harness, window);
    await selectSession(second, "Rich garden");
    const secondHeader = second.getByTestId("rich-surface-app-header");
    await expect(secondHeader).toBeVisible(visible);
    const secondUrl = await secondHeader
      .locator('[data-testid="rich-surface-frame"]')
      .getAttribute("src");
    expect(secondUrl).toBeTruthy();
    expect(new URL(secondUrl!).hostname).not.toBe(
      new URL((await headerElement.getAttribute("src"))!).hostname,
    );
    const wrongWindow = await second.evaluate(
      async (connectionId) => {
        try {
          await globalThis.window.piApp.sendExtensionViewMessage({
            connectionId,
            message: { type: "closed", reason: "wrong window" },
          });
          return "allowed";
        } catch {
          return "rejected";
        }
      },
      new URL((await headerElement.getAttribute("src"))!).hostname,
    );
    expect(wrongWindow).toBe("rejected");

    await createNamedThread(window, "Second garden");
    await expect.poll(() => headerElement.getAttribute("src")).not.toBe(secondUrl);
    await selectSession(window, "Rich garden");
    await expect(header).toBeVisible(visible);

    await window.evaluate(async () => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.setSidebarCollapsed(true);
    });
    await expect(sidebar).toHaveCount(0);
    await expect(header).toBeVisible();
    await window.evaluate(async () => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.setSidebarCollapsed(false);
    });
    await expect(window.getByTestId("rich-surface-sidebar")).toBeVisible();

    await addWorkspaceViaIpc(window, otherPath);
    await createNamedThread(window, "Other garden", { workspaceName: "rich-other" });
    await expect(window.getByTestId("rich-surface-app-header")).toHaveCount(0);
    await expect(window.getByTestId("rich-surface-sidebar")).toHaveCount(0);
    await window.keyboard.press(desktopShortcut(","));
    const otherSettings = window.getByTestId("settings-surface");
    await expect(
      otherSettings.getByRole("button", { name: "Project garden", exact: true }),
    ).toHaveCount(0);
    await otherSettings.getByRole("button", { name: "User garden", exact: true }).click();
    await expect(
      otherSettings
        .getByTestId("rich-surface-settings")
        .frameLocator("iframe")
        .locator(".rich-mark"),
    ).toHaveText("user-garden", visible);
    await otherSettings.getByRole("button", { name: "Back to app", exact: true }).click();

    await selectSession(window, "Rich garden");
    await expect(window.getByTestId("rich-surface-sidebar")).toBeVisible(visible);
    await disableExtension(window, workspacePath, fixtures.projectExtensionPath);
    await disableExtension(window, workspacePath, fixtures.conflictExtensionPath);
    await expect(window.getByTestId("rich-surface-app-header")).toHaveCount(0);
    await expect(window.getByTestId("rich-surface-sidebar")).toHaveCount(0);
    await expect(window.getByTestId("rich-surface-composer-before")).toHaveCount(0);
    await expect(composer).toBeVisible();
    await window.keyboard.press(desktopShortcut(","));
    const disabledSettings = window.getByTestId("settings-surface");
    await expect(
      disabledSettings.getByRole("button", { name: "Project garden", exact: true }),
    ).toHaveCount(0);
    await expect(
      disabledSettings.getByRole("button", { name: "User garden", exact: true }),
    ).toBeVisible();
    const state = await getDesktopState(window);
    expect(state.selectedSessionId).toBeTruthy();
  } finally {
    await harness.close();
  }
});

async function openWorkbench(window: Page, name: string): Promise<void> {
  if (!(await window.getByTestId("workbench").isVisible())) {
    await window.getByTestId("toggle-side-panel").click();
  }
  await window.getByTestId("workbench-add-tab").click();
  await window.getByTestId("workbench-chooser").getByRole("button", { name, exact: true }).click();
}

async function disableExtension(
  window: Page,
  workspacePath: string,
  extensionPath: string,
): Promise<void> {
  await window.evaluate(
    async ({ targetWorkspacePath, targetExtensionPath }) => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      const state = await app.getState();
      const workspace = state.workspaces.find((entry) => entry.path === targetWorkspacePath);
      if (!workspace) throw new Error(`Workspace not found: ${targetWorkspacePath}`);
      await app.setExtensionEnabled(workspace.id, targetExtensionPath, false);
    },
    { targetWorkspacePath: workspacePath, targetExtensionPath: extensionPath },
  );
}

import {
  writeProjectExtension,
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";
import { expect, test } from "@playwright/test";

const initialExtensionSource = String.raw`
export default function reloadDockExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("reload-status", "Session ready");
    ctx.ui.setWidget("reload-widget", ["Initial widget line"]);
  });

  pi.registerCommand("mark-alt", {
    description: "Mark alternate dock content",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("reload-status", "Alternate status");
      ctx.ui.setWidget("reload-widget", ["Alternate widget line"]);
    },
  });
}
`;

const refreshedExtensionSource = String.raw`
export default function reloadDockExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("reload-status", "Refreshed session ready");
    ctx.ui.setWidget("reload-widget", ["Refreshed widget line"]);
  });

  pi.registerCommand("mark-alt", {
    description: "Mark alternate dock content",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("reload-status", "Alternate status");
      ctx.ui.setWidget("reload-widget", ["Alternate widget line"]);
    },
  });
}
`;

test("reloads extension widgets and status without keeping stale copies", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-dock-reload-workspace");
  await writeProjectExtension(workspacePath, "reload-dock-extension.ts", initialExtensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Reload session");

    const composer = window.getByTestId("composer");
    const status = window.locator("[data-status-key='reload-status']");
    const widget = window.locator("[data-widget-key='reload-widget']");

    await expect(status).toHaveText("Session ready");
    await expect(widget).toHaveText("Initial widget line");
    await expect(widget).toHaveCount(1);
    await expect
      .poll(async () => {
        const nextState = await getDesktopState(window);
        const sessionKey = `${nextState.selectedWorkspaceId}:${nextState.selectedSessionId}`;
        return (nextState.sessionCommandsBySession[sessionKey] ?? []).map(
          (command) => command.name,
        );
      })
      .toEqual(expect.arrayContaining(["mark-alt"]));

    await composer.fill("/mark-alt ");
    await composer.press("Enter");
    await expect(status).toHaveText("Alternate status");
    await expect(widget).toHaveText("Alternate widget line");
    await expect(widget).toHaveCount(1);

    await composer.fill("/reload ");
    await composer.press("Enter");
    await expect(status).toHaveText("Session ready");
    await expect(widget).toHaveText("Initial widget line");
    await expect(widget).toHaveCount(1);
    await expect(window.getByText("Alternate widget line")).toHaveCount(0);

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    const extensionCard = window
      .getByTestId("extensions-list")
      .getByRole("button", { name: /reload-dock-extension/i });
    await extensionCard.click();
    await window.getByRole("switch", { name: "Enabled", exact: true }).click();
    await expect(window.getByRole("switch", { name: "Enabled", exact: true })).not.toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(window.getByTestId("extension-widgets-above")).toHaveCount(0);
    await expect(window.getByTestId("extension-status-line")).toHaveCount(0);

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await extensionCard.click();
    await window.getByRole("switch", { name: "Enabled", exact: true }).click();
    await expect(window.getByRole("switch", { name: "Enabled", exact: true })).toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect(status).toHaveText("Session ready");
    await expect(widget).toHaveText("Initial widget line");
    await expect(widget).toHaveCount(1);
  } finally {
    await harness.close();
  }
});

test("replaces extension widgets and status after the extension source is refreshed", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-dock-refresh-workspace");
  await writeProjectExtension(workspacePath, "reload-dock-extension.ts", initialExtensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Refresh session");

    const status = window.locator("[data-status-key='reload-status']");
    const widget = window.locator("[data-widget-key='reload-widget']");

    await expect(status).toHaveText("Session ready");
    await expect(widget).toHaveText("Initial widget line");

    await writeProjectExtension(
      workspacePath,
      "reload-dock-extension.ts",
      refreshedExtensionSource,
    );
    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await window.getByRole("button", { name: "Refresh", exact: true }).click();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();

    await expect(status).toHaveText("Refreshed session ready");
    await expect(widget).toHaveText("Refreshed widget line");
    await expect(widget).toHaveCount(1);
    await expect(window.getByText("Initial widget line")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

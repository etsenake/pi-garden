import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  assertExists,
  createSessionViaIpc,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("supports workspace rename and remove from the sidebar menu", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspaceA = await makeWorkspace("workspace-menu-a");
  const workspaceB = await makeWorkspace("workspace-menu-b");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspaceA, workspaceB],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspaceA);
    await waitForWorkspaceByPath(window, workspaceB);

    const state = await getDesktopState(window);
    const workspace = state.workspaces.find((entry) => entry.path === workspaceA);
    assertExists(workspace, "Expected first workspace");

    await window
      .getByRole("button", { name: `Workspace actions for ${basename(workspaceA)}` })
      .click();
    const workspaceMenu = window.getByRole("menu", {
      name: `Workspace actions for ${basename(workspaceA)}`,
    });
    await expect(workspaceMenu.getByRole("menuitem", { name: "Open folder" })).toBeVisible();
    await expect(workspaceMenu.getByRole("menuitem", { name: "Edit name" })).toBeVisible();
    await expect(
      workspaceMenu.getByRole("menuitem", { name: "Remove", exact: true }),
    ).toBeVisible();

    await workspaceMenu.getByRole("menuitem", { name: "Edit name" }).click();
    const renameInput = window.getByLabel(`Rename ${basename(workspaceA)}`);
    await renameInput.fill("Renamed workspace");
    await window.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => {
        const latest = await getDesktopState(window);
        return latest.workspaces.find((entry) => entry.id === workspace.id)?.name;
      })
      .toBe("Renamed workspace");

    const acceptRemoval = window.waitForEvent("dialog").then((dialog) => dialog.accept());
    await window.getByRole("button", { name: "Workspace actions for Renamed workspace" }).click();
    await Promise.all([
      window.getByRole("menuitem", { name: "Remove", exact: true }).click(),
      acceptRemoval,
    ]);

    await expect
      .poll(async () => {
        const latest = await getDesktopState(window);
        return latest.workspaces.some((entry) => entry.id === workspace.id);
      })
      .toBe(false);
  } finally {
    await harness.close();
  }
});

test("removes a folder with threads from Settings while time grouping hides its row", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspaceA = await makeWorkspace("settings-folders-a");
  const workspaceB = await makeWorkspace("settings-folders-b");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspaceA, workspaceB],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspaceA);
    await waitForWorkspaceByPath(window, workspaceB);
    await createSessionViaIpc(window, workspaceA, "Thread hides the folder row");

    // Time grouping is the default: a folder with threads has no sidebar row or menu.
    await expect(
      window.getByRole("button", { name: `Workspace actions for ${basename(workspaceA)}` }),
    ).toHaveCount(0);

    await window.locator(".sidebar__nav-item", { hasText: "Settings" }).click();
    const removeButton = window.getByRole("button", { name: `Remove ${basename(workspaceA)}` });
    await expect(removeButton).toBeVisible();
    await expect(window.getByText(workspaceA, { exact: true })).toBeVisible();

    const acceptRemoval = window.waitForEvent("dialog").then((dialog) => dialog.accept());
    await Promise.all([removeButton.click(), acceptRemoval]);

    await expect
      .poll(async () => {
        const latest = await getDesktopState(window);
        return latest.workspaces.some((entry) => entry.id === workspace.id);
      })
      .toBe(false);
    await expect(removeButton).toHaveCount(0);
    await expect(
      window.getByRole("button", { name: `Remove ${basename(workspaceB)}` }),
    ).toBeVisible();
    expect((await stat(workspaceA)).isDirectory()).toBe(true);
  } finally {
    await harness.close();
  }
});

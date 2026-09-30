import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  addWorkspaceViaIpc,
  clickSession,
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";

const require = createRequire(__filename);
const helperPath = require.resolve("@pi-garden/extension-ui");

function badgeSource(id: string, text: string): string {
  return `
import { registerHeaderBadge } from ${JSON.stringify(helperPath)};
export default function badgeExtension(pi) {
  registerHeaderBadge(pi, { id: ${JSON.stringify(id)}, text: ${JSON.stringify(text)} });
}
`;
}

async function expectBadges(
  window: Page,
  badges: readonly { readonly id: string; readonly text: string }[],
): Promise<void> {
  const root = window.getByTestId("header-badges");
  if (badges.length === 0) {
    await expect(root).toHaveCount(0);
    return;
  }
  const items = root.locator("[data-badge-id]");
  await expect(items).toHaveCount(badges.length);
  for (const [index, badge] of badges.entries()) {
    await expect(items.nth(index)).toHaveAttribute("data-badge-id", badge.id);
    await expect(items.nth(index)).toHaveText(badge.text);
    await expect(root.locator(`[data-badge-id="${badge.id}"]`)).toHaveCount(1);
  }
}

test("renders extension header badges from Pi's loaded extension scope", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspaceA = await makeWorkspace("header-badge-a");
  const workspaceB = await makeWorkspace("header-badge-b");
  await seedAgentDir(agentDir);
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(
    join(agentDir, "extensions", "garden-badge.ts"),
    badgeSource("garden", "Garden"),
    "utf8",
  );
  await writeProjectExtension(workspaceA, "zeta-badge.ts", badgeSource("zeta", "Zeta"));
  await writeProjectExtension(workspaceA, "local-badge.ts", badgeSource("local", "Local"));

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspaceA],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Session A");
    const initial = [
      { id: "garden", text: "Garden" },
      { id: "local", text: "Local" },
      { id: "zeta", text: "Zeta" },
    ];
    await expectBadges(window, initial);

    const title = await window.locator(".chat-header__title").boundingBox();
    const garden = await window.locator("[data-badge-id='garden']").boundingBox();
    expect(title).not.toBeNull();
    expect(garden).not.toBeNull();
    expect(garden!.x).toBeGreaterThanOrEqual(title!.x + title!.width - 1);
    expect(Math.abs(garden!.y - title!.y)).toBeLessThan(title!.height);

    await createNamedThread(window, "Session B");
    await expectBadges(window, initial);
    await clickSession(window, "Session A");
    await expectBadges(window, initial);

    await writeProjectExtension(workspaceA, "local-badge.ts", badgeSource("local", "Moved"));
    const composer = window.getByTestId("composer");
    await composer.fill("/reload ");
    await composer.press("Enter");
    const reloaded = [
      { id: "garden", text: "Garden" },
      { id: "local", text: "Moved" },
      { id: "zeta", text: "Zeta" },
    ];
    await expectBadges(window, reloaded);

    await clickSession(window, "Session B");
    await expectBadges(window, initial);
    await clickSession(window, "Session A");
    await expectBadges(window, reloaded);

    await addWorkspaceViaIpc(window, workspaceB);
    const otherWorkspace = await waitForWorkspaceByPath(window, workspaceB);
    await createNamedThread(window, "Other workspace", { workspaceName: otherWorkspace.name });
    await expectBadges(window, [{ id: "garden", text: "Garden" }]);
    await clickSession(window, "Session A");
    await expectBadges(window, reloaded);

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    const extensionCard = window
      .getByTestId("extensions-list")
      .getByRole("button", { name: /local-badge/i });
    await extensionCard.click();
    await window.getByRole("switch", { name: "Enabled", exact: true }).click();
    await expect(window.getByRole("switch", { name: "Enabled", exact: true })).not.toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expectBadges(window, [
      { id: "garden", text: "Garden" },
      { id: "zeta", text: "Zeta" },
    ]);

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await extensionCard.click();
    await window.getByRole("switch", { name: "Enabled", exact: true }).click();
    await expect(window.getByRole("switch", { name: "Enabled", exact: true })).toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expectBadges(window, reloaded);
  } finally {
    await harness.close();
  }
});

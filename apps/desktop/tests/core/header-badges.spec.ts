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

function badgeCall(id: string, text: string, tone?: string): string {
  const toneField = tone === undefined ? "" : `, tone: ${JSON.stringify(tone)}`;
  return `  registerHeaderBadge(pi, { id: ${JSON.stringify(id)}, text: ${JSON.stringify(text)}${toneField} });`;
}

function badgeSource(id: string, text: string, tone?: string): string {
  return `
import { registerHeaderBadge } from ${JSON.stringify(helperPath)};
export default function badgeExtension(pi) {
${badgeCall(id, text, tone)}
}
`;
}

function toneSource(garden: { readonly text: string; readonly tone?: string }): string {
  const gardenCalls =
    garden.tone === undefined
      ? badgeCall("garden", garden.text)
      : `${badgeCall("garden", "Stale", "warning")}\n${badgeCall("garden", garden.text, garden.tone)}`;
  return `
import { registerHeaderBadge } from ${JSON.stringify(helperPath)};
export default function badgeExtension(pi) {
${gardenCalls}
${badgeCall("accent", "Accent", "accent")}
${badgeCall("ready", "Ready", "success")}
${badgeCall("attention", "Attention", "warning")}
${badgeCall("failed", "Failed", "error")}
${badgeCall("quiet", "Quiet", "muted")}
}
`;
}

async function expectBadges(
  window: Page,
  badges: readonly { readonly id: string; readonly text: string; readonly tone: string }[],
): Promise<void> {
  const root = window.getByTestId("header-badges");
  if (badges.length === 0) {
    await expect(root).toHaveCount(0);
    return;
  }
  const items = root.locator("[data-badge-id]");
  await expect(items).toHaveCount(badges.length);
  for (const [index, badge] of badges.entries()) {
    const item = items.nth(index);
    await expect(item).toHaveAttribute("data-badge-id", badge.id);
    await expect(item).toHaveAttribute("data-tone", badge.tone);
    await expect(item).toHaveText(badge.text);
    await expect(root.locator(`[data-badge-id="${badge.id}"]`)).toHaveCount(1);
  }
}

async function badgeColor(window: Page, id: string): Promise<string> {
  return window
    .locator(`[data-badge-id="${id}"]`)
    .evaluate((element) => getComputedStyle(element).color);
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
    toneSource({ text: "Garden" }),
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
    const userBadges = [
      { id: "accent", text: "Accent", tone: "accent" },
      { id: "attention", text: "Attention", tone: "warning" },
      { id: "failed", text: "Failed", tone: "error" },
      { id: "garden", text: "Garden", tone: "default" },
      { id: "quiet", text: "Quiet", tone: "muted" },
      { id: "ready", text: "Ready", tone: "success" },
    ];
    const initial = [
      ...userBadges.slice(0, 4),
      { id: "local", text: "Local", tone: "default" },
      userBadges[4]!,
      userBadges[5]!,
      { id: "zeta", text: "Zeta", tone: "default" },
    ];
    await expectBadges(window, initial);

    const toneColors = await Promise.all(
      ["garden", "accent", "ready", "attention", "failed", "quiet"].map((id) =>
        badgeColor(window, id),
      ),
    );
    expect(new Set(toneColors).size).toBe(toneColors.length);
    await window.evaluate(async () => {
      await globalThis.window.piApp?.setThemeMode("light");
    });
    await expect
      .poll(() => window.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(false);
    const lightSuccess = await badgeColor(window, "ready");
    await window.evaluate(async () => {
      await globalThis.window.piApp?.setThemeMode("dark");
    });
    await expect.poll(() => badgeColor(window, "ready")).not.toBe(lightSuccess);
    await expect(window.locator("[data-badge-id='ready']")).toHaveAttribute("data-tone", "success");
    await expect(window.locator("[data-badge-id='ready']")).toHaveCount(1);
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
    const reloaded = initial.map((badge) =>
      badge.id === "local" ? { id: "local", text: "Moved", tone: "default" } : badge,
    );
    await expectBadges(window, reloaded);

    await clickSession(window, "Session B");
    await expectBadges(window, initial);
    await clickSession(window, "Session A");
    await expectBadges(window, reloaded);

    await addWorkspaceViaIpc(window, workspaceB);
    const otherWorkspace = await waitForWorkspaceByPath(window, workspaceB);
    await createNamedThread(window, "Other workspace", { workspaceName: otherWorkspace.name });
    await expectBadges(window, userBadges);
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
    await expectBadges(
      window,
      initial.filter((badge) => badge.id !== "local"),
    );

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await extensionCard.click();
    await window.getByRole("switch", { name: "Enabled", exact: true }).click();
    await expect(window.getByRole("switch", { name: "Enabled", exact: true })).toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expectBadges(window, reloaded);

    await writeFile(
      join(agentDir, "extensions", "garden-badge.ts"),
      toneSource({ text: "Grown", tone: "accent" }),
      "utf8",
    );
    await composer.fill("/reload ");
    await composer.press("Enter");
    const updated = reloaded.map((badge) =>
      badge.id === "garden" ? { id: "garden", text: "Grown", tone: "accent" } : badge,
    );
    await expectBadges(window, updated);
    await clickSession(window, "Session B");
    await expectBadges(window, reloaded);
    await clickSession(window, "Session A");
    await expectBadges(window, updated);
  } finally {
    await harness.close();
  }
});

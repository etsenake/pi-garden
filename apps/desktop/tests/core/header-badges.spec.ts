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

interface ShownContribution {
  readonly id: string;
  readonly text: string;
  readonly tone: string;
  readonly order: number;
}

type ContributionKind = "header" | "section" | "footer" | "before" | "after" | "status";

function contributionCall(
  kind: ContributionKind,
  id: string,
  text: string,
  options?: { readonly tone?: string; readonly order?: number },
): string {
  const fn = {
    header: "registerHeaderBadge",
    section: "registerSidebarSection",
    footer: "registerSidebarFooter",
    before: "registerComposerBefore",
    after: "registerComposerAfter",
    status: "registerStatusChrome",
  }[kind];
  const fields = [`id: ${JSON.stringify(id)}`, `text: ${JSON.stringify(text)}`];
  if (options?.tone !== undefined) fields.push(`tone: ${JSON.stringify(options.tone)}`);
  if (options?.order !== undefined) fields.push(`order: ${options.order}`);
  return `  ${fn}(pi, { ${fields.join(", ")} });`;
}

function extensionSource(calls: readonly string[]): string {
  return `
import { registerComposerAfter, registerComposerBefore, registerHeaderBadge, registerSidebarFooter, registerSidebarSection, registerStatusChrome } from ${JSON.stringify(helperPath)};
export default function contributionExtension(pi) {
${calls.join("\n")}
}
`;
}

function userExtensionSource(options: {
  readonly garden: { readonly text: string; readonly tone?: string };
  readonly statusText: string;
}): string {
  const garden = options.garden;
  const headerGarden =
    garden.tone === undefined
      ? contributionCall("header", "garden", garden.text)
      : [
          contributionCall("header", "garden", "Stale", { tone: "warning", order: 9 }),
          contributionCall("header", "garden", garden.text, { tone: garden.tone }),
        ].join("\n");
  const footerGarden =
    garden.tone === undefined
      ? contributionCall("footer", "garden", "Root", { tone: "accent", order: 2 })
      : [
          contributionCall("footer", "garden", "Stale", { tone: "error", order: 9 }),
          contributionCall("footer", "garden", "Rooted", { tone: "accent", order: 2 }),
        ].join("\n");
  const sectionGarden =
    garden.tone === undefined
      ? contributionCall("section", "garden", "Lane")
      : [
          contributionCall("section", "garden", "Stale", { tone: "warning", order: 9 }),
          contributionCall("section", "garden", "Routed", { tone: "accent", order: 1 }),
        ].join("\n");
  return extensionSource([
    contributionCall("header", "quiet", "Quiet", { tone: "muted", order: -1 }),
    headerGarden,
    contributionCall("header", "attention", "Attention", { tone: "warning", order: 1 }),
    contributionCall("header", "ready", "Ready", { tone: "success", order: 1 }),
    contributionCall("header", "accent", "Accent", { tone: "accent", order: 2 }),
    contributionCall("header", "failed", "Failed", { tone: "error", order: 3 }),
    contributionCall("footer", "build", "Build", { tone: "success" }),
    contributionCall("footer", "note", "Note", { tone: "muted" }),
    contributionCall("footer", "alert", "Alert", { tone: "warning", order: 1 }),
    footerGarden,
    contributionCall("section", "quiet", "Quiet", { tone: "muted", order: -1 }),
    sectionGarden,
    contributionCall("section", "ready", "Ready", { tone: "success", order: 1 }),
    contributionCall("section", "note", "Note", { tone: "muted", order: 2 }),
    contributionCall("footer", "failed", "Down", { tone: "error", order: 3 }),
    contributionCall("before", "cue", "Cue", { tone: "accent" }),
    contributionCall("before", "lead", "Lead", { tone: "muted", order: 1 }),
    contributionCall("after", "trail", "Trail", { tone: "success" }),
    contributionCall("after", "echo", "Echo", { order: 1 }),
    contributionCall("status", "live", options.statusText, { tone: "warning" }),
    contributionCall("status", "calm", "Calm", { tone: "muted", order: 2 }),
  ]);
}

interface SurfaceSet {
  readonly header: readonly ShownContribution[];
  readonly section: readonly ShownContribution[];
  readonly footer: readonly ShownContribution[];
  readonly before: readonly ShownContribution[];
  readonly after: readonly ShownContribution[];
  readonly status: readonly ShownContribution[];
}

async function expectContributions(
  window: Page,
  testId: string,
  attribute: "data-badge-id" | "data-contribution-id",
  contributions: readonly ShownContribution[],
): Promise<void> {
  const root = window.getByTestId(testId);
  if (contributions.length === 0) {
    await expect(root).toHaveCount(0);
    return;
  }
  const items = root.locator(`[${attribute}]`);
  await expect(items).toHaveCount(contributions.length);
  for (const [index, contribution] of contributions.entries()) {
    const item = items.nth(index);
    await expect(item).toHaveAttribute(attribute, contribution.id);
    await expect(item).toHaveAttribute("data-tone", contribution.tone);
    await expect(item).toHaveAttribute("data-order", String(contribution.order));
    await expect(item).toHaveText(contribution.text);
    await expect(root.locator(`[${attribute}="${contribution.id}"]`)).toHaveCount(1);
  }
}

async function expectSurfaces(window: Page, surfaces: SurfaceSet): Promise<void> {
  await expectContributions(window, "header-badges", "data-badge-id", surfaces.header);
  await expectContributions(window, "sidebar-section", "data-contribution-id", surfaces.section);
  await expectContributions(window, "sidebar-footer", "data-contribution-id", surfaces.footer);
  await expectContributions(window, "composer-before", "data-contribution-id", surfaces.before);
  await expectContributions(window, "composer-after", "data-contribution-id", surfaces.after);
  await expectContributions(window, "status-chrome", "data-contribution-id", surfaces.status);
}

function withoutId(surfaces: SurfaceSet, id: string): SurfaceSet {
  const drop = (contributions: readonly ShownContribution[]) =>
    contributions.filter((contribution) => contribution.id !== id);
  return {
    header: drop(surfaces.header),
    section: drop(surfaces.section),
    footer: drop(surfaces.footer),
    before: drop(surfaces.before),
    after: drop(surfaces.after),
    status: drop(surfaces.status),
  };
}

async function contributionColor(
  window: Page,
  testId: string,
  attribute: string,
  id: string,
): Promise<string> {
  return window
    .getByTestId(testId)
    .locator(`[${attribute}="${id}"]`)
    .evaluate((element) => getComputedStyle(element).color);
}

test("renders header badges and sidebar footer contributions from Pi's loaded extension scope", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspaceA = await makeWorkspace("header-badge-a");
  const workspaceB = await makeWorkspace("header-badge-b");
  await seedAgentDir(agentDir);
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(
    join(agentDir, "extensions", "garden-badge.ts"),
    userExtensionSource({ garden: { text: "Garden" }, statusText: "Live" }),
    "utf8",
  );
  await writeProjectExtension(
    workspaceA,
    "zeta-badge.ts",
    extensionSource([
      contributionCall("header", "zeta", "Zeta"),
      contributionCall("section", "zeta", "Zeta lane"),
      contributionCall("footer", "zeta", "Zeta side"),
      contributionCall("before", "zeta", "Zeta before"),
    ]),
  );
  await writeProjectExtension(
    workspaceA,
    "local-badge.ts",
    extensionSource([
      contributionCall("header", "local", "Local", { order: 4 }),
      contributionCall("section", "local", "Local lane", { order: 4 }),
      contributionCall("footer", "local", "Local side", { order: 4 }),
      contributionCall("after", "local", "Local after", { order: 4 }),
      contributionCall("status", "local", "Local live", { order: 4 }),
    ]),
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspaceA],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Session A");
    const userHeader: ShownContribution[] = [
      { id: "quiet", text: "Quiet", tone: "muted", order: -1 },
      { id: "garden", text: "Garden", tone: "default", order: 0 },
      { id: "attention", text: "Attention", tone: "warning", order: 1 },
      { id: "ready", text: "Ready", tone: "success", order: 1 },
      { id: "accent", text: "Accent", tone: "accent", order: 2 },
      { id: "failed", text: "Failed", tone: "error", order: 3 },
    ];
    const userSection: ShownContribution[] = [
      { id: "quiet", text: "Quiet", tone: "muted", order: -1 },
      { id: "garden", text: "Lane", tone: "default", order: 0 },
      { id: "ready", text: "Ready", tone: "success", order: 1 },
      { id: "note", text: "Note", tone: "muted", order: 2 },
    ];
    const userFooter: ShownContribution[] = [
      { id: "build", text: "Build", tone: "success", order: 0 },
      { id: "note", text: "Note", tone: "muted", order: 0 },
      { id: "alert", text: "Alert", tone: "warning", order: 1 },
      { id: "garden", text: "Root", tone: "accent", order: 2 },
      { id: "failed", text: "Down", tone: "error", order: 3 },
    ];
    const initialHeader: ShownContribution[] = [
      userHeader[0]!,
      userHeader[1]!,
      { id: "zeta", text: "Zeta", tone: "default", order: 0 },
      userHeader[2]!,
      userHeader[3]!,
      userHeader[4]!,
      userHeader[5]!,
      { id: "local", text: "Local", tone: "default", order: 4 },
    ];
    const initialFooter: ShownContribution[] = [
      userFooter[0]!,
      userFooter[1]!,
      { id: "zeta", text: "Zeta side", tone: "default", order: 0 },
      userFooter[2]!,
      userFooter[3]!,
      userFooter[4]!,
      { id: "local", text: "Local side", tone: "default", order: 4 },
    ];
    const userBefore: ShownContribution[] = [
      { id: "cue", text: "Cue", tone: "accent", order: 0 },
      { id: "lead", text: "Lead", tone: "muted", order: 1 },
    ];
    const userAfter: ShownContribution[] = [
      { id: "trail", text: "Trail", tone: "success", order: 0 },
      { id: "echo", text: "Echo", tone: "default", order: 1 },
    ];
    const userStatus: ShownContribution[] = [
      { id: "live", text: "Live", tone: "warning", order: 0 },
      { id: "calm", text: "Calm", tone: "muted", order: 2 },
    ];
    const initial: SurfaceSet = {
      header: initialHeader,
      section: [
        userSection[0]!,
        userSection[1]!,
        { id: "zeta", text: "Zeta lane", tone: "default", order: 0 },
        userSection[2]!,
        userSection[3]!,
        { id: "local", text: "Local lane", tone: "default", order: 4 },
      ],
      footer: initialFooter,
      before: [
        userBefore[0]!,
        { id: "zeta", text: "Zeta before", tone: "default", order: 0 },
        userBefore[1]!,
      ],
      after: [...userAfter, { id: "local", text: "Local after", tone: "default", order: 4 }],
      status: [...userStatus, { id: "local", text: "Local live", tone: "default", order: 4 }],
    };
    const userOnly: SurfaceSet = {
      header: userHeader,
      section: userSection,
      footer: userFooter,
      before: userBefore,
      after: userAfter,
      status: userStatus,
    };
    await expectSurfaces(window, initial);

    const headerColors = await Promise.all(
      ["quiet", "garden", "attention", "ready", "accent", "failed"].map((id) =>
        contributionColor(window, "header-badges", "data-badge-id", id),
      ),
    );
    const footerColors = await Promise.all(
      ["build", "note", "alert", "garden", "failed"].map((id) =>
        contributionColor(window, "sidebar-footer", "data-contribution-id", id),
      ),
    );
    expect(new Set(headerColors).size).toBe(headerColors.length);
    expect(new Set(footerColors).size).toBe(footerColors.length);
    await window.evaluate(async () => {
      await globalThis.window.piApp?.setThemeMode("light");
    });
    await expect
      .poll(() => window.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(false);
    const lightHeader = await contributionColor(window, "header-badges", "data-badge-id", "ready");
    const lightFooter = await contributionColor(
      window,
      "sidebar-footer",
      "data-contribution-id",
      "build",
    );
    const lightBefore = await contributionColor(
      window,
      "composer-before",
      "data-contribution-id",
      "cue",
    );
    const lightSection = await contributionColor(
      window,
      "sidebar-section",
      "data-contribution-id",
      "ready",
    );
    await window.evaluate(async () => {
      await globalThis.window.piApp?.setThemeMode("dark");
    });
    await expect
      .poll(() => contributionColor(window, "header-badges", "data-badge-id", "ready"))
      .not.toBe(lightHeader);
    await expect
      .poll(() => contributionColor(window, "sidebar-footer", "data-contribution-id", "build"))
      .not.toBe(lightFooter);
    await expect
      .poll(() => contributionColor(window, "composer-before", "data-contribution-id", "cue"))
      .not.toBe(lightBefore);
    await expect
      .poll(() => contributionColor(window, "sidebar-section", "data-contribution-id", "ready"))
      .not.toBe(lightSection);
    await expect(
      window.getByTestId("header-badges").locator("[data-badge-id='ready']"),
    ).toHaveCount(1);
    await expect(
      window.getByTestId("sidebar-footer").locator("[data-contribution-id='build']"),
    ).toHaveCount(1);
    await expectSurfaces(window, initial);

    const title = await window.locator(".chat-header__title").boundingBox();
    const garden = await window.locator("[data-badge-id='garden']").boundingBox();
    const sidebar = await window.locator("#primary-sidebar").boundingBox();
    const section = await window.getByTestId("sidebar-section").boundingBox();
    // Footer contributions render inside the stock SidebarFooter slot.
    const footer = await window
      .locator('[data-slot="sidebar-footer"]', { has: window.getByTestId("sidebar-footer") })
      .boundingBox();
    const threadList = await window.getByTestId("workspace-list").boundingBox();
    const composerSurface = await window.getByTestId("composer-surface").boundingBox();
    const before = await window.getByTestId("composer-before").boundingBox();
    const after = await window.getByTestId("composer-after").boundingBox();
    const topbar = await window.getByTestId("topbar").boundingBox();
    const status = await window.getByTestId("status-chrome").boundingBox();
    expect(title).not.toBeNull();
    expect(garden).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(section).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(threadList).not.toBeNull();
    expect(composerSurface).not.toBeNull();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(topbar).not.toBeNull();
    expect(status).not.toBeNull();
    expect(garden!.x).toBeGreaterThanOrEqual(title!.x + title!.width - 1);
    expect(Math.abs(garden!.y - title!.y)).toBeLessThan(title!.height);
    expect(section!.y).toBeGreaterThan(threadList!.y);
    expect(footer!.y).toBeGreaterThanOrEqual(section!.y + section!.height - 1);
    expect(Math.abs(footer!.y + footer!.height - (sidebar!.y + sidebar!.height))).toBeLessThan(2);
    await window.getByTestId("sidebar-toggle").click();
    await expect(window.locator("#primary-sidebar")).toHaveCount(0);
    await expect(window.getByTestId("sidebar-section")).toHaveCount(0);
    await window.getByTestId("sidebar-toggle").click();
    await expectSurfaces(window, initial);
    expect(before!.y + before!.height).toBeLessThanOrEqual(composerSurface!.y + 1);
    expect(after!.y).toBeGreaterThanOrEqual(composerSurface!.y + composerSurface!.height - 1);
    expect(status!.y).toBeGreaterThanOrEqual(topbar!.y - 1);
    expect(status!.y + status!.height).toBeLessThanOrEqual(topbar!.y + topbar!.height + 1);

    await createNamedThread(window, "Session B");
    await expectSurfaces(window, initial);
    await clickSession(window, "Session A");
    await expectSurfaces(window, initial);

    await writeProjectExtension(
      workspaceA,
      "local-badge.ts",
      extensionSource([
        contributionCall("header", "local", "Moved", { order: 4 }),
        contributionCall("section", "local", "Moved lane", { order: 4 }),
        contributionCall("footer", "local", "Moved side", { order: 4 }),
        contributionCall("after", "local", "Moved after", { order: 4 }),
        contributionCall("status", "local", "Moved live", { order: 4 }),
      ]),
    );
    const composer = window.getByTestId("composer");
    await composer.fill("/reload ");
    await composer.press("Enter");
    const reloaded: SurfaceSet = {
      header: initial.header.map((contribution) =>
        contribution.id === "local"
          ? { id: "local", text: "Moved", tone: "default", order: 4 }
          : contribution,
      ),
      section: initial.section.map((contribution) =>
        contribution.id === "local"
          ? { id: "local", text: "Moved lane", tone: "default", order: 4 }
          : contribution,
      ),
      footer: initial.footer.map((contribution) =>
        contribution.id === "local"
          ? { id: "local", text: "Moved side", tone: "default", order: 4 }
          : contribution,
      ),
      before: initial.before,
      after: initial.after.map((contribution) =>
        contribution.id === "local"
          ? { id: "local", text: "Moved after", tone: "default", order: 4 }
          : contribution,
      ),
      status: initial.status.map((contribution) =>
        contribution.id === "local"
          ? { id: "local", text: "Moved live", tone: "default", order: 4 }
          : contribution,
      ),
    };
    await expectSurfaces(window, reloaded);

    await clickSession(window, "Session B");
    await expectSurfaces(window, initial);
    await clickSession(window, "Session A");
    await expectSurfaces(window, reloaded);

    await addWorkspaceViaIpc(window, workspaceB);
    const otherWorkspace = await waitForWorkspaceByPath(window, workspaceB);
    await createNamedThread(window, "Other workspace", { workspaceName: otherWorkspace.name });
    await expectSurfaces(window, userOnly);
    await clickSession(window, "Session A");
    await expectSurfaces(window, reloaded);

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    const extensionCard = window
      .getByTestId("extensions-list")
      .getByRole("button", { name: /local-badge/i });
    await extensionCard.click();
    await window.getByRole("switch", { name: "Enabled", exact: true }).click();
    await expect(window.getByRole("switch", { name: "Enabled", exact: true })).not.toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expectSurfaces(window, withoutId(initial, "local"));

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await extensionCard.click();
    await window.getByRole("switch", { name: "Enabled", exact: true }).click();
    await expect(window.getByRole("switch", { name: "Enabled", exact: true })).toBeChecked();
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await expectSurfaces(window, reloaded);

    await writeFile(
      join(agentDir, "extensions", "garden-badge.ts"),
      userExtensionSource({
        garden: { text: "Grown", tone: "accent" },
        statusText: "Awake",
      }),
      "utf8",
    );
    await composer.fill("/reload ");
    await composer.press("Enter");
    const updated: SurfaceSet = {
      ...reloaded,
      header: reloaded.header.map((contribution) =>
        contribution.id === "garden"
          ? { id: "garden", text: "Grown", tone: "accent", order: 0 }
          : contribution,
      ),
      section: reloaded.section
        .map((contribution) =>
          contribution.id === "garden"
            ? { id: "garden", text: "Routed", tone: "accent" as const, order: 1 }
            : contribution,
        )
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
      footer: reloaded.footer.map((contribution) =>
        contribution.id === "garden"
          ? { id: "garden", text: "Rooted", tone: "accent", order: 2 }
          : contribution,
      ),
      status: reloaded.status.map((contribution) =>
        contribution.id === "live"
          ? { id: "live", text: "Awake", tone: "warning", order: 0 }
          : contribution,
      ),
    };
    await expectSurfaces(window, updated);
    await clickSession(window, "Session B");
    await expectSurfaces(window, reloaded);
    await clickSession(window, "Session A");
    await expectSurfaces(window, updated);
  } finally {
    await harness.close();
  }
});

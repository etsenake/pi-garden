import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
  writeProjectExtension,
  type DesktopHarness,
} from "../helpers/electron-app";

const require = createRequire(__filename);
const helperPath = require.resolve("@pi-garden/extension-ui");
const platformModifier = process.platform === "darwin" ? "meta" : "control";

interface ShownContribution {
  readonly id: string;
  readonly text: string;
  readonly tone: string;
  readonly order: number;
}

interface SurfaceSet {
  readonly header: readonly ShownContribution[];
  readonly section: readonly ShownContribution[];
  readonly footer: readonly ShownContribution[];
  readonly before: readonly ShownContribution[];
  readonly after: readonly ShownContribution[];
  readonly status: readonly ShownContribution[];
}

function contributionCall(
  kind: "header" | "section" | "footer" | "before" | "after" | "status",
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

function userExtensionSource(headerText: string, statusText: string, sectionText: string): string {
  return extensionSource([
    contributionCall("header", "mark", headerText, { tone: "accent" }),
    contributionCall("section", "mark", sectionText, { tone: "success" }),
    contributionCall("footer", "mark", "Foot", { tone: "muted" }),
    contributionCall("before", "mark", "Before"),
    contributionCall("after", "mark", "After", { tone: "success" }),
    contributionCall("status", "mark", statusText, { tone: "warning" }),
  ]);
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

async function waitForPiApp(window: Page): Promise<void> {
  await window.waitForLoadState("domcontentloaded");
  await window.waitForFunction(() => Boolean(globalThis.window.piApp), undefined, {
    timeout: 15_000,
  });
}

async function waitForWindowCount(harness: DesktopHarness, count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return await harness.electronApp.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
          );
        } catch (error) {
          const message = String(error);
          if (
            message.includes("context was destroyed") ||
            message.includes("Target page, context or browser has been closed")
          ) {
            return -1;
          }
          throw error;
        }
      },
      { timeout: 15_000 },
    )
    .toBe(count);
  await expect.poll(() => harness.electronApp.windows().length, { timeout: 15_000 }).toBe(count);
}

async function browserWindowIndexForPage(harness: DesktopHarness, source: Page): Promise<number> {
  const marker = `pi-garden-window-${Date.now()}-${Math.random()}`;
  await source.evaluate((value) => {
    Object.assign(window, { __piGardenTestWindowMarker: value });
  }, marker);
  const index = await harness.electronApp.evaluate(async ({ BrowserWindow }, value) => {
    const windows = BrowserWindow.getAllWindows();
    for (const [candidateIndex, candidateWindow] of windows.entries()) {
      const candidateMarker: unknown = await candidateWindow.webContents
        .executeJavaScript("window.__piGardenTestWindowMarker", true)
        .catch(() => undefined);
      if (candidateMarker === value) {
        return candidateIndex;
      }
    }
    return -1;
  }, marker);
  if (index === -1) {
    throw new Error("Expected source page to belong to the Electron app.");
  }
  return index;
}

async function openWindowViaShortcut(harness: DesktopHarness, source: Page): Promise<Page> {
  const existing = new Set(harness.electronApp.windows());
  const sourceIndex = await browserWindowIndexForPage(harness, source);
  await harness.electronApp.evaluate(
    ({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[payload.sourceIndex]?.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "n",
        modifiers: [payload.modifier, "shift"],
      });
    },
    { sourceIndex, modifier: platformModifier },
  );
  await waitForWindowCount(harness, existing.size + 1);
  const opened = harness.electronApp.windows().find((candidate) => !existing.has(candidate));
  if (!opened) {
    throw new Error("Expected Shift+Cmd+N to create another Electron window.");
  }
  await waitForPiApp(opened);
  return opened;
}

async function reloadSession(window: Page): Promise<void> {
  const composer = window.getByTestId("composer");
  await composer.fill("/reload ");
  await composer.press("Enter");
}

test("extension removal and a second window keep one contribution set per session", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspace = await makeWorkspace("surface-windows");
  const userExtensionPath = join(agentDir, "extensions", "garden-badge.ts");
  await seedAgentDir(agentDir);
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(userExtensionPath, userExtensionSource("Mark", "Live", "Lane"), "utf8");
  const removablePath = await writeProjectExtension(
    workspace,
    "removable-badge.ts",
    extensionSource([
      contributionCall("section", "extra", "Extra", { order: 1 }),
      contributionCall("before", "extra", "Extra", { order: 1 }),
      contributionCall("status", "extra", "Side", { order: 1 }),
    ]),
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspace],
    testMode: "background",
  });

  try {
    const first = await harness.firstWindow();
    await createNamedThread(first, "Session A");
    await createNamedThread(first, "Session B");
    await selectSession(first, "Session A");

    const shared: SurfaceSet = {
      header: [{ id: "mark", text: "Mark", tone: "accent", order: 0 }],
      section: [{ id: "mark", text: "Lane", tone: "success", order: 0 }],
      footer: [{ id: "mark", text: "Foot", tone: "muted", order: 0 }],
      before: [{ id: "mark", text: "Before", tone: "default", order: 0 }],
      after: [{ id: "mark", text: "After", tone: "success", order: 0 }],
      status: [{ id: "mark", text: "Live", tone: "warning", order: 0 }],
    };
    const withExtra: SurfaceSet = {
      ...shared,
      section: [...shared.section, { id: "extra", text: "Extra", tone: "default", order: 1 }],
      before: [...shared.before, { id: "extra", text: "Extra", tone: "default", order: 1 }],
      status: [...shared.status, { id: "extra", text: "Side", tone: "default", order: 1 }],
    };
    const reloaded: SurfaceSet = {
      ...withExtra,
      header: [{ id: "mark", text: "Marked", tone: "accent", order: 0 }],
      section: [
        { id: "mark", text: "Routed", tone: "success", order: 0 },
        { id: "extra", text: "Extra", tone: "default", order: 1 },
      ],
      status: [
        { id: "mark", text: "Awake", tone: "warning", order: 0 },
        { id: "extra", text: "Side", tone: "default", order: 1 },
      ],
    };
    const removed: SurfaceSet = {
      ...reloaded,
      section: [{ id: "mark", text: "Routed", tone: "success", order: 0 }],
      before: shared.before,
      status: [{ id: "mark", text: "Awake", tone: "warning", order: 0 }],
    };

    await expectSurfaces(first, withExtra);
    const second = await openWindowViaShortcut(harness, first);
    await expect(second.locator(".chat-header__title")).toHaveText("Session A");
    await expectSurfaces(first, withExtra);
    await expectSurfaces(second, withExtra);

    await writeFile(userExtensionPath, userExtensionSource("Marked", "Awake", "Routed"), "utf8");
    await reloadSession(first);
    await expectSurfaces(first, reloaded);
    await expectSurfaces(second, reloaded);

    await selectSession(second, "Session B");
    await expectSurfaces(second, withExtra);
    await expectSurfaces(first, reloaded);

    await unlink(removablePath);
    await reloadSession(first);
    await expectSurfaces(first, removed);
    await expectSurfaces(second, withExtra);

    await selectSession(second, "Session A");
    await expectSurfaces(second, removed);
    await expectSurfaces(first, removed);
    await selectSession(second, "Session B");
    await expectSurfaces(second, withExtra);
    await expectSurfaces(first, removed);
  } finally {
    await harness.close();
  }
});

import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  createSessionViaIpc,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
  waitForSessionByTitle,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";
import { writeCompatibilityFixture } from "../helpers/compatibility-fixtures";
import { installRichSurfaceFixtures } from "../helpers/rich-surface-fixture";

const visible = { timeout: 20_000 };

/**
 * Highest-value lifecycle gaps from the freeze audit: repeated reload without
 * source edits, live project trust grant/revoke, and remount-free theme
 * propagation for rich surfaces and tool renderers.
 */

test("repeated /reload keeps dock widgets stable without source edits", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-repeated-reload");
  await writeProjectExtension(
    workspacePath,
    "repeat-reload.ts",
    `export default function extension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("repeat-status", "ready");
    ctx.ui.setWidget("repeat-widget", ["stable line"]);
  });
}
`,
  );
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Repeat reload");
    const composer = window.getByTestId("composer");
    const status = window.locator("[data-status-key='repeat-status']");
    const widget = window.locator("[data-widget-key='repeat-widget']");
    await expect(status).toHaveText("ready", visible);
    await expect(widget).toHaveText("stable line", visible);

    for (let i = 0; i < 2; i++) {
      await composer.fill("/reload ");
      await composer.press("Enter");
      await expect(status).toHaveText("ready", visible);
      await expect(widget).toHaveText("stable line", visible);
      await expect(widget).toHaveCount(1);
      await expect(window.getByText("stable line")).toHaveCount(1);
    }
  } finally {
    await harness.close();
  }
});

test("granting and revoking project trust loads and unloads project extensions across reload", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const workspacePath = await makeWorkspace("extension-live-trust");
  const marker = join(workspacePath, "project-extension-executed");
  await mkdir(join(workspacePath, ".pi", "extensions"), { recursive: true });
  await writeFile(
    join(workspacePath, ".pi", "extensions", "probe.ts"),
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "executed");
export default function probe(pi) {
  pi.registerCommand("trusted-probe", { description: "project probe", handler: async () => {} });
}
`,
  );
  await writeCompatibilityFixture("native-only", join(agentDir, "extensions"));

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    trustInitialWorkspaces: false,
  });
  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Trust session");
    await selectSession(window, "Trust session");
    const session = await waitForSessionByTitle(window, workspace.id, "Trust session");
    const sessionKey = `${workspace.id}:${session.id}`;

    await expect
      .poll(async () =>
        access(marker).then(
          () => "ran",
          () => "absent",
        ),
      )
      .toBe("absent");
    await expect
      .poll(async () => commandNames(window, sessionKey), { timeout: 20_000 })
      .toContain("fixture-native-only");
    expect(await commandNames(window, sessionKey)).not.toContain("trusted-probe");

    await window.evaluate(async (workspaceId) => {
      await globalThis.window.piApp.setProjectTrust(workspaceId, true);
    }, workspace.id);

    // setProjectTrust rebuilds the runtime and reloads sessions. Assert catalog,
    // execution, and command availability — accessible names include descriptions.
    await expect
      .poll(async () => projectExtensionNames(window, workspace.id), { timeout: 20_000 })
      .toContain("probe");
    await expect
      .poll(async () =>
        access(marker).then(
          () => "ran",
          () => "absent",
        ),
      )
      .toBe("ran");
    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await expect(
      window.getByTestId("extensions-list").getByRole("button", { name: /probe/i }),
    ).toBeVisible({ timeout: 20_000 });
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await selectSession(window, "Trust session");
    const trustedSession = await waitForSessionByTitle(window, workspace.id, "Trust session");
    const trustedKey = `${workspace.id}:${trustedSession.id}`;
    await expect
      .poll(async () => commandNames(window, trustedKey), { timeout: 20_000 })
      .toContain("trusted-probe");

    await window.evaluate(async (workspaceId) => {
      await globalThis.window.piApp.setProjectTrust(workspaceId, false);
    }, workspace.id);

    await expect
      .poll(async () => projectExtensionNames(window, workspace.id), { timeout: 20_000 })
      .not.toContain("probe");
    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await expect(
      window.getByTestId("extensions-list").getByRole("button", { name: /probe/i }),
    ).toHaveCount(0, { timeout: 20_000 });
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await selectSession(window, "Trust session");
    const revokedSession = await waitForSessionByTitle(window, workspace.id, "Trust session");
    const revokedKey = `${workspace.id}:${revokedSession.id}`;
    await expect
      .poll(async () => commandNames(window, revokedKey), { timeout: 20_000 })
      .not.toContain("trusted-probe");
    await expect
      .poll(async () => commandNames(window, revokedKey), { timeout: 20_000 })
      .toContain("fixture-native-only");
  } finally {
    await harness.close();
  }
});

test("theme changes update rich surfaces and tool renderers without remounting", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("theme-remount-garden");
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
    await createNamedThread(window, "Theme remount");
    await expect(window.getByTestId("rich-surface-app-header")).toBeVisible(visible);

    const headerFrame = window
      .getByTestId("rich-surface-app-header")
      .frameLocator('[data-testid="rich-surface-frame"]');
    const headerMount = await headerFrame.locator("#mount").innerText();
    const headerSrc = await window
      .getByTestId("rich-surface-app-header")
      .locator('[data-testid="rich-surface-frame"]')
      .getAttribute("src");

    const state = await getDesktopState(window);
    const sessionRef = {
      workspaceId: state.selectedWorkspaceId!,
      sessionId: state.selectedSessionId!,
    };
    const timestamp = new Date().toISOString();
    await emitTestSessionEvent(harness, {
      type: "toolUpdated",
      sessionRef,
      timestamp,
      callId: "theme-1",
      toolName: "garden_probe",
      input: { city: "oslo" },
      argumentsComplete: true,
      executionStarted: true,
    });
    const toolRow = window.locator('[data-tool-name="garden_probe"]').first();
    await expect(toolRow).toHaveAttribute("data-tool-renderer", "custom", visible);
    const toolFrame = toolRow.frameLocator('[data-testid="rich-surface-frame"]');
    const toolMount = await toolFrame.locator("#mount").innerText();

    await window.evaluate(async () => {
      await globalThis.window.piApp.setThemePresetId("tokyo-night");
    });
    await expect(headerFrame.locator("#theme")).toHaveText("tokyo-night", visible);
    await expect(headerFrame.locator("#mount")).toHaveText(headerMount);
    await expect
      .poll(() =>
        window
          .getByTestId("rich-surface-app-header")
          .locator('[data-testid="rich-surface-frame"]')
          .getAttribute("src"),
      )
      .toBe(headerSrc);
    await expect
      .poll(async () => {
        const text = await toolFrame.locator("#tool-state").innerText();
        return text ? (JSON.parse(text) as { themeId?: string }).themeId : undefined;
      })
      .toBe("tokyo-night");
    await expect(toolFrame.locator("#mount")).toHaveText(toolMount);
    expect(fixtures.projectExtensionPath).toBeTruthy();
  } finally {
    await harness.close();
  }
});

async function commandNames(window: import("@playwright/test").Page, sessionKey: string) {
  return (
    (await getDesktopState(window)).sessionCommandsBySession[sessionKey]?.map(
      (command) => command.name,
    ) ?? []
  );
}

async function projectExtensionNames(
  window: import("@playwright/test").Page,
  workspaceId: string,
) {
  const state = await getDesktopState(window);
  return (
    state.runtimeByWorkspace[workspaceId]?.extensions
      .filter((extension) => extension.sourceInfo.scope === "project")
      .map((extension) => extension.displayName) ?? []
  );
}

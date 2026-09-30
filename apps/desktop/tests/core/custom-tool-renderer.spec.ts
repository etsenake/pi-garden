import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { SessionDriverEvent, SessionRef } from "@pi-garden/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { installRichSurfaceFixtures } from "../helpers/rich-surface-fixture";

const visible = { timeout: 20_000 };

test("a custom tool renderer receives stream, result, error, expansion, and theme state", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("tool-garden");
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
    await createNamedThread(window, "Tool garden");
    await expect(window.getByTestId("rich-surface-app-footer")).toBeVisible(visible);
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "toolUpdated",
      sessionRef,
      timestamp,
      callId: "probe-1",
      toolName: "garden_probe",
      input: { city: "pa" },
      argumentsComplete: false,
      executionStarted: false,
    });
    const row = window.locator('[data-tool-name="garden_probe"]').first();
    await expect(row).toHaveAttribute("data-tool-renderer", "custom", visible);
    const frame = row.frameLocator('[data-testid="rich-surface-frame"]');
    await expect
      .poll(async () => readTool(frame), { timeout: 20_000 })
      .toMatchObject({
        toolName: "garden_probe",
        toolCallId: "probe-1",
        arguments: { city: "pa" },
        argumentsComplete: false,
        executionStarted: false,
        phase: "pending",
        expanded: false,
      });

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "probe-1",
      toolName: "garden_probe",
      input: { city: "paris" },
    });
    await expect
      .poll(async () => readTool(frame))
      .toMatchObject({
        arguments: { city: "paris" },
        argumentsComplete: true,
        executionStarted: true,
        phase: "running",
      });

    await emitTestSessionEvent(harness, {
      type: "toolUpdated",
      sessionRef,
      timestamp,
      callId: "probe-1",
      toolName: "garden_probe",
      partial: { details: { step: 1 }, content: [{ type: "text", text: "Par" }] },
    });
    await expect
      .poll(async () => readTool(frame))
      .toMatchObject({
        phase: "partial",
        partial: { details: { step: 1 } },
      });

    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "probe-1",
      success: true,
      output: {
        content: [{ type: "text", text: "rain" }],
        details: { weather: "rain" },
        isError: false,
      },
    });
    await expect
      .poll(async () => readTool(frame))
      .toMatchObject({
        phase: "complete",
        result: { details: { weather: "rain" }, isError: false },
      });

    await row.getByRole("button", { name: /garden_probe/ }).click();
    await expect.poll(async () => (await readTool(frame)).expanded).toBe(true);
    const composer = window.getByTestId("composer");
    await composer.fill("/rich-tools on ");
    await composer.press("Enter");
    await expect(window.getByText("tools on", { exact: true })).toBeVisible(visible);
    await expect.poll(async () => (await readTool(frame)).expanded).toBe(true);
    await composer.fill("/rich-tools off ");
    await composer.press("Enter");
    await expect(window.getByText("tools off", { exact: true })).toBeVisible(visible);
    await expect.poll(async () => (await readTool(frame)).expanded).toBe(false);

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "probe-2",
      toolName: "garden_probe",
      input: { city: "rome" },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "probe-2",
      success: false,
      output: { isError: true, content: [], error: "no forecast" },
    });
    const errorRow = window.locator('[data-tool-name="garden_probe"]').nth(1);
    await expect
      .poll(async () => readTool(errorRow.frameLocator('[data-testid="rich-surface-frame"]')), {
        timeout: 20_000,
      })
      .toMatchObject({ phase: "error", error: expect.any(String) });

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "broken-1",
      toolName: "garden_broken",
      input: { city: "oslo" },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "broken-1",
      success: true,
      output: { content: [{ type: "text", text: "still visible" }] },
    });
    const broken = window.locator('[data-tool-name="garden_broken"]');
    await expect(broken).toHaveAttribute("data-tool-renderer", "builtin", visible);
    await broken.getByRole("button").click();
    await expect(broken).toContainText("still visible");

    await window.evaluate(async () => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.setThemePresetId("tokyo-night");
    });
    await expect.poll(async () => (await readTool(frame)).themeId).toBe("tokyo-night");

    await window.evaluate(
      async ({ targetWorkspacePath, targetExtensionPath }) => {
        const app = globalThis.window.piApp;
        if (!app) throw new Error("piApp IPC bridge is unavailable");
        const state = await app.getState();
        const workspace = state.workspaces.find((entry) => entry.path === targetWorkspacePath);
        if (!workspace) throw new Error(`Workspace not found: ${targetWorkspacePath}`);
        await app.setExtensionEnabled(workspace.id, targetExtensionPath, false);
      },
      { targetWorkspacePath: workspacePath, targetExtensionPath: fixtures.projectExtensionPath },
    );
    const fallback = window.locator('[data-tool-name="garden_probe"]').first();
    await expect(fallback).toHaveAttribute("data-tool-renderer", "builtin", visible);
    await fallback.getByRole("button").click();
    await expect(fallback).toContainText("rain");
  } finally {
    await harness.close();
  }
});

async function selectedSessionRef(window: Page): Promise<SessionRef> {
  const state = await getDesktopState(window);
  if (!state.selectedWorkspaceId || !state.selectedSessionId) {
    throw new Error("Expected a selected session");
  }
  return { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
}

async function readTool(frame: ReturnType<Page["frameLocator"]>): Promise<{
  themeId?: string;
  expanded?: boolean;
  phase?: string;
  error?: string;
}> {
  const text = await frame.locator("#tool-state").textContent();
  return text ? (JSON.parse(text) as { themeId?: string; expanded?: boolean }) : {};
}

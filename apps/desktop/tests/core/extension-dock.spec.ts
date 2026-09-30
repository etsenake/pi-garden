import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  assertExists,
  commitAllInGitRepo,
  createNamedThread,
  getDesktopState,
  initGitRepo,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  writeProjectExtension,
} from "../helpers/electron-app";

const extensionSource = String.raw`
const green = "\u001b[32m";
const reset = "\u001b[0m";

export default function composerUiExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("zeta", "Last key");
    ctx.ui.setStatus("alpha", green + "First key" + reset);
    ctx.ui.setWidget("zeta", ["Zeta above", "  nested"]);
    ctx.ui.setWidget("alpha", ["Alpha above"]);
    ctx.ui.setWidget("below", [green + "Below line" + reset], { placement: "belowEditor" });
  });

  pi.registerCommand("update-zeta", {
    description: "Update the zeta widget in place",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("zeta", ["Zeta updated", "  nested updated"]);
    },
  });

  pi.registerCommand("clear-alpha", {
    description: "Remove the alpha widget",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("alpha", []);
    },
  });

  pi.registerCommand("move-zeta-below", {
    description: "Move the zeta widget below the editor",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("zeta", ["Zeta below"], { placement: "belowEditor" });
    },
  });

  pi.registerCommand("clear-below", {
    description: "Remove the below widget",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("below", [], { placement: "belowEditor" });
    },
  });

  pi.registerCommand("update-status", {
    description: "Replace the alpha status with a multiline value",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("alpha", "Alpha updated\nstill one line");
    },
  });

  pi.registerCommand("clear-statuses", {
    description: "Clear every status",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("alpha", "");
      ctx.ui.setStatus("zeta", undefined);
    },
  });
}
`;

const tickingExtensionSource = String.raw`
export default function tickingExtension(pi) {
  pi.on("session_start", async (_event, ctx) => {
    let tick = 0;
    const render = () => {
      ctx.ui.setWidget("ticker", ["Tick " + tick, "child line"]);
    };
    render();

    const interval = setInterval(() => {
      tick += 1;
      render();
      if (tick >= 3) {
        clearInterval(interval);
      }
    }, 250);
  });
}
`;

test("places extension widgets around the prompt and keeps status in the footer", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-composer-ui-workspace");
  await initGitRepo(workspacePath);
  await mkdir(join(workspacePath, "src"), { recursive: true });
  await writeFile(
    join(workspacePath, "src", "App.tsx"),
    "export default function App() { return null; }\n",
    "utf8",
  );
  await commitAllInGitRepo(workspacePath, "init");
  await writeProjectExtension(workspacePath, "composer-ui-extension.ts", extensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Composer UI session");

    const composer = window.getByTestId("composer");
    const above = window.getByTestId("extension-widgets-above");
    const below = window.getByTestId("extension-widgets-below");
    const statusLine = window.getByTestId("extension-status-line");
    const statuses = statusLine.locator("[data-status-key]");
    const aboveWidgets = above.locator("[data-widget-key]");

    await expect(above).toHaveAttribute("data-placement", "aboveEditor");
    await expect(below).toHaveAttribute("data-placement", "belowEditor");
    await expect(window.getByTestId("extension-dock")).toHaveCount(0);
    await expect(statuses).toHaveText(["First key", "Last key"]);
    await expect(statusLine).not.toContainText("alpha");
    await expect(statusLine).not.toContainText("\u001b[32m");
    await expect(aboveWidgets).toHaveCount(2);
    await expect(aboveWidgets.nth(0)).toHaveAttribute("data-widget-key", "zeta");
    await expect(aboveWidgets.nth(1)).toHaveAttribute("data-widget-key", "alpha");
    await expect
      .poll(async () => window.locator("[data-widget-key='zeta']").textContent())
      .toBe("Zeta above\n  nested");
    await expect(window.locator("[data-widget-key='below']")).toHaveText("Below line");
    await expect(below).not.toContainText("\u001b[32m");

    const composerBox = await boxOf(composer);
    const aboveBox = await boxOf(above);
    const belowBox = await boxOf(below);
    const statusBox = await boxOf(statusLine);
    const sendBox = await boxOf(window.getByTestId("send"));
    expect(aboveBox.y + aboveBox.height).toBeLessThanOrEqual(composerBox.y + 1);
    expect(belowBox.y).toBeGreaterThanOrEqual(composerBox.y + composerBox.height - 1);
    expect(statusBox.y).toBeGreaterThanOrEqual(sendBox.y + sendBox.height - 1);

    await composer.fill("/");
    const slashMenu = window.getByTestId("slash-menu");
    await expect(slashMenu).toBeVisible();
    const slashMenuBox = await boxOf(slashMenu);
    expect(slashMenuBox.y + slashMenuBox.height).toBeLessThanOrEqual(composerBox.y + 1);

    await composer.fill("@");
    const mentionMenu = window.getByTestId("mention-menu");
    await expect(mentionMenu).toBeVisible();
    const mentionMenuBox = await boxOf(mentionMenu);
    expect(mentionMenuBox.y + mentionMenuBox.height).toBeLessThanOrEqual(composerBox.y + 1);
    await composer.fill("");

    await expect
      .poll(async () => {
        const nextState = await getDesktopState(window);
        const sessionKey = `${nextState.selectedWorkspaceId}:${nextState.selectedSessionId}`;
        return (nextState.sessionCommandsBySession[sessionKey] ?? []).map(
          (command) => command.name,
        );
      })
      .toEqual(
        expect.arrayContaining([
          "update-zeta",
          "clear-alpha",
          "move-zeta-below",
          "clear-below",
          "update-status",
          "clear-statuses",
        ]),
      );

    await runExtensionCommand(window, "update-zeta");
    await expect(aboveWidgets).toHaveCount(2);
    await expect(aboveWidgets.nth(0)).toHaveAttribute("data-widget-key", "zeta");
    await expect
      .poll(async () => window.locator("[data-widget-key='zeta']").textContent())
      .toBe("Zeta updated\n  nested updated");
    await expect(window.locator("[data-widget-key='alpha']")).toHaveText("Alpha above");

    await runExtensionCommand(window, "clear-alpha");
    await expect(above.locator("[data-widget-key='alpha']")).toHaveCount(0);
    await expect(above.locator("[data-widget-key='zeta']")).toHaveCount(1);

    await runExtensionCommand(window, "move-zeta-below");
    await expect(above).toHaveCount(0);
    const belowWidgets = below.locator("[data-widget-key]");
    await expect(belowWidgets).toHaveCount(2);
    await expect(belowWidgets.nth(0)).toHaveAttribute("data-widget-key", "zeta");
    await expect(belowWidgets.nth(1)).toHaveAttribute("data-widget-key", "below");
    await expect(window.locator("[data-widget-key='zeta']")).toHaveCount(1);
    await expect(window.locator("[data-widget-key='zeta']")).toHaveText("Zeta below");

    await runExtensionCommand(window, "clear-below");
    await expect(below.locator("[data-widget-key='below']")).toHaveCount(0);
    await expect(window.locator("[data-widget-key='zeta']")).toHaveCount(1);

    await runExtensionCommand(window, "update-status");
    await expect(statuses).toHaveText(["Alpha updated still one line", "Last key"]);

    await runExtensionCommand(window, "clear-statuses");
    await expect(statusLine).toHaveCount(0);
    await expect(window.locator("[data-widget-key='zeta']")).toHaveText("Zeta below");
    await expect(window.getByTestId("send")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("does not spam the transcript when an extension updates its widget repeatedly", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("extension-dock-ticker-workspace");
  await writeProjectExtension(workspacePath, "ticking-extension.ts", tickingExtensionSource);

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Ticker session");

    const transcriptActivities = window.locator(".timeline .timeline-activity");
    const baselineCount = await transcriptActivities.count();
    const ticker = window.locator("[data-widget-key='ticker']");

    await expect
      .poll(async () => ticker.textContent(), { timeout: 10_000 })
      .toBe("Tick 3\nchild line");
    await expect(ticker).toHaveCount(1);
    await expect(transcriptActivities).toHaveCount(baselineCount);
    await expect(window.locator(".timeline")).not.toContainText("Tick 1");
    await expect(window.locator(".timeline")).not.toContainText("Tick 2");
    await expect(window.locator(".timeline")).not.toContainText("Tick 3");
  } finally {
    await harness.close();
  }
});

async function runExtensionCommand(window: Page, name: string): Promise<void> {
  const composer = window.getByTestId("composer");
  await composer.fill(`/${name} `);
  await composer.press("Enter");
}

async function boxOf(locator: Locator) {
  const value = await locator.boundingBox();
  assertExists(value, "Expected an element box");
  return value;
}

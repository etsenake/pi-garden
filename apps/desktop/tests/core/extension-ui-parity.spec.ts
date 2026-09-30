import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { DesktopAppState } from "../../contracts/desktop-state";
import {
  clickSession,
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openWindowViaShortcut,
  seedAgentDir,
  waitForWorkspaceByPath,
  writeProjectExtension,
} from "../helpers/electron-app";

/**
 * Drives the native desktop analogues of Pi's `ExtensionUIContext` through real
 * local Pi extensions: working presentation, hidden-thinking label, tool
 * expansion, dialog abort, notify levels, styled widgets, and editor access.
 * See docs/pi-extension-ui-parity.md for the capability manifest.
 */

const PROVIDER_ID = "ui-parity-test";
const MODEL_ID = "scripted";

// A scripted local provider that keeps a run open until the prompt's
// `release:<name>` file exists, so the working presentation can be observed.
// `tool:call` makes the model call the extension's tool first; `thinking`
// gives the reply a thinking block.
function providerExtensionSource(workspacePath: string): string {
  return String.raw`
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

const WORKSPACE = ${JSON.stringify(workspacePath)};

const echoTool = defineTool({
  name: "parity_echo",
  label: "Parity echo",
  description: "Echo text back",
  parameters: Type.Object({ text: Type.String() }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    // An extension tool reading the live draft mid-run, as Pi allows.
    ctx.ui.notify("Editor text: " + ctx.ui.getEditorText(), "info");
    return { content: [{ type: "text", text: "echo " + params.text }] };
  },
});

function lastUserText(messages) {
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  return JSON.stringify(messages[lastUser] ?? "");
}

export default function parityProvider(pi) {
  pi.registerTool(echoTool);
  pi.registerProvider(${JSON.stringify(PROVIDER_ID)}, {
    baseUrl: "http://127.0.0.1:9/never-contact",
    apiKey: "LOCAL_TEST_CANARY",
    api: ${JSON.stringify(PROVIDER_ID)},
    models: [{
      id: ${JSON.stringify(MODEL_ID)}, name: "Scripted parity", reasoning: true,
      input: ["text"], contextWindow: 128000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
    streamSimple(model, context) {
      const lastUser = context.messages.findLastIndex((message) => message.role === "user");
      const prompt = lastUserText(context.messages);
      const wantsTool = prompt.includes("tool:call");
      const toolDone = context.messages.slice(lastUser + 1).some((message) => message.role === "toolResult");
      const callTool = wantsTool && !toolDone;
      const wantsThinking = prompt.includes("thinking");
      const releaseMatch = /release:([A-Za-z0-9_-]+)/.exec(prompt);
      const releasePath = releaseMatch ? join(WORKSPACE, releaseMatch[1]) : undefined;
      const text = "Scripted reply";
      const content = callTool
        ? [{ type: "toolCall", id: "parity-call-1", name: "parity_echo", arguments: { text: "hi" } }]
        : [
            ...(wantsThinking ? [{ type: "thinking", thinking: "Considering the prompt carefully." }] : []),
            { type: "text", text },
          ];
      const message = {
        role: "assistant", content,
        api: model.api, provider: model.provider, model: model.id,
        usage: {
          input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: callTool ? "toolUse" : "stop", timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: { ...message, content: [] } });
      const finish = () => {
        if (!callTool) {
          stream.push({ type: "text_delta", contentIndex: content.length - 1, delta: text, partial: message });
        }
        stream.push({ type: "done", reason: message.stopReason, message });
      };
      if (releasePath && !(wantsTool && toolDone)) {
        const poll = () => {
          if (existsSync(releasePath)) finish();
          else setTimeout(poll, 50);
        };
        setTimeout(poll, 50);
      } else {
        finish();
      }
      return stream;
    },
  });
}
`;
}

// The extension under test: every native ExtensionUIContext member reachable
// through commands or the before_agent_start hook.
const uiExtensionSource = String.raw`
export default function uiParityExtension(pi) {
  pi.on("before_agent_start", (event, ctx) => {
    const prompt = event.prompt;
    if (prompt.includes("working:message")) ctx.ui.setWorkingMessage("Deploying");
    if (prompt.includes("working:hidden")) ctx.ui.setWorkingVisible(false);
    if (prompt.includes("working:visible")) ctx.ui.setWorkingVisible(true);
    if (prompt.includes("working:static")) ctx.ui.setWorkingIndicator({ frames: ["●"] });
    if (prompt.includes("working:none")) ctx.ui.setWorkingIndicator({ frames: [] });
    if (prompt.includes("working:frames")) ctx.ui.setWorkingIndicator({ frames: ["1", "2", "3"], intervalMs: 100 });
    if (prompt.includes("working:default")) {
      ctx.ui.setWorkingMessage();
      ctx.ui.setWorkingIndicator();
      ctx.ui.setWorkingVisible(true);
    }
  });

  pi.registerCommand("ui-thinking-label", {
    description: "Set or clear the hidden thinking label",
    handler: async (args, ctx) => {
      const label = args.trim();
      ctx.ui.setHiddenThinkingLabel(label === "clear" ? undefined : label);
    },
  });

  pi.registerCommand("ui-tools", {
    description: "Set tools expanded",
    handler: async (args, ctx) => {
      ctx.ui.setToolsExpanded(args.trim() === "on");
      ctx.ui.notify("Tools expanded: " + String(ctx.ui.getToolsExpanded()), "info");
    },
  });

  pi.registerCommand("ui-notify", {
    description: "Notify at a level",
    handler: async (args, ctx) => {
      const [level, ...rest] = args.trim().split(" ");
      ctx.ui.notify(rest.join(" "), level);
    },
  });

  pi.registerCommand("ui-status", {
    description: "Set a styled status",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("parity", "\u001b[1m\u001b[32mReady\u001b[39m\u001b[22m \u001b[2mdim\u001b[22m");
    },
  });

  pi.registerCommand("ui-widget", {
    description: "Set a long styled widget above and a plain one below",
    handler: async (_args, ctx) => {
      const lines = [];
      for (let index = 1; index <= 12; index += 1) {
        lines.push(index === 1 ? "\u001b[31mline " + index + "\u001b[0m \u001b[2J\u001b]0;title\u0007tail" : "line " + index);
      }
      ctx.ui.setWidget("parity-above", lines, { placement: "aboveEditor" });
      ctx.ui.setWidget("parity-below", ["below line"], { placement: "belowEditor" });
    },
  });

  pi.registerCommand("ui-widget-clear", {
    description: "Clear widgets and status",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("parity-above", undefined);
      ctx.ui.setWidget("parity-below", undefined);
      ctx.ui.setStatus("parity", undefined);
    },
  });

  pi.registerCommand("ui-title", {
    description: "Set the session title",
    handler: async (args, ctx) => {
      ctx.ui.setTitle(args.trim());
    },
  });

  pi.registerCommand("ui-abort-confirm", {
    description: "Confirm that aborts itself",
    handler: async (_args, ctx) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1500);
      const confirmed = await ctx.ui.confirm("Abortable?", "This closes on abort.", { signal: controller.signal });
      ctx.ui.notify("Abort result: " + String(confirmed), "info");
    },
  });

  pi.registerCommand("ui-timeout-select", {
    description: "Select that times out",
    handler: async (_args, ctx) => {
      const value = await ctx.ui.select("Timed select", ["One", "Two"], { timeout: 1500 });
      ctx.ui.notify("Timeout select: " + String(value), "info");
    },
  });

  pi.registerCommand("ui-editor-roundtrip", {
    description: "Set, paste, then read the editor text",
    handler: async (_args, ctx) => {
      const before = ctx.ui.getEditorText();
      ctx.ui.setEditorText("Prefilled");
      ctx.ui.pasteToEditor(" +pasted");
      ctx.ui.notify("Editor before: [" + before + "] after: [" + ctx.ui.getEditorText() + "]", "info");
    },
  });
}
`;

// User-scope extension: sets state on every session start so scope isolation is observable.
const userExtensionSource = String.raw`
export default function userScopeExtension(pi) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus("user-scope", "user ready");
  });
}
`;

async function writeSettings(agentDir: string): Promise<void> {
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: PROVIDER_ID,
      defaultModel: MODEL_ID,
      enabledModels: [`${PROVIDER_ID}/${MODEL_ID}`],
      packages: [],
      cacheWarming: "off",
      compaction: { enabled: false },
    }),
  );
}

async function send(window: Page, text: string): Promise<void> {
  const composer = window.getByTestId("composer");
  await composer.fill(text);
  await composer.press("Enter");
}

async function expectRunning(window: Page): Promise<void> {
  await expect(window.getByTestId("send")).toHaveAttribute("aria-label", "Stop run");
}

async function expectIdle(window: Page): Promise<void> {
  await expect(window.getByTestId("send")).not.toHaveAttribute("aria-label", "Stop run", {
    timeout: 20_000,
  });
}

async function release(workspacePath: string, name: string): Promise<void> {
  await writeFile(join(workspacePath, name), "go", "utf8");
}

function selectedSessionKey(state: DesktopAppState): string {
  return `${state.selectedWorkspaceId}:${state.selectedSessionId}`;
}

function selectedExtensionUi(state: DesktopAppState) {
  return state.sessionExtensionUiBySession[selectedSessionKey(state)];
}

test("working presentation, hidden-thinking label and tool expansion follow Pi's UI context", async () => {
  test.setTimeout(150_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("ui-parity-run");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeSettings(agentDir);
  await writeProjectExtension(workspacePath, "provider.ts", providerExtensionSource(workspacePath));
  await writeProjectExtension(workspacePath, "ui-parity.ts", uiExtensionSource);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Parity run");
    const header = window.locator(".chat-header__status");
    const workingRow = window.getByTestId("working-row");
    const indicator = workingRow.locator(".timeline-activity__indicator");

    // Default presentation: Pi's default message and spinner.
    await send(window, "plain release:r0");
    await expectRunning(window);
    await expect(workingRow).toHaveAttribute("data-working-message", "default");
    await expect(workingRow).toHaveAttribute("data-working-indicator", "default");
    await expect(workingRow).toContainText("Working");
    await expect(header).toContainText("Working");
    await release(workspacePath, "r0");
    await expectIdle(window);
    await expect(workingRow).toHaveCount(0);

    // setWorkingMessage replaces the text in the row and the header.
    await send(window, "working:message release:r1");
    await expectRunning(window);
    await expect(workingRow).toHaveAttribute("data-working-message", "custom");
    await expect(workingRow).toContainText("Deploying");
    await expect(header).toContainText("Deploying");
    await expect(header).not.toContainText("Working");
    await release(workspacePath, "r1");
    await expectIdle(window);

    // setWorkingVisible(false) hides the row while the run keeps its state.
    await send(window, "working:hidden release:r2");
    await expectRunning(window);
    await expect(header).toContainText("Deploying");
    await expect(workingRow).toHaveCount(0);
    await release(workspacePath, "r2");
    await expectIdle(window);

    // A single frame is static; no frames hides the indicator; many animate.
    await send(window, "working:visible working:static release:r3");
    await expectRunning(window);
    await expect(workingRow).toHaveAttribute("data-working-indicator", "custom");
    await expect(indicator).toHaveText("●");
    await release(workspacePath, "r3");
    await expectIdle(window);

    await send(window, "working:none release:r4");
    await expectRunning(window);
    await expect(workingRow).toHaveAttribute("data-working-indicator", "hidden");
    await expect(indicator).toHaveCount(0);
    await release(workspacePath, "r4");
    await expectIdle(window);

    await send(window, "working:frames release:r5");
    await expectRunning(window);
    await expect(workingRow).toHaveAttribute("data-working-indicator", "custom");
    const seenFrames = new Set<string>();
    await expect
      .poll(async () => {
        seenFrames.add(await indicator.innerText());
        return seenFrames.size;
      })
      .toBeGreaterThanOrEqual(2);
    for (const frame of seenFrames) expect(["1", "2", "3"]).toContain(frame);
    await release(workspacePath, "r5");
    await expectIdle(window);

    // Clearing every setter restores Pi's defaults.
    await send(window, "working:default release:r6");
    await expectRunning(window);
    await expect(workingRow).toHaveAttribute("data-working-message", "default");
    await expect(workingRow).toHaveAttribute("data-working-indicator", "default");
    await expect(header).toContainText("Working");
    await release(workspacePath, "r6");
    await expectIdle(window);

    // Runtime cleanup: state set during a run is reset when the runtime reloads.
    await send(window, "working:message working:static release:r7");
    await expectRunning(window);
    await expect(workingRow).toContainText("Deploying");
    await release(workspacePath, "r7");
    await expectIdle(window);
    await expect
      .poll(async () => selectedExtensionUi(await getDesktopState(window))?.working)
      .toEqual({ message: "Deploying", visible: true, indicator: { frames: ["●"] } });
    await send(window, "/reload ");
    // The reset drops the session's record entirely; absent means Pi's defaults.
    await expect
      .poll(async () => {
        const ui = selectedExtensionUi(await getDesktopState(window));
        return ui === undefined ? "defaults" : ui.working;
      })
      .toBe("defaults");
    await send(window, "plain release:r8");
    await expectRunning(window);
    await expect(workingRow).toHaveAttribute("data-working-message", "default");
    await expect(workingRow).toHaveAttribute("data-working-indicator", "default");
    await release(workspacePath, "r8");
    await expectIdle(window);

    // Hidden thinking label: default wording, custom wording, cleared wording.
    const hiddenThinking = window.getByTestId("hidden-thinking");
    await expect(hiddenThinking).toHaveCount(0);
    await send(window, "thinking please");
    await expectIdle(window);
    await expect(hiddenThinking).toHaveCount(1);
    await expect(hiddenThinking).toHaveText("Thinking...");
    await send(window, "/ui-thinking-label Pondering deeply");
    await expect(hiddenThinking).toHaveText("Pondering deeply");
    await send(window, "/ui-thinking-label clear");
    await expect(hiddenThinking).toHaveText("Thinking...");

    // Tool expansion: Pi's default is collapsed; setToolsExpanded flips every row,
    // a user click flips one row away from the default, and a new default wins.
    // The tool runs while the user's draft is intact, so getEditorText sees it.
    await send(window, "tool:call now release:r9");
    await expectRunning(window);
    await window.getByTestId("composer").fill("Draft text");
    await expect.poll(async () => (await getDesktopState(window)).composerDraft).toBe("Draft text");
    await release(workspacePath, "r9");
    await expectIdle(window);
    await expect(window.locator(".timeline")).toContainText("Editor text: Draft text");
    await expect(window.getByTestId("composer")).toHaveValue("Draft text");
    await window.getByTestId("composer").fill("");
    const toolHeaders = window.locator(".timeline-tool .timeline-tool__header");
    await expect(toolHeaders).toHaveCount(1);
    await expect(toolHeaders.first()).toHaveAttribute("aria-expanded", "false");
    await send(window, "/ui-tools on");
    await expect(window.locator(".timeline")).toContainText("Tools expanded: true");
    await expect(toolHeaders.first()).toHaveAttribute("aria-expanded", "true");
    await toolHeaders.first().click();
    await expect(toolHeaders.first()).toHaveAttribute("aria-expanded", "false");
    await send(window, "/ui-tools off");
    await expect(window.locator(".timeline")).toContainText("Tools expanded: false");
    await expect(toolHeaders.first()).toHaveAttribute("aria-expanded", "false");
    await send(window, "/ui-tools on");
    await expect(toolHeaders.first()).toHaveAttribute("aria-expanded", "true");
    // Reload restores Pi's default expansion.
    await send(window, "/reload ");
    await expect(toolHeaders.first()).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(async () => selectedExtensionUi(await getDesktopState(window))?.toolsExpanded ?? false)
      .toBe(false);
  } finally {
    await harness.close();
    for (const name of ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]) {
      if (existsSync(join(workspacePath, name))) await rm(join(workspacePath, name));
    }
  }
});

test("dialog abort/timeout, notify levels, styled widgets, editor access and scope cleanup", async () => {
  test.setTimeout(150_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("ui-parity-surface");
  const otherWorkspacePath = await makeWorkspace("ui-parity-other");
  await seedAgentDir(agentDir);
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(join(agentDir, "extensions", "user-scope.ts"), userExtensionSource, "utf8");
  const projectExtensionPath = await writeProjectExtension(
    workspacePath,
    "ui-parity.ts",
    uiExtensionSource,
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath, otherWorkspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await waitForWorkspaceByPath(window, otherWorkspacePath);
    const workspaceName = workspacePath.split("/").at(-1)!;
    const otherWorkspaceName = otherWorkspacePath.split("/").at(-1)!;
    await createNamedThread(window, "Parity A", { workspaceName });
    const timeline = window.locator(".timeline");
    const dialog = window.getByTestId("extension-dialog");
    const composer = window.getByTestId("composer");

    // User-scope extension state is present in the project workspace...
    await expect(window.locator("[data-status-key='user-scope']")).toHaveText("user ready");

    // AbortSignal closes the modal and resolves Pi's cancel value.
    await send(window, "/ui-abort-confirm ");
    await expect(window.getByRole("dialog", { name: "Abortable?" })).toBeVisible();
    await expect(dialog).toHaveCount(0, { timeout: 8_000 });
    await expect(timeline).toContainText("Abort result: false");

    // Timeout on select resolves undefined and closes the modal.
    await send(window, "/ui-timeout-select ");
    await expect(window.getByRole("dialog", { name: "Timed select" })).toBeVisible();
    await expect(dialog).toHaveCount(0, { timeout: 8_000 });
    await expect(timeline).toContainText("Timeout select: undefined");

    // notify levels are visibly and semantically distinct.
    await send(window, "/ui-notify info Plain note");
    await send(window, "/ui-notify warning Careful now");
    await send(window, "/ui-notify error Broke it");
    const info = timeline.locator(".timeline-activity[data-notify-level='info']", {
      hasText: "Plain note",
    });
    const warning = timeline.locator(".timeline-activity[data-notify-level='warning']");
    const error = timeline.locator(".timeline-activity[data-notify-level='error']");
    await expect(info).toHaveCount(1);
    await expect(info).toHaveAttribute("role", "status");
    await expect(warning).toHaveText(/^Warning: Careful now/);
    await expect(warning).toHaveClass(/timeline-activity--warning/);
    await expect(error).toHaveText(/^Error: Broke it/);
    await expect(error).toHaveClass(/timeline-activity--error/);
    await expect(error).toHaveAttribute("role", "alert");
    const [infoColor, warningColor, errorColor] = await Promise.all(
      [info, warning, error].map((row) =>
        row.evaluate((element) => getComputedStyle(element).color),
      ),
    );
    expect(new Set([infoColor, warningColor, errorColor]).size).toBe(3);

    // Styled status and widgets: attributes and colors survive, control
    // sequences are stripped, and Pi's ten-line cap applies.
    await send(window, "/ui-status ");
    const status = window.locator("[data-status-key='parity']");
    await expect(status).toHaveText("Ready dim");
    await expect(status.locator(".ansi--bold.ansi-fg-green")).toHaveText("Ready");
    await expect(status.locator(".ansi--dim")).toHaveText("dim");

    await send(window, "/ui-widget ");
    const above = window.locator("[data-widget-key='parity-above']");
    await expect(above.locator(".ansi-fg-red")).toHaveText("line 1");
    await expect(above).toContainText("line 1 tail");
    await expect(above).toContainText("line 10");
    await expect(above).not.toContainText("line 11");
    await expect(above.getByTestId("extension-widget-truncated")).toHaveText(
      /\(widget truncated\)/,
    );
    await expect(window.getByTestId("extension-widgets-above")).toHaveAttribute(
      "data-placement",
      "aboveEditor",
    );
    await expect(window.locator("[data-widget-key='parity-below']")).toHaveText("below line");
    await expect(window.getByTestId("extension-widgets-below")).toHaveAttribute(
      "data-placement",
      "belowEditor",
    );

    // Editor access from a command: the submitted command has left the editor,
    // setEditorText replaces the draft, pasteToEditor appends, and getEditorText
    // reads the result back in the same handler. The composer shows the text.
    await send(window, "/ui-editor-roundtrip ");
    await expect(timeline).toContainText("Editor before: [] after: [Prefilled +pasted]");
    await expect(composer).toHaveValue("Prefilled +pasted");
    await composer.fill("");

    // setTitle and a second window: both windows show the same session state.
    await send(window, "/ui-title Parity Title");
    await expect(window.locator(".chat-header__title")).toHaveText("Parity Title");
    const second = await openWindowViaShortcut(harness, window);
    await clickSession(second, "Parity A");
    await expect(second.locator(".chat-header__title")).toHaveText("Parity Title");
    await expect(second.locator("[data-widget-key='parity-above']")).toContainText("line 1 tail");
    await expect(second.locator("[data-status-key='parity']")).toHaveText("Ready dim");
    await send(second, "/ui-widget-clear ");
    await expect(second.locator("[data-widget-key='parity-above']")).toHaveCount(0);
    await expect(window.locator("[data-widget-key='parity-above']")).toHaveCount(0);
    await expect(window.locator("[data-status-key='parity']")).toHaveCount(0);
    await second.close();

    // Session switch: the second session has its own, empty state; switching
    // back restores the first session's title.
    await createNamedThread(window, "Parity B", { workspaceName });
    await expect(window.locator(".chat-header__title")).toHaveText("Parity B");
    await expect(window.locator("[data-widget-key='parity-above']")).toHaveCount(0);
    await expect(window.locator("[data-status-key='user-scope']")).toHaveText("user ready");
    await clickSession(window, "Parity A");
    await expect(window.locator(".chat-header__title")).toHaveText("Parity Title");

    // Workspace switch and scope: the project extension is project-local (its
    // commands are absent elsewhere); the user extension follows the user.
    await createNamedThread(window, "Other workspace", { workspaceName: otherWorkspaceName });
    await expect(window.locator("[data-status-key='user-scope']")).toHaveText("user ready");
    await expect(window.locator("[data-status-key='parity']")).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return (state.sessionCommandsBySession[selectedSessionKey(state)] ?? []).map(
          (command) => command.name,
        );
      })
      .not.toContain("ui-status");
    await clickSession(window, "Parity A");

    // Reload clears extension-set state for the session (title falls back).
    await send(window, "/ui-status ");
    await expect(window.locator("[data-status-key='parity']")).toHaveText("Ready dim");
    await send(window, "/reload ");
    await expect(window.locator("[data-status-key='parity']")).toHaveCount(0);
    await expect(window.locator(".chat-header__title")).toHaveText("Parity A");
    await expect(window.locator("[data-status-key='user-scope']")).toHaveText("user ready");

    // Disabling the project extension removes its contributions; the user
    // extension's state stays.
    await send(window, "/ui-status ");
    await expect(window.locator("[data-status-key='parity']")).toHaveText("Ready dim");
    await window.evaluate(
      async ({ targetWorkspacePath, targetExtensionPath }) => {
        const app = globalThis.window.piApp;
        if (!app) throw new Error("piApp IPC bridge is unavailable");
        const state = await app.getState();
        const workspace = state.workspaces.find((entry) => entry.path === targetWorkspacePath);
        if (!workspace) throw new Error(`Workspace not found: ${targetWorkspacePath}`);
        await app.setExtensionEnabled(workspace.id, targetExtensionPath, false);
      },
      { targetWorkspacePath: workspacePath, targetExtensionPath: projectExtensionPath },
    );
    await expect(window.locator("[data-status-key='parity']")).toHaveCount(0);
    await expect(window.locator("[data-status-key='user-scope']")).toHaveText("user ready");

    // Removing the user extension file and reloading drops its state too.
    await rm(join(agentDir, "extensions", "user-scope.ts"));
    await send(window, "/reload ");
    await expect(window.locator("[data-status-key='user-scope']")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

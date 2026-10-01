import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import { customHeaderFrontend, writeRealPiExtension } from "../helpers/real-pi-extension-fixtures";

/**
 * Recorded Adapt-for-Desktop conversation through the normal Pi thread path.
 * A scripted local provider follows the skill procedure: run apply.mjs via the
 * real bash tool, then confirm. Separate from direct writer unit calls.
 */

const PROVIDER_ID = "adapt-live-test";
const MODEL_ID = "scripted";
const ARTIFACT_DIR = join(process.cwd(), ".artifacts", "adapt-live");

function adaptProviderSource(): string {
  return String.raw`
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

function field(prompt, label) {
  const marker = label + ": ";
  const idx = prompt.indexOf(marker);
  if (idx < 0) return "";
  const rest = prompt.slice(idx + marker.length);
  const end = rest.search(/(\\n|")/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

export default function adaptLiveProvider(pi) {
  pi.registerProvider(${JSON.stringify(PROVIDER_ID)}, {
    baseUrl: "http://127.0.0.1:9/never-contact",
    apiKey: "LOCAL_TEST_CANARY",
    api: ${JSON.stringify(PROVIDER_ID)},
    models: [{
      id: ${JSON.stringify(MODEL_ID)}, name: "Scripted Adapt", reasoning: false,
      input: ["text"], contextWindow: 128000, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
    streamSimple(model, context) {
      const lastUser = context.messages.findLastIndex((message) => message.role === "user");
      const prompt = JSON.stringify(context.messages[lastUser] ?? "");
      const isAdapt = prompt.includes("adapt-for-desktop") && prompt.includes("Adapt writer");
      const toolDone = context.messages.slice(lastUser + 1).some((message) => message.role === "toolResult");
      let content;
      let stopReason = "stop";
      if (isAdapt && !toolDone) {
        const writer = field(prompt, "Adapt writer (run with node; self-contained, no repo checkout)");
        const entry = field(prompt, "Target extension entry");
        const helper = field(prompt, "@pi-garden/extension-ui package to vendor from (read-only source)");
        const command = "node " + JSON.stringify(writer) + " " + JSON.stringify(entry) + " " + JSON.stringify(helper);
        content = [{ type: "toolCall", id: "adapt-apply-1", name: "bash", arguments: { command } }];
        stopReason = "toolUse";
      } else if (isAdapt) {
        content = [{ type: "text", text: "Adapted custom-header with apply.mjs; reload to refresh the inventory." }];
      } else {
        content = [{ type: "text", text: "unexpected prompt" }];
      }
      const message = {
        role: "assistant", content,
        api: model.api, provider: model.provider, model: model.id,
        usage: {
          input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason, timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: { ...message, content: [] } });
      if (stopReason === "stop") {
        stream.push({ type: "text_delta", contentIndex: 0, delta: content[0].text, partial: message });
      }
      stream.push({ type: "done", reason: message.stopReason, message });
      return stream;
    },
  });
}
`;
}

test("Adapt for Desktop conversation runs the writer, reloads, and refreshes inventory", async () => {
  test.setTimeout(240_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
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
  const workspacePath = await makeWorkspace("live-adapt-conversation");
  // User-scoped provider so models exist before Adapt starts a thread (same as
  // extension-provider-models). The Adapt target stays a separate user extension.
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(join(agentDir, "extensions", "adapt-live-provider.ts"), adaptProviderSource());
  const entry = await writeRealPiExtension("custom-header", join(agentDir, "extensions"));
  const metadataPath = join(dirname(entry), "desktop-adaptation.json");

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);
    // Warm the runtime so the scripted provider is registered before Adapt sends.
    await window
      .locator(".sidebar")
      .getByRole("button", { name: "New thread", exact: true })
      .click();
    await window.getByLabel("New thread prompt", { exact: true }).fill("ping");
    await window.getByRole("button", { name: "Start thread", exact: true }).click();
    await expect(
      window
        .locator(".timeline-item--assistant .message__content")
        .filter({ hasText: "unexpected" }),
    ).toBeVisible({ timeout: 30_000 });

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await expect(window.getByTestId("extensions-surface")).toBeVisible({ timeout: 20_000 });
    await window
      .getByTestId("extensions-list")
      .getByRole("button", { name: /pi-custom-header/i })
      .click();
    await expect(window.getByTestId("extension-compatibility")).toBeVisible({ timeout: 20_000 });
    await expect(window.getByTestId("adapt-for-desktop")).toBeEnabled();
    await window.getByTestId("adapt-for-desktop").click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () => {
          const text = (await getSelectedTranscript(window))?.transcript
            .map((message) => JSON.stringify(message))
            .join("\n");
          return text?.includes("Adapted custom-header") ? "done" : "running";
        },
        { timeout: 90_000 },
      )
      .toBe("done");
    await expect
      .poll(async () =>
        access(metadataPath).then(
          () => "written",
          () => "missing",
        ),
      )
      .toBe("written");

    await writeFile(join(dirname(entry), "pi-garden-desktop", "header.js"), customHeaderFrontend());
    await window.getByTestId("composer").fill("/reload ");
    await window.getByTestId("composer").press("Enter");
    await expect(
      window
        .getByTestId("rich-surface-app-header")
        .frameLocator('[data-testid="rich-surface-frame"]')
        .getByTestId("pi-custom-header"),
    ).toHaveText("pi custom header", { timeout: 20_000 });

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await window
      .getByTestId("extensions-list")
      .getByRole("button", { name: /pi-custom-header/i })
      .click();
    const section = window.getByTestId("extension-compatibility");
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.getByTestId("extension-compatibility-summary")).toContainText("adapted", {
      timeout: 20_000,
    });
    await expect(
      section.locator(
        '[data-testid="extension-compatibility-finding"][data-capability="ui.setHeader"]',
      ),
    ).toHaveAttribute("data-status", "adapted", { timeout: 20_000 });

    await mkdir(ARTIFACT_DIR, { recursive: true });
    const transcript = await getSelectedTranscript(window);
    const state = await getDesktopState(window);
    await writeFile(
      join(ARTIFACT_DIR, "conversation.json"),
      `${JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          entry,
          metadataPath,
          workspaceId: workspace.id,
          sessionTitles: state.workspaces
            .find((entry) => entry.id === workspace.id)
            ?.sessions.map((session) => session.title),
          transcript: transcript?.transcript ?? [],
          inventoryStatus: "ui.setHeader=adapted",
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await harness.close();
  }
});

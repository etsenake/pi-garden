import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { STALE_EXTENSION_ACTION_MESSAGE } from "@pi-garden/extension-ui";
import { PiSdkDriver } from "../dist/pi-sdk-driver.js";
import type { PiDesktopExtensionRuntime } from "../dist/desktop-extension-bridge.js";

await test(
  "extension actions, commands, and completions follow the runtime generation",
  { timeout: 20_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pi-extension-actions-"));
    const agentDir = join(root, "agent");
    const firstWorkspace = join(root, "first");
    const secondWorkspace = join(root, "second");
    const logPath = join(root, "actions.log");
    await mkdir(join(agentDir, "extensions"), { recursive: true });
    await mkdir(join(firstWorkspace, ".pi", "extensions"), { recursive: true });
    await mkdir(secondWorkspace, { recursive: true });
    await writeFile(join(agentDir, "auth.json"), "{}");
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ packages: [], cacheWarming: "off" }),
    );
    await writeFile(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "action-test": {
            baseUrl: "http://127.0.0.1:9/never-contact",
            apiKey: "LOCAL_TEST_CANARY",
            api: "openai-completions",
            models: [{ id: "scripted", contextWindow: 8192, maxTokens: 1024 }],
          },
        },
      }),
    );
    const helperPath = fileURLToPath(import.meta.resolve("@pi-garden/extension-ui"));
    await writeFile(
      join(agentDir, "extensions", "garden-global.ts"),
      `
export default function gardenGlobal(pi) {
  pi.registerCommand("garden-global", {
    description: "Global garden command",
    handler: async () => {},
  });
}
`,
    );
    await writeFile(
      join(firstWorkspace, ".pi", "extensions", "garden-interaction.ts"),
      `
import { appendFileSync } from "node:fs";
import { registerAction, registerComposerBefore } from ${JSON.stringify(helperPath)};
const logPath = ${JSON.stringify(logPath)};
export default function gardenInteraction(pi) {
  pi.registerCommand("garden-echo", {
    description: "Echo a garden plot",
    getArgumentCompletions: (prefix) => {
      if (prefix.startsWith("slow")) return new Promise(() => {});
      if (prefix.startsWith("fail")) throw new Error("completion failed");
      return ["plot", "plan", "patch"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value, description: "A garden " + value }));
    },
    handler: async (args, ctx) => {
      appendFileSync(logPath, "command:" + args + "\\n");
      ctx.ui.setStatus("garden-action", "echo " + args);
    },
  });
  pi.registerShortcut("ctrl+shift+y", {
    description: "Project shortcut",
    handler: async () => {
      appendFileSync(logPath, "shortcut\\n");
    },
  });
  registerAction(pi, {
    id: "mark-plot",
    title: "Mark garden plot",
    source: import.meta.url,
    shortcut: "ctrl+shift+m",
    handler: async (ctx) => {
      appendFileSync(logPath, "action\\n");
      ctx.ui.setStatus("garden-action", "marked");
    },
  });
  registerComposerBefore(pi, { id: "mark-plot", text: "Mark plot", actionId: "mark-plot" });
}
`,
    );
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    t.after(() => {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    });
    const network = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("Action test must not use network");
    });
    t.after(() => assert.equal(network.mock.callCount(), 0));

    const changed: PiDesktopExtensionRuntime[] = [];
    const driver = new PiSdkDriver({
      agentDir,
      catalogFilePath: join(root, "catalogs.json"),
      desktopExtensions: {
        onChanged(runtime) {
          changed.push(runtime);
        },
      },
    });
    const model = { initialModel: { provider: "action-test", modelId: "scripted" } };
    const firstSession = (
      await driver.createSession({ workspaceId: "first-workspace", path: firstWorkspace }, model)
    ).ref;
    t.after(() => driver.closeSession(firstSession));
    const firstRuntime = changed.at(-1);
    assert.ok(firstRuntime);
    assert.equal(changed.length, 1);
    const mark = firstRuntime.actions.find((action) => action.id === "mark-plot");
    const echo = firstRuntime.actions.find((action) => action.commandName === "garden-echo");
    const shortcut = firstRuntime.actions.find((action) => action.kind === "shortcut");
    const global = firstRuntime.actions.find((action) => action.commandName === "garden-global");
    assert.equal(mark?.title, "Mark garden plot");
    assert.equal(mark?.shortcut, "ctrl+shift+m");
    assert.equal(echo?.description, "Echo a garden plot");
    assert.equal(echo?.hasArgumentCompletions, true);
    assert.equal(shortcut?.shortcut, "ctrl+shift+y");
    assert.ok(global);
    assert.equal(
      firstRuntime.contributions.find((contribution) => contribution.id === "mark-plot")?.actionId,
      "mark-plot",
    );

    await driver.invokeExtensionAction(firstSession, firstRuntime.generation, "mark-plot");
    await driver.invokeExtensionAction(
      firstSession,
      firstRuntime.generation,
      echo?.id ?? "",
      "plot",
    );
    const completions = await driver.completeExtensionCommandArgument(
      firstSession,
      firstRuntime.generation,
      "garden-echo",
      "pl",
    );
    assert.deepEqual(
      completions.map((item) => item.value),
      ["plot", "plan"],
    );
    const started = Date.now();
    const slow = await driver.completeExtensionCommandArgument(
      firstSession,
      firstRuntime.generation,
      "garden-echo",
      "slow",
    );
    assert.deepEqual(slow, []);
    assert.ok(Date.now() - started < 1_000);
    assert.deepEqual(
      await driver.completeExtensionCommandArgument(
        firstSession,
        firstRuntime.generation,
        "garden-echo",
        "fail",
      ),
      [],
    );

    await driver.reloadSession(firstSession);
    const reloaded = changed.at(-1);
    assert.ok(reloaded);
    assert.notEqual(reloaded.generation, firstRuntime.generation);
    assert.equal(reloaded.actions.filter((action) => action.id === "mark-plot").length, 1);
    await assert.rejects(
      driver.invokeExtensionAction(firstSession, firstRuntime.generation, "mark-plot"),
      new RegExp(STALE_EXTENSION_ACTION_MESSAGE.replaceAll(".", "\\.")),
    );
    await driver.invokeExtensionAction(firstSession, reloaded.generation, "mark-plot");

    const secondSession = (
      await driver.createSession({ workspaceId: "second-workspace", path: secondWorkspace }, model)
    ).ref;
    t.after(() => driver.closeSession(secondSession));
    const secondRuntime = changed.at(-1);
    assert.ok(secondRuntime);
    assert.equal(
      secondRuntime.actions.some((action) => action.id === "mark-plot"),
      false,
    );
    assert.ok(secondRuntime.actions.some((action) => action.commandName === "garden-global"));
    assert.deepEqual(
      await driver.completeExtensionCommandArgument(
        secondSession,
        secondRuntime.generation,
        "garden-echo",
        "pl",
      ),
      [],
    );

    const log = await readFile(logPath, "utf8");
    assert.equal(log, "action\ncommand:plot\naction\n");
  },
);

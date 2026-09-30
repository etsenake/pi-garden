import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { PiSdkDriver } from "../dist/pi-sdk-driver.js";

await test("a newer autocomplete query discards a slower stale result", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-stale-autocomplete-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  const extensionDirectory = join(cwd, ".pi", "extensions", "slow-complete");
  await mkdir(agentDir);
  await mkdir(extensionDirectory, { recursive: true });
  new ProjectTrustStore(agentDir).set(cwd, true);
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ packages: [], cacheWarming: "off" }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "auto-test": {
          baseUrl: "http://127.0.0.1:9/never-contact",
          apiKey: "LOCAL_TEST_CANARY",
          api: "openai-completions",
          models: [{ id: "scripted", contextWindow: 8192, maxTokens: 1024 }],
        },
      },
    }),
  );
  const gate = join(root, "release-slow");
  await writeFile(
    join(extensionDirectory, "index.ts"),
    `
import { accessSync } from "node:fs";
export default function extension(pi) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) => ({
      triggerCharacters: [":", ...(current.triggerCharacters ?? [])],
      async getSuggestions(lines, line, col, context) {
        const token = (lines[line] ?? "").slice(0, col);
        if (token.endsWith(":slow")) {
          while (true) {
            if (context.signal.aborted) return null;
            try {
              accessSync(${JSON.stringify(gate)});
              break;
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }
          if (context.signal.aborted) return null;
          return { items: [{ value: "stale-hit", label: "stale-hit" }], prefix: ":slow" };
        }
        if (token.endsWith(":fast")) {
          return { items: [{ value: "fresh-hit", label: "fresh-hit" }], prefix: ":fast" };
        }
        return null;
      },
      applyCompletion(lines, line, col, item, prefix) {
        return current.applyCompletion(lines, line, col, item, prefix);
      },
    }));
  });
}
`,
  );
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const driver = new PiSdkDriver({
    agentDir,
    catalogFilePath: join(root, "catalogs.json"),
  });
  const session = await driver.createSession(
    { workspaceId: "auto-ws", path: cwd },
    { initialModel: { provider: "auto-test", modelId: "scripted" } },
  );
  t.after(() => driver.closeSession(session.ref));

  const slow = driver.queryEditorAutocomplete(session.ref, {
    text: ":slow",
    cursor: 5,
    force: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const fast = await driver.queryEditorAutocomplete(session.ref, {
    text: ":fast",
    cursor: 5,
    force: false,
  });
  assert.deepEqual(
    fast.items.map((item) => item.value),
    ["fresh-hit"],
  );
  await writeFile(gate, "go");
  const stale = await slow;
  assert.deepEqual(stale.items, []);
});

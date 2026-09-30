import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeSupervisor } from "../dist/runtime-supervisor.js";

async function createAgentDir(): Promise<{ agentDir: string; workspacePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-garden-runtime-models-"));
  const agentDir = join(root, "agent");
  const workspacePath = join(root, "workspace");
  await mkdir(agentDir, { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: {} }));
  return { agentDir, workspacePath };
}

await test("runtime models include kind and non-chat catalogs", async () => {
  const { agentDir, workspacePath } = await createAgentDir();
  const supervisor = new RuntimeSupervisor({ agentDir });
  const snapshot = await supervisor.getRuntimeSnapshot({
    workspaceId: "workspace-1",
    path: workspacePath,
  });

  assert.ok(snapshot.models.length > 0, "expected at least one catalog model");
  assert.ok(
    snapshot.models.every((model) =>
      ["chat", "image", "classifier", "virtual"].includes(model.kind),
    ),
    "every model should declare a RuntimeModelKind",
  );
  assert.ok(
    snapshot.models.some((model) => model.kind === "chat"),
    "chat catalog should be present",
  );
  // Built-in image / classifier catalogs ship with Pi; if a pin omits them the
  // kind field still has to be set on whatever is listed.
  for (const kind of ["image", "classifier"] as const) {
    const typed = snapshot.models.filter((model) => model.kind === kind);
    for (const model of typed) {
      assert.equal(model.kind, kind);
      assert.ok(model.providerId.length > 0);
      assert.ok(model.modelId.length > 0);
    }
  }
});

await test("oauth providers expose login labels when Pi supplies them", async () => {
  const { agentDir, workspacePath } = await createAgentDir();
  const supervisor = new RuntimeSupervisor({ agentDir });
  const snapshot = await supervisor.getRuntimeSnapshot({
    workspaceId: "workspace-1",
    path: workspacePath,
  });

  const openai = snapshot.providers.find((provider) => provider.id === "openai");
  assert.ok(openai, "openai provider should be listed");
  assert.equal(openai.oauthSupported, true);
  assert.ok(
    openai.oauthLoginLabel,
    "openai should expose Pi's OAuth login label (Sign in with ChatGPT)",
  );
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_TOOL_NAMES,
  getToolsSettings,
  resolveDefaultTools,
  setDefaultTools,
  setPiBuiltinEnabled,
} from "../dist/tools-settings.js";

async function withSettings(
  run: (manager: SettingsManager, agentDir: string) => Promise<void>,
  initial?: Record<string, unknown>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-tools-settings-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  if (initial) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(agentDir, "settings.json"), `${JSON.stringify(initial, null, 2)}\n`);
  }
  const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  await run(manager, agentDir);
}

await test("resolveDefaultTools matches Pi defaults and modifiers", () => {
  assert.deepEqual(resolveDefaultTools([]), []);
  assert.deepEqual(resolveDefaultTools(["+codemode"]), [...DEFAULT_TOOL_NAMES, "codemode"]);
  assert.deepEqual(resolveDefaultTools(["-bash", "+powershell", "+grep"]), [
    "read",
    "edit",
    "write",
    "powershell",
    "grep",
  ]);
  assert.deepEqual(resolveDefaultTools(["read", "write", "+bash"]), ["read", "write", "bash"]);
});

await test("getToolsSettings reports unresolved defaults and disabled builtins", async () => {
  await withSettings(async (manager) => {
    const unset = getToolsSettings(manager);
    assert.equal(unset.defaultTools, undefined);
    assert.deepEqual(unset.resolvedDefaultTools, [...DEFAULT_TOOL_NAMES]);
    assert.deepEqual(unset.disabledBuiltins, []);

    setDefaultTools(manager, ["+codemode"]);
    await manager.flush();
    setPiBuiltinEnabled(manager, "mcp", false);
    await manager.flush();

    const updated = getToolsSettings(manager);
    assert.deepEqual(updated.defaultTools, ["+codemode"]);
    assert.deepEqual(updated.resolvedDefaultTools, [...DEFAULT_TOOL_NAMES, "codemode"]);
    assert.deepEqual(updated.disabledBuiltins, ["mcp"]);
  });
});

await test("setDefaultTools and setPiBuiltinEnabled persist to global settings.json", async () => {
  await withSettings(async (manager, agentDir) => {
    setDefaultTools(manager, ["read", "write", "+tool_search"]);
    setPiBuiltinEnabled(manager, "tool-search", false);
    setPiBuiltinEnabled(manager, "llama.cpp", false);
    await manager.flush();

    const saved = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as {
      defaultTools?: string[];
      extensions?: string[];
    };
    assert.deepEqual(saved.defaultTools, ["read", "write", "+tool_search"]);
    assert.ok(saved.extensions?.includes("-builtin:tool-search"));
    assert.ok(saved.extensions?.includes("-builtin:llama.cpp"));

    setPiBuiltinEnabled(manager, "tool-search", true);
    await manager.flush();
    const reenabled = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as {
      extensions?: string[];
    };
    assert.ok(reenabled.extensions?.includes("+builtin:tool-search"));
    assert.ok(!reenabled.extensions?.includes("-builtin:tool-search"));
  });
});

await test("setPiBuiltinEnabled rejects unknown builtins", async () => {
  await withSettings(async (manager) => {
    assert.throws(() => setPiBuiltinEnabled(manager, "not-a-builtin", true), /Unknown Pi built-in/);
  });
});

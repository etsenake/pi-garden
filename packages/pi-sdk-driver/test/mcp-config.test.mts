import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addMcpServer,
  desktopMcpConfigPath,
  loadDesktopMcpConfig,
  removeMcpServer,
  updateMcpServer,
} from "../dist/mcp-config.js";

async function withDirs(
  run: (agentDir: string, cwd: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-config-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await run(agentDir, cwd);
}

await test("loads global and trusted project servers with project overriding global", async () => {
  await withDirs(async (agentDir, cwd) => {
    const globalPath = desktopMcpConfigPath(agentDir, cwd, "global");
    const projectPath = desktopMcpConfigPath(agentDir, cwd, "project");
    await writeFile(
      globalPath,
      JSON.stringify({
        autoEnableCodemode: false,
        mcpServers: {
          shared: { command: "global-cmd" },
          onlyGlobal: { url: "https://global.example/mcp" },
        },
      }),
    );
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      projectPath,
      JSON.stringify({
        autoEnableCodemode: true,
        mcpServers: {
          shared: { command: "project-cmd", args: ["--project"], enabled: false },
        },
      }),
    );

    const trusted = loadDesktopMcpConfig({ agentDir, cwd, projectTrusted: true });
    assert.equal(trusted.autoEnableCodemode, true);
    assert.deepEqual(
      trusted.servers.map((server) => server.name).sort(),
      ["onlyGlobal", "shared"],
    );
    const shared = trusted.servers.find((server) => server.name === "shared");
    assert.equal(shared?.scope, "project");
    assert.equal(shared?.enabled, false);
    assert.equal(shared?.transport, "stdio project-cmd --project");
    assert.equal(shared?.sourcePath, projectPath);

    const untrusted = loadDesktopMcpConfig({ agentDir, cwd, projectTrusted: false });
    assert.equal(untrusted.autoEnableCodemode, false);
    assert.deepEqual(
      untrusted.servers.map((server) => server.name).sort(),
      ["onlyGlobal", "shared"],
    );
    assert.equal(untrusted.servers.find((server) => server.name === "shared")?.scope, "global");
  });
});

await test("add, update, and remove preserve unrelated json and indentation", async () => {
  await withDirs(async (agentDir, cwd) => {
    const path = desktopMcpConfigPath(agentDir, cwd, "global");
    await writeFile(
      path,
      `{
\t"futureSetting": true,
\t"mcpServers": {
\t\t"keep": { "command": "keep-cmd" }
\t}
}
`,
    );

    assert.equal(
      addMcpServer(path, "docs", {
        url: "https://docs.example/mcp",
        headers: { Authorization: "Bearer ${TOKEN}" },
      }),
      false,
    );
    assert.equal(
      addMcpServer(path, "docs", { url: "https://docs.example/mcp/v2" }),
      true,
    );

    updateMcpServer(path, "docs", { enabled: false, exposure: "direct" });
    const afterUpdate = JSON.parse(await readFile(path, "utf8")) as {
      futureSetting: unknown;
      mcpServers: Record<string, Record<string, unknown>>;
    };
    assert.equal(afterUpdate.futureSetting, true);
    assert.deepEqual(afterUpdate.mcpServers.keep, { command: "keep-cmd" });
    assert.equal(afterUpdate.mcpServers.docs.enabled, false);
    assert.equal(afterUpdate.mcpServers.docs.exposure, "direct");
    assert.equal(afterUpdate.mcpServers.docs.url, "https://docs.example/mcp/v2");

    updateMcpServer(path, "docs", { enabled: true, exposure: "codemode" });
    const afterDefault = JSON.parse(await readFile(path, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    assert.equal(afterDefault.mcpServers.docs.enabled, undefined);
    assert.equal(afterDefault.mcpServers.docs.exposure, undefined);

    assert.equal(removeMcpServer(path, "docs"), true);
    assert.equal(removeMcpServer(path, "missing"), false);
    const afterRemove = JSON.parse(await readFile(path, "utf8")) as {
      futureSetting: unknown;
      mcpServers: Record<string, unknown>;
    };
    assert.equal(afterRemove.futureSetting, true);
    assert.deepEqual(Object.keys(afterRemove.mcpServers), ["keep"]);
  });
});

await test("rejects invalid server names and configs", async () => {
  await withDirs(async (agentDir, cwd) => {
    const path = desktopMcpConfigPath(agentDir, cwd, "global");
    assert.throws(() => addMcpServer(path, "bad name", { command: "x" }), /invalid server name/);
    assert.throws(() => addMcpServer(path, "ok", { type: "stdio" } as never), /needs either/);
  });
});

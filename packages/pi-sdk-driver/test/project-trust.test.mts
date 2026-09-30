import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createAgentSessionRuntimeWithNpmFallback } from "../dist/npm-package-fallback.js";
import { PiSdkDriver } from "../dist/pi-sdk-driver.js";
import { RuntimeSupervisor } from "../dist/runtime-supervisor.js";

/**
 * Project-local extensions are executable. Trust is resolved before they load,
 * in both the catalog and a session. No stored decision and no UI means the
 * project stays untrusted and the extension's top-level code does not run.
 */

await test("an untrusted project extension does not run until the project is trusted", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-garden-project-trust-"));
  const agentDir = join(root, "agent");
  const workspacePath = join(root, "workspace");
  const marker = join(root, "project-extension-executed");
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await mkdir(join(workspacePath, ".pi", "extensions"), { recursive: true });
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  await writeFile(
    join(agentDir, "extensions", "user-probe.ts"),
    `export default function userProbe(pi) {
  pi.registerCommand("user-probe", { description: "user", handler: async () => {} });
}
`,
  );
  await writeFile(
    join(workspacePath, ".pi", "extensions", "project-probe.ts"),
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "executed");
export default function projectProbe(pi) {
  pi.registerCommand("project-probe", { description: "project", handler: async () => {} });
}
`,
  );

  const absent = () =>
    access(marker).then(
      () => false,
      () => true,
    );
  const workspace = { workspaceId: "ws", path: workspacePath };
  const supervisor = new RuntimeSupervisor({ agentDir });
  const snapshot = await supervisor.getRuntimeSnapshot(workspace);
  assert.equal(
    snapshot.extensions.some((extension) => extension.path.endsWith("project-probe.ts")),
    false,
  );
  assert.equal(
    snapshot.extensions.some((extension) => extension.path.endsWith("user-probe.ts")),
    true,
  );
  assert.equal(await absent(), true);

  const loaded: string[] = [];
  const driver = new PiSdkDriver({
    agentDir,
    catalogFilePath: join(root, "catalogs.json"),
    createAgentSessionRuntimeImpl: async (options) => {
      const runtime = await createAgentSessionRuntimeWithNpmFallback(options);
      loaded.push(
        ...runtime.services.resourceLoader
          .getExtensions()
          .extensions.map((extension) => extension.path),
      );
      return runtime;
    },
  });
  const session = await driver.createSession(workspace);
  assert.equal(
    loaded.some((extensionPath) => extensionPath.endsWith("project-probe.ts")),
    false,
  );
  assert.equal(
    loaded.some((extensionPath) => extensionPath.endsWith("user-probe.ts")),
    true,
  );
  assert.equal(await absent(), true);
  await driver.closeSession(session.ref);

  new ProjectTrustStore(agentDir).set(workspacePath, true);
  const trusted = await supervisor.refreshRuntime(workspace);
  assert.equal(
    trusted.extensions.some((extension) => extension.path.endsWith("project-probe.ts")),
    true,
  );
  assert.equal(await absent(), false);
});

await test("live trust grant reloads an open session so project commands appear", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-garden-live-trust-"));
  const agentDir = join(root, "agent");
  const workspacePath = join(root, "workspace");
  const marker = join(root, "project-extension-executed");
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await mkdir(join(workspacePath, ".pi", "extensions"), { recursive: true });
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  await writeFile(
    join(workspacePath, ".pi", "extensions", "live-probe.ts"),
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "executed");
export default function liveProbe(pi) {
  pi.registerCommand("live-probe", { description: "project", handler: async () => {} });
}
`,
  );

  const workspace = { workspaceId: "ws-live", path: workspacePath };
  const driver = new PiSdkDriver({ agentDir, catalogFilePath: join(root, "catalogs.json") });
  const session = await driver.createSession(workspace);
  const before = await driver.getSessionCommands(session.ref);
  assert.equal(
    before.some((command) => command.name === "live-probe"),
    false,
  );
  assert.equal(
    await access(marker).then(
      () => true,
      () => false,
    ),
    false,
  );

  await driver.runtimeSupervisor.setProjectTrust(workspace, true);
  await driver.reloadSession(session.ref);
  const after = await driver.getSessionCommands(session.ref);
  assert.equal(
    after.some((command) => command.name === "live-probe"),
    true,
  );
  assert.equal(
    await access(marker).then(
      () => true,
      () => false,
    ),
    true,
  );

  await driver.runtimeSupervisor.setProjectTrust(workspace, false);
  await driver.reloadSession(session.ref);
  const revoked = await driver.getSessionCommands(session.ref);
  assert.equal(
    revoked.some((command) => command.name === "live-probe"),
    false,
  );
  await driver.closeSession(session.ref);
});

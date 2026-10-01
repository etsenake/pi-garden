import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { expect, test } from "@playwright/test";
import { createJiti } from "jiti";
import { writeCompatibilityFixture } from "../helpers/compatibility-fixtures";
import { writeRealPiExtension } from "../helpers/real-pi-extension-fixtures";

/**
 * Evidence-based timings for Adapt scaffolding and ordinary-Pi reload of
 * adapted extensions. Thresholds are loose guards against order-of-magnitude
 * regressions, not CI flakiness targets.
 */
const jiti = createJiti(__filename);
type Pi = typeof import("@earendil-works/pi-coding-agent");
type Applier = typeof import("../../electron/extensions/apply-desktop-adaptation");
let pi: Pi;
let applyDesktopAdaptation: Applier["applyDesktopAdaptation"];

test.beforeAll(async () => {
  pi = await jiti.import<Pi>("@earendil-works/pi-coding-agent");
  ({ applyDesktopAdaptation } = await jiti.import<Applier>(
    "../../electron/extensions/apply-desktop-adaptation.ts",
  ));
});

const directories: string[] = [];
test.afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function scratch() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-adapt-perf-")));
  directories.push(root);
  return root;
}

function helperDir() {
  return path.dirname(path.dirname(require.resolve("@pi-garden/extension-ui")));
}

test("adaptation writer and ordinary-Pi reload stay within evidence thresholds", async () => {
  const root = await scratch();
  const agentDir = path.join(root, "agent");
  const workspacePath = path.join(root, "workspace");
  await mkdir(agentDir, { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(path.join(agentDir, "auth.json"), "{}");
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));

  const extensionsDir = path.join(agentDir, "extensions");
  const entries: string[] = [];
  for (let i = 0; i < 8; i++) {
    entries.push(
      await writeCompatibilityFixture("native-only", path.join(extensionsDir, `native-${i}`)),
    );
  }
  const terminal = await writeCompatibilityFixture("terminal-heavy", extensionsDir);
  entries.push(terminal);
  entries.push(await writeRealPiExtension("todo", extensionsDir));
  entries.push(await writeRealPiExtension("custom-header", extensionsDir));

  const helper = helperDir();
  const adaptStarted = performance.now();
  // Only terminal / real Pi examples need the writer; native-only proves load volume.
  for (const entry of [terminal, entries[entries.length - 2]!, entries[entries.length - 1]!]) {
    const result = await applyDesktopAdaptation(entry, helper);
    expect(result.changed).toBe(true);
  }
  const adaptMs = performance.now() - adaptStarted;

  const reloadStarted = performance.now();
  for (let round = 0; round < 3; round++) {
    const loader = new pi.DefaultResourceLoader({
      cwd: workspacePath,
      agentDir,
      settingsManager: pi.SettingsManager.inMemory(),
      additionalExtensionPaths: entries,
    });
    await loader.reload();
    const { errors } = loader.getExtensions();
    expect(errors).toEqual([]);
  }
  const reloadMs = performance.now() - reloadStarted;

  const disposeStarted = performance.now();
  for (let round = 0; round < 3; round++) {
    const loader = new pi.DefaultResourceLoader({
      cwd: workspacePath,
      agentDir,
      settingsManager: pi.SettingsManager.inMemory(),
      additionalExtensionPaths: entries,
    });
    await loader.reload();
    await loader.reload();
  }
  const disposeMs = performance.now() - disposeStarted;

  // Soft ceilings from local evidence (Apple Silicon / cold jiti). Fail only on
  // multi-second regressions that indicate retained work or unbounded I/O.
  expect(adaptMs, `adapt ${adaptMs.toFixed(0)}ms`).toBeLessThan(15_000);
  expect(reloadMs, `reload ${reloadMs.toFixed(0)}ms`).toBeLessThan(20_000);
  expect(disposeMs, `dispose ${disposeMs.toFixed(0)}ms`).toBeLessThan(25_000);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      extensions: entries.length,
      adaptMs: Math.round(adaptMs),
      reloadMs: Math.round(reloadMs),
      repeatedReloadMs: Math.round(disposeMs),
    }),
  );
});

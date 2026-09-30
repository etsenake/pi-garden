import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createJiti } from "jiti";
import {
  customHeaderFrontend,
  todoToolRendererFrontend,
  writeRealPiExtension,
} from "../helpers/real-pi-extension-fixtures";

/**
 * Prove Adapt for Desktop against real upstream Pi examples (todo tool
 * renderer + custom header), not the empty terminal-heavy fixture. Covers
 * scaffold → semantic fill → ordinary-Pi load → rerun without clobber.
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

async function dirs() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-real-adapt-")));
  directories.push(root);
  const agentDir = path.join(root, "agent");
  const workspacePath = path.join(root, "workspace");
  await mkdir(agentDir, { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(path.join(agentDir, "auth.json"), "{}");
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  return { root, agentDir, workspacePath };
}

function helperDir() {
  return path.dirname(path.dirname(require.resolve("@pi-garden/extension-ui")));
}

test("real Pi todo extension: adapt, semantic tool renderer, ordinary Pi, rerun preserves edits", async () => {
  const { agentDir, workspacePath } = await dirs();
  const entry = await writeRealPiExtension("todo", path.join(agentDir, "extensions"));
  const helper = helperDir();

  const first = await applyDesktopAdaptation(entry, helper);
  expect(first.changed).toBe(true);
  expect(first.pairs.some((pair) => pair.capability === "tool.renderCall")).toBe(true);
  expect(first.pairs.some((pair) => pair.capability === "ui.custom")).toBe(true);

  const toolFrontend = path.join(
    path.dirname(entry),
    "pi-garden-desktop",
    first.pairs.find((pair) => pair.api === "registerDesktopToolRenderer")!.id + ".js",
  );
  const overlayFrontend = path.join(path.dirname(entry), "pi-garden-desktop", "custom.js");
  const semanticTool = todoToolRendererFrontend();
  await writeFile(toolFrontend, semanticTool);
  await writeFile(
    overlayFrontend,
    `export function mount(root, host) {
  root.dataset.testid = "todo-overlay";
  root.textContent = "todos overlay";
  const button = document.createElement("button");
  button.textContent = "close";
  button.onclick = () => host.actions.cancel();
  root.append(button);
  return () => {};
}
`,
  );

  const loader = new pi.DefaultResourceLoader({
    cwd: workspacePath,
    agentDir,
    settingsManager: pi.SettingsManager.inMemory(),
    additionalExtensionPaths: [entry],
  });
  await loader.reload();
  const { extensions, errors } = loader.getExtensions();
  expect(errors.map((error) => `${error.path}: ${error.error}`)).toEqual([]);
  const loaded = extensions.find((extension) => extension.path === entry)!;
  expect([...loaded.commands.keys()]).toEqual(["todos"]);
  expect([...loaded.tools.keys()]).toEqual(["todo"]);

  const second = await applyDesktopAdaptation(entry, helper);
  expect(second.changed).toBe(false);
  expect(await readFile(toolFrontend, "utf8")).toBe(semanticTool);
  expect(await readFile(overlayFrontend, "utf8")).toMatch(/todo-overlay/);
});

test("real Pi custom-header extension: adapt, semantic header, ordinary Pi keeps command", async () => {
  const { agentDir, workspacePath } = await dirs();
  const entry = await writeRealPiExtension("custom-header", path.join(agentDir, "extensions"));
  const helper = helperDir();

  const first = await applyDesktopAdaptation(entry, helper);
  expect(first.changed).toBe(true);
  expect(first.pairs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        capability: "ui.setHeader",
        api: "registerRichSurface",
        id: "header",
        surface: "app-header",
      }),
    ]),
  );

  const headerFrontend = path.join(path.dirname(entry), "pi-garden-desktop", "header.js");
  const semantic = customHeaderFrontend();
  await writeFile(headerFrontend, semantic);

  const loader = new pi.DefaultResourceLoader({
    cwd: workspacePath,
    agentDir,
    settingsManager: pi.SettingsManager.inMemory(),
    additionalExtensionPaths: [entry],
  });
  await loader.reload();
  const { extensions, errors } = loader.getExtensions();
  expect(errors.map((error) => `${error.path}: ${error.error}`)).toEqual([]);
  const loaded = extensions.find((extension) => extension.path === entry)!;
  expect([...loaded.commands.keys()]).toEqual(["builtin-header"]);

  expect(await applyDesktopAdaptation(entry, helper)).toMatchObject({ changed: false });
  expect(await readFile(headerFrontend, "utf8")).toBe(semantic);
});

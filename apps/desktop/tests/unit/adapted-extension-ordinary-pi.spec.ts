import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createJiti } from "jiti";
import { writeCompatibilityFixture } from "../helpers/compatibility-fixtures";

/**
 * An adapted extension must still load under ordinary Pi 0.87.1 with no desktop
 * host: the vendored `@pi-garden/extension-ui` resolves from the extension's own
 * node_modules, its registrations stay inert, and the terminal commands survive.
 * This also proves the bundled Adapt skill is discoverable through Pi's ordinary
 * skill loader, which is how pi-garden ships it.
 */
const jiti = createJiti(__filename);
type Pi = typeof import("@earendil-works/pi-coding-agent");
let pi: Pi;
test.beforeAll(async () => {
  pi = await jiti.import<Pi>("@earendil-works/pi-coding-agent");
});

const SKILLS_DIR = path.resolve(__dirname, "../../resources/skills");
const directories: string[] = [];
test.afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function dirs() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-ordinary-")));
  directories.push(root);
  const agentDir = path.join(root, "agent");
  const workspacePath = path.join(root, "workspace");
  await mkdir(agentDir, { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(path.join(agentDir, "auth.json"), "{}");
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
  return { root, agentDir, workspacePath };
}

test("an adapted extension loads under ordinary Pi with the vendored helper and keeps its terminal commands", async () => {
  const { agentDir, workspacePath } = await dirs();
  const entry = await writeCompatibilityFixture("garden-aware", path.join(workspacePath, "ext"));
  const loader = new pi.DefaultResourceLoader({
    cwd: workspacePath,
    agentDir,
    settingsManager: pi.SettingsManager.inMemory(),
    additionalExtensionPaths: [entry],
  });
  await loader.reload();
  const { extensions, errors } = loader.getExtensions();
  expect(errors.map((error) => `${error.path}: ${error.error}`)).toEqual([]);
  const loaded = extensions.find((extension) => extension.path === entry);
  expect(loaded).toBeDefined();
  expect([...loaded!.commands.keys()]).toEqual(["fixture-garden-aware-tick"]);
  // No desktop host: pi-garden's bridge events had no listener, and nothing else registered.
  expect([...loaded!.tools.keys()]).toEqual([]);

  // The vendored copy is what resolved the bare import: without it, ordinary Pi cannot load.
  await rm(path.join(path.dirname(entry), "node_modules"), { recursive: true, force: true });
  await loader.reload();
  const broken = loader.getExtensions();
  expect(broken.errors.map((error) => error.path)).toEqual([entry]);
  expect(String(broken.errors[0]!.error)).toMatch(/@pi-garden\/extension-ui/);
});

test("the Adapt writer output loads under ordinary Pi and a second run does not duplicate it", async () => {
  const { agentDir, workspacePath } = await dirs();
  const entry = await writeCompatibilityFixture("terminal-heavy", path.join(workspacePath, "ext"));
  const helper = path.dirname(path.dirname(require.resolve("@pi-garden/extension-ui")));
  const { applyDesktopAdaptation } = await jiti.import<
    typeof import("../../electron/extensions/apply-desktop-adaptation")
  >("../../electron/extensions/apply-desktop-adaptation.ts");
  const first = await applyDesktopAdaptation(entry, helper);
  expect(first.changed).toBe(true);

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
  expect([...loaded.commands.keys()]).toEqual(["fixture-terminal-heavy-pick"]);
  expect([...loaded.tools.keys()]).toEqual(["fixture-terminal-heavy_tool"]);

  const second = await applyDesktopAdaptation(entry, helper);
  expect(second.changed).toBe(false);
  const entrySource = await readFile(entry, "utf8");
  const desktop = await readFile(path.join(path.dirname(entry), "pi-garden-desktop.ts"), "utf8");
  expect(entrySource.match(/registerDesktopAdaptations\(/g)).toHaveLength(1);
  expect(desktop.match(/registerRichSurface\(/g)).toHaveLength(4);
  expect(desktop.match(/registerDesktopToolRenderer\(/g)).toHaveLength(1);

  await rm(path.join(path.dirname(entry), "node_modules"), { recursive: true, force: true });
  await loader.reload();
  const broken = loader.getExtensions();
  expect(broken.errors.map((error) => error.path)).toEqual([entry]);
  expect(String(broken.errors[0]!.error)).toMatch(/@pi-garden\/extension-ui/);
});

test("the terminal-heavy fixture loads under ordinary Pi unchanged", async () => {
  const { agentDir, workspacePath } = await dirs();
  const entry = await writeCompatibilityFixture("terminal-heavy", path.join(workspacePath, "ext"));
  const loader = new pi.DefaultResourceLoader({
    cwd: workspacePath,
    agentDir,
    settingsManager: pi.SettingsManager.inMemory(),
    additionalExtensionPaths: [entry],
  });
  await loader.reload();
  const { extensions, errors } = loader.getExtensions();
  expect(errors).toEqual([]);
  const loaded = extensions.find((extension) => extension.path === entry)!;
  expect([...loaded.commands.keys()]).toEqual(["fixture-terminal-heavy-pick"]);
  expect([...loaded.tools.keys()]).toEqual(["fixture-terminal-heavy_tool"]);
});

test("the bundled adapt-for-desktop skill is discovered by Pi's skill loader", async () => {
  const { agentDir, workspacePath } = await dirs();
  const loader = new pi.DefaultResourceLoader({
    cwd: workspacePath,
    agentDir,
    settingsManager: pi.SettingsManager.inMemory(),
    additionalSkillPaths: [SKILLS_DIR],
  });
  await loader.reload();
  const { skills, diagnostics } = loader.getSkills();
  expect(diagnostics.filter((entry) => entry.type === "error")).toEqual([]);
  const skill = skills.find((entry) => entry.name === "adapt-for-desktop");
  expect(skill).toBeDefined();
  expect(skill!.filePath).toBe(path.join(SKILLS_DIR, "adapt-for-desktop", "SKILL.md"));
  expect(skill!.description).toMatch(/pi-garden desktop/);
  expect(skill!.disableModelInvocation).toBe(false);
});

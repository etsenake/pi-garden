import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createSessionViaIpc,
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
  waitForSessionByTitle,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import {
  COMPATIBILITY_FIXTURE_NAMES,
  writeCompatibilityFixture,
} from "../helpers/compatibility-fixtures";

const nodeRequire = createRequire(__filename);
const execFileAsync = promisify(execFile);
const repoRoot = join(__dirname, "../../../..");
const applyScript = join(repoRoot, "apps/desktop/resources/skills/adapt-for-desktop/apply.ts");
const helperPackageDir = dirname(dirname(nodeRequire.resolve("@pi-garden/extension-ui")));

async function runApplier(entry: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "pnpm",
    ["exec", "jiti", applyScript, entry, helperPackageDir],
    { cwd: repoRoot },
  );
  return stdout.trim();
}

async function fileHash(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

/**
 * Phase 9 on the real Electron surface: the Extensions detail page inventories
 * one extension's host-UI usage from source and from live runtime evidence,
 * gates "Adapt for Desktop" by scope and trust, and the action starts an
 * ordinary Pi thread that invokes the canonical skill with the exact target.
 */

async function trustProject(agentDir: string, workspacePath: string): Promise<void> {
  await writeFile(
    join(agentDir, "trust.json"),
    `${JSON.stringify({ [await realpath(workspacePath)]: true }, null, 2)}\n`,
  );
}

async function installPackageFixture(agentDir: string, packagePath: string): Promise<string> {
  const extensionDir = join(packagePath, "extension");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    join(packagePath, "package.json"),
    `${JSON.stringify(
      { name: "fixture-package", type: "module", pi: { extensions: ["./extension/index.ts"] } },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(extensionDir, "index.ts"),
    `export default function fixture(pi) {
  pi.on("session_start", (_e, ctx) => { ctx.ui.setFooter(() => ({ render: () => [] })); });
  pi.registerCommand("fixture-package", { description: "package fixture", handler: async () => {} });
}
`,
  );
  const settingsPath = join(agentDir, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
  settings.packages = [packagePath];
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return join(extensionDir, "index.ts");
}

async function openExtensionDetail(window: Page, name: RegExp): Promise<Locator> {
  const surface = window.getByTestId("extensions-surface");
  if (!(await surface.isVisible())) {
    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await expect(surface).toBeVisible();
  }
  const back = window.getByRole("button", { name: "All extensions" });
  if (await back.isVisible()) await back.click();
  await window.getByTestId("extensions-list").getByRole("button", { name }).click();
  const section = window.getByTestId("extension-compatibility");
  await expect(section).toBeVisible();
  return section;
}

function finding(section: Locator, capability: string): Locator {
  return section.locator(
    `[data-testid="extension-compatibility-finding"][data-capability="${capability}"]`,
  );
}

test("inventories source and runtime evidence per extension and gates Adapt for Desktop", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const workspacePath = await makeWorkspace("extension-compatibility-workspace");
  const projectExtensions = join(workspacePath, ".pi", "extensions");
  const userExtensions = join(agentDir, "extensions");

  // B (project, trusted), F (project), A + C (user), D (package).
  const terminalHeavy = await writeCompatibilityFixture("terminal-heavy", projectExtensions);
  await writeCompatibilityFixture("transcript-only", projectExtensions);
  await writeCompatibilityFixture("native-only", userExtensions);
  const gardenAware = await writeCompatibilityFixture("garden-aware", userExtensions);
  await installPackageFixture(agentDir, await makeWorkspace("fixture-package"));
  await trustProject(agentDir, workspacePath);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Compatibility session");
    await selectSession(window, "Compatibility session");
    const session = await waitForSessionByTitle(window, workspace.id, "Compatibility session");
    const sessionKey = `${workspace.id}:${session.id}`;
    // All fixtures loaded and session_start has run (fixture B arms its terminal UI there).
    await expect
      .poll(
        async () =>
          (await getDesktopState(window)).sessionCommandsBySession[sessionKey]
            ?.map((command) => command.name)
            .filter((name) => name.startsWith("fixture-"))
            .sort() ?? [],
        { timeout: 20_000 },
      )
      .toEqual([
        "fixture-garden-aware-tick",
        "fixture-native-only",
        "fixture-package",
        "fixture-terminal-heavy-pick",
        "fixture-transcript-only",
      ]);

    // Fixture B: every adaptable family from source; live call-site evidence for the session_start calls.
    let section = await openExtensionDetail(window, /fixture-terminal-heavy/i);
    await expect(section.getByTestId("extension-compatibility-summary")).toContainText(
      "8 adaptable",
    );
    await expect(section.getByTestId("extension-compatibility-summary")).toContainText(
      "source inspected (1 file)",
    );
    for (const capability of [
      "ui.onTerminalInput",
      "ui.widget.component",
      "ui.setHeader",
      "ui.setFooter",
      "ui.setEditorComponent",
      "ui.custom",
      "tool.renderCall",
      "tool.renderResult",
    ]) {
      await expect(finding(section, capability)).toHaveAttribute("data-status", "adaptable");
      await expect(finding(section, capability).locator('[data-evidence="source"]')).toHaveCount(1);
    }
    await expect(finding(section, "ui.status")).toHaveAttribute("data-status", "supported");
    // Runtime evidence is generation-bound and arrives from the live session.
    await expect(finding(section, "ui.setHeader").locator('[data-evidence="runtime"]')).toHaveCount(
      1,
      {
        timeout: 20_000,
      },
    );
    await expect(finding(section, "ui.setFooter").locator('[data-evidence="runtime"]')).toHaveCount(
      1,
    );
    await expect(
      finding(section, "ui.onTerminalInput").locator('[data-evidence="runtime"]'),
    ).toHaveCount(1);
    // custom() only runs from its command; nothing has been observed for it yet.
    await expect(finding(section, "ui.custom").locator('[data-evidence="runtime"]')).toHaveCount(0);
    await expect(section.getByTestId("extension-compatibility-summary")).toContainText(
      "runtime evidence from 1 live generation",
    );
    // Trusted project-local extension: Adapt is available.
    await expect(section.getByTestId("adapt-for-desktop")).toBeEnabled();
    await expect(section.getByTestId("adapt-for-desktop-unavailable")).toHaveCount(0);
    // The existing command compatibility section is untouched.
    await expect(window.locator(".skill-detail")).toContainText("fixture-terminal-heavy-pick");

    // Fixture F: transcript customization is unsupported and blocks Adapt (nothing adaptable).
    section = await openExtensionDetail(window, /fixture-transcript-only/i);
    for (const capability of [
      "pi.registerMessageRenderer",
      "pi.registerMarkdownTransformer",
      "pi.registerEntryRenderer",
      "pi.registerFlag",
    ]) {
      await expect(finding(section, capability)).toHaveAttribute("data-status", "unsupported");
    }
    await expect(section.getByTestId("adapt-for-desktop")).toBeDisabled();
    await expect(section.getByTestId("adapt-for-desktop-unavailable")).toHaveAttribute(
      "data-reason",
      "nothing-to-adapt",
    );

    // Fixture A: native-only user extension is already desktop-ready.
    section = await openExtensionDetail(window, /fixture-native-only/i);
    await expect(section.locator('[data-status]:not([data-status="supported"])')).toHaveCount(0);
    await expect(section.getByTestId("adapt-for-desktop-unavailable")).toHaveAttribute(
      "data-reason",
      "nothing-to-adapt",
    );

    // Fixture C: pi-garden registrations recognized from source and confirmed by the live runtime.
    section = await openExtensionDetail(window, /fixture-garden-aware/i);
    await expect(finding(section, "garden.registerRichSurface")).toHaveAttribute(
      "data-status",
      "desktop-native",
    );
    await expect(
      finding(section, "garden.registerRichSurface").locator('[data-evidence="runtime"]'),
    ).toHaveCount(1, { timeout: 20_000 });
    await expect(finding(section, "garden.registerAction")).toHaveAttribute(
      "data-status",
      "desktop-native",
    );
    await expect(
      finding(section, "garden.registerAction").locator('[data-evidence="runtime"]'),
    ).toHaveCount(1);
    await expect(finding(section, "ui.widget.component")).toHaveAttribute(
      "data-status",
      "adaptable",
    );
    await expect(section.getByTestId("adapt-for-desktop")).toBeEnabled();
    // The adapted surface itself is mounted for the session, served from the extension directory.
    await window.getByRole("button", { name: "Back to app" }).click();
    await selectSession(window, "Compatibility session");
    await expect(
      window.frameLocator('[data-testid="rich-surface-frame"]').getByTestId("garden-aware-ticks"),
    ).toHaveText("ticks 0", { timeout: 20_000 });

    // Fixture D: package-installed extension is inventoried but never mutated.
    section = await openExtensionDetail(window, /fixture-package/i);
    await expect(finding(section, "ui.setFooter")).toHaveAttribute("data-status", "adaptable");
    await expect(section.getByTestId("adapt-for-desktop")).toBeDisabled();
    await expect(section.getByTestId("adapt-for-desktop-unavailable")).toHaveAttribute(
      "data-reason",
      "package",
    );

    // Adapt for Desktop on fixture B starts one ordinary local thread with the skill invocation.
    section = await openExtensionDetail(window, /fixture-terminal-heavy/i);
    const sessionsBefore =
      (await getDesktopState(window)).workspaces.find((entry) => entry.id === workspace.id)
        ?.sessions.length ?? 0;
    await section.getByTestId("adapt-for-desktop").click();
    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () =>
          (await getDesktopState(window)).workspaces.find((entry) => entry.id === workspace.id)
            ?.sessions.length ?? 0,
      )
      .toBe(sessionsBefore + 1);
    await expect
      .poll(
        async () => {
          const transcript = await getSelectedTranscript(window);
          return (transcript?.transcript ?? [])
            .map((message) => JSON.stringify(message))
            .join("\n");
        },
        { timeout: 20_000 },
      )
      .toContain(`Target extension entry: ${terminalHeavy}`);
    const transcriptText = (await getSelectedTranscript(window))!.transcript
      .map((message) => JSON.stringify(message))
      .join("\n");
    expect(transcriptText).toContain("adapt-for-desktop");
    expect(transcriptText).toContain("ui.setHeader");
    expect(transcriptText).not.toContain(gardenAware);
    // The other Phase 9 fixture names are not leaked into this target's prompt.
    expect(transcriptText).not.toContain(COMPATIBILITY_FIXTURE_NAMES["transcript-only"]);
  } finally {
    await harness.close();
  }
});

test("Adapt for Desktop writes a paired adaptation Pi Garden loads, and a second run does not duplicate it", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const workspacePath = await makeWorkspace("extension-compatibility-adapted");
  const entry = await writeCompatibilityFixture("terminal-heavy", join(agentDir, "extensions"));
  expect(await runApplier(entry)).toBe("adapted");
  const desktopFile = join(dirname(entry), "pi-garden-desktop.ts");
  const metadataFile = join(dirname(entry), "desktop-adaptation.json");
  const before = {
    entry: await fileHash(entry),
    desktop: await fileHash(desktopFile),
    metadata: await fileHash(metadataFile),
  };

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);
    await createSessionViaIpc(window, workspacePath, "Adapted session");
    await selectSession(window, "Adapted session");
    const session = await waitForSessionByTitle(window, workspace.id, "Adapted session");
    const sessionKey = `${workspace.id}:${session.id}`;
    await expect
      .poll(
        async () =>
          (await getDesktopState(window)).sessionCommandsBySession[sessionKey]?.map(
            (command) => command.name,
          ) ?? [],
        { timeout: 20_000 },
      )
      .toContain("fixture-terminal-heavy-pick");
    await expect(
      window
        .getByTestId("rich-surface-composer-before")
        .frameLocator('[data-testid="rich-surface-frame"]')
        .locator('[data-capability="ui.widget.component"]'),
    ).toHaveText("adapted ui.widget.component", { timeout: 20_000 });

    const section = await openExtensionDetail(window, /fixture-terminal-heavy/i);
    await expect(finding(section, "ui.setHeader")).toHaveAttribute("data-status", "adapted");
    await expect(finding(section, "ui.setHeader")).toHaveAttribute(
      "data-adapted-by",
      "registerRichSurface:header",
    );
    await expect(finding(section, "ui.onTerminalInput")).toHaveAttribute(
      "data-adapted-by",
      "registerAction:terminal-input",
    );
    await expect(finding(section, "tool.renderCall")).toHaveAttribute(
      "data-adapted-by",
      "registerDesktopToolRenderer:tool-fixture-terminal-heavy_tool",
    );
    await expect(section.getByTestId("adapt-for-desktop")).toBeDisabled();
    await expect(section.getByTestId("adapt-for-desktop-unavailable")).toHaveAttribute(
      "data-reason",
      "nothing-to-adapt",
    );
  } finally {
    await harness.close();
  }

  expect(await runApplier(entry)).toBe("unchanged");
  expect(await fileHash(entry)).toBe(before.entry);
  expect(await fileHash(desktopFile)).toBe(before.desktop);
  expect(await fileHash(metadataFile)).toBe(before.metadata);
  const desktop = await readFile(desktopFile, "utf8");
  expect(desktop.match(/registerRichSurface\(/g)).toHaveLength(4);
  expect((await readFile(entry, "utf8")).match(/registerDesktopAdaptations\(/g)).toHaveLength(1);
});

test("an untrusted project does not execute project-local extensions", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const workspacePath = await makeWorkspace("extension-compatibility-untrusted");
  const marker = join(workspacePath, "project-extension-executed");
  await mkdir(join(workspacePath, ".pi", "extensions"), { recursive: true });
  await writeFile(
    join(workspacePath, ".pi", "extensions", "probe.ts"),
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "executed");
export default function probe(pi) {
  pi.registerCommand("untrusted-probe", { description: "must not load", handler: async () => {} });
}
`,
  );
  await writeCompatibilityFixture("native-only", join(agentDir, "extensions"));

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
    trustInitialWorkspaces: false,
  });
  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);
    const list = window.getByTestId("extensions-list");
    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await expect(list.getByRole("button", { name: /fixture-native-only/i })).toBeVisible();
    await expect(list.getByRole("button", { name: /^probe$/i })).toHaveCount(0);
    await expect
      .poll(async () =>
        access(marker).then(
          () => "ran",
          () => "absent",
        ),
      )
      .toBe("absent");

    await createSessionViaIpc(window, workspacePath, "Untrusted session");
    await selectSession(window, "Untrusted session");
    const session = await waitForSessionByTitle(window, workspace.id, "Untrusted session");
    const sessionKey = `${workspace.id}:${session.id}`;
    await expect
      .poll(
        async () =>
          (await getDesktopState(window)).sessionCommandsBySession[sessionKey]?.map(
            (command) => command.name,
          ) ?? [],
        { timeout: 20_000 },
      )
      .toContain("fixture-native-only");
    const names =
      (await getDesktopState(window)).sessionCommandsBySession[sessionKey]?.map(
        (command) => command.name,
      ) ?? [];
    expect(names).not.toContain("untrusted-probe");
    await expect
      .poll(async () =>
        access(marker).then(
          () => "ran",
          () => "absent",
        ),
      )
      .toBe("absent");
  } finally {
    await harness.close();
  }
});

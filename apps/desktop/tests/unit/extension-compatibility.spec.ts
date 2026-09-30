import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RuntimeExtensionRecord } from "@pi-garden/session-driver/runtime-types";
import { expect, test } from "@playwright/test";
import { createJiti } from "jiti";
import type { ExtensionCompatibilityInventory } from "../../contracts/extension-compatibility";
import {
  COMPATIBILITY_FIXTURE_NAMES,
  writeCompatibilityFixture,
  type CompatibilityFixtureKind,
} from "../helpers/compatibility-fixtures";

const jiti = createJiti(__filename);
type Analyzer = typeof import("../../electron/extensions/extension-compatibility-analyzer");
type OwnerModule = typeof import("../../electron/extensions/extension-compatibility-owner");
type AdaptationModule = typeof import("../../electron/extensions/extension-adaptation");
type Applier = typeof import("../../electron/extensions/apply-desktop-adaptation");
let analyzeExtensionSource: Analyzer["analyzeExtensionSource"];
let ExtensionCompatibilityOwner: OwnerModule["ExtensionCompatibilityOwner"];
let ExtensionCompatibilityService: AdaptationModule["ExtensionCompatibilityService"];
let buildAdaptForDesktopPrompt: AdaptationModule["buildAdaptForDesktopPrompt"];
let applyDesktopAdaptation: Applier["applyDesktopAdaptation"];

test.beforeAll(async () => {
  ({ analyzeExtensionSource } = await jiti.import<Analyzer>(
    "../../electron/extensions/extension-compatibility-analyzer.ts",
  ));
  ({ ExtensionCompatibilityOwner } = await jiti.import<OwnerModule>(
    "../../electron/extensions/extension-compatibility-owner.ts",
  ));
  ({ ExtensionCompatibilityService, buildAdaptForDesktopPrompt } =
    await jiti.import<AdaptationModule>("../../electron/extensions/extension-adaptation.ts"));
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

async function scratch(): Promise<string> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-compat-")));
  directories.push(directory);
  return directory;
}

async function fixture(kind: CompatibilityFixtureKind, singleFile = false) {
  const root = await scratch();
  const entry = await writeCompatibilityFixture(kind, root, { singleFile });
  return { root, entry };
}

function record(
  entry: string,
  overrides: Partial<RuntimeExtensionRecord["sourceInfo"]> = {},
): RuntimeExtensionRecord {
  return {
    path: entry,
    displayName: path.basename(path.dirname(entry)),
    enabled: true,
    sourceInfo: {
      path: entry,
      source: "local",
      scope: "user",
      origin: "top-level",
      ...overrides,
    },
    commands: [],
    tools: [],
    flags: [],
    shortcuts: [],
    diagnostics: [],
  };
}

function statuses(inventory: ExtensionCompatibilityInventory) {
  return Object.fromEntries(
    inventory.findings.map((finding) => [finding.capability, finding.status]),
  );
}

test.describe("source analyzer", () => {
  test("fixture A is native-only: every finding is directly supported", async () => {
    const { entry } = await fixture("native-only");
    const { inspection, evidence } = await analyzeExtensionSource(entry);
    expect(inspection.status).toBe("complete");
    expect(inspection.files).toEqual([entry]);
    const capabilities = [...evidence.keys()].sort();
    expect(capabilities).toEqual([
      "pi.registerCommand",
      "pi.registerShortcut",
      "ui.dialogs",
      "ui.editorText",
      "ui.notify",
      "ui.status",
      "ui.widget.text",
    ]);
    for (const items of evidence.values()) {
      for (const item of items) expect(item.partial).toBeFalsy();
    }
  });

  test("fixture B reports one of every adaptable family with exact positions", async () => {
    const { entry } = await fixture("terminal-heavy");
    const { evidence } = await analyzeExtensionSource(entry);
    const adaptable = [
      "ui.onTerminalInput",
      "ui.widget.component",
      "ui.setHeader",
      "ui.setFooter",
      "ui.setEditorComponent",
      "ui.custom",
      "tool.renderCall",
      "tool.renderResult",
    ];
    for (const capability of adaptable) {
      const items = evidence.get(capability as never);
      expect(items, capability).toBeDefined();
      expect(items?.[0]?.kind).toBe("source");
      expect(items?.[0]?.file).toBe(entry);
      expect(items?.[0]?.line).toBeGreaterThan(0);
      expect(items?.[0]?.partial).toBeFalsy();
    }
    const source = await import("node:fs/promises").then((fs) => fs.readFile(entry, "utf8"));
    const header = evidence.get("ui.setHeader")![0]!;
    expect(source.split("\n")[header.line - 1]).toContain("setHeader");
    expect(evidence.get("tool.renderCall")?.[0]?.toolName).toBe("fixture-terminal-heavy_tool");
    expect(evidence.get("tool.renderResult")?.[0]?.toolName).toBe("fixture-terminal-heavy_tool");
  });

  test("fixture C recognizes garden registrations from the vendored bare import", async () => {
    const { entry } = await fixture("garden-aware");
    const { inspection, evidence } = await analyzeExtensionSource(entry);
    expect(inspection.status).toBe("complete");
    // node_modules is never walked.
    expect(inspection.files.some((file) => file.includes("node_modules"))).toBe(false);
    expect(evidence.get("garden.registerRichSurface")?.[0]?.registration).toEqual({
      api: "registerRichSurface",
      id: "status",
      surface: "composer-before",
    });
    expect(evidence.get("garden.registerAction")?.[0]?.registration).toMatchObject({
      api: "registerAction",
      id: "fixture-garden-aware.tick",
    });
    expect(evidence.has("ui.widget.component")).toBe(true);
  });

  test("fixture F is transcript-only", async () => {
    const { entry } = await fixture("transcript-only");
    const { evidence } = await analyzeExtensionSource(entry);
    expect([...evidence.keys()].sort()).toEqual([
      "pi.registerCommand",
      "pi.registerEntryRenderer",
      "pi.registerFlag",
      "pi.registerMarkdownTransformer",
      "pi.registerMessageRenderer",
      "ui.notify",
    ]);
  });

  test("follows relative imports within limits and skips oversize files", async () => {
    const root = await scratch();
    await mkdir(path.join(root, "lib"));
    await writeFile(
      path.join(root, "index.ts"),
      `import { arm } from "./lib/arm.js";\nimport "./lib/huge";\nexport default (pi) => { pi.on("session_start", (_e, ctx) => arm(ctx)); };\n`,
    );
    await writeFile(
      path.join(root, "lib", "arm.ts"),
      `export function arm(ctx) { ctx.ui.setFooter(() => ({ render: () => [] })); }\n`,
    );
    await writeFile(path.join(root, "lib", "huge.ts"), "x".repeat(600 * 1024));
    const { inspection, evidence } = await analyzeExtensionSource(path.join(root, "index.ts"));
    expect(inspection.status).toBe("partial");
    expect(inspection.files).toContain(path.join(root, "lib", "arm.ts"));
    expect(inspection.skipped.map((entry) => path.basename(entry.file))).toContain("huge.ts");
    expect(evidence.get("ui.setFooter")?.[0]?.file).toBe(path.join(root, "lib", "arm.ts"));
  });

  test("an unparsable file yields a partial inspection, not a crash", async () => {
    const root = await scratch();
    await writeFile(path.join(root, "index.ts"), "export default (pi) => { ctx.ui.setHeader(\n");
    const { inspection } = await analyzeExtensionSource(path.join(root, "index.ts"));
    expect(inspection.status).toBe("partial");
    expect(inspection.skipped[0]?.reason).toMatch(/parse/i);
  });

  test("a ui-shaped call on an unknown receiver is reported as uncertain", async () => {
    const root = await scratch();
    await writeFile(
      path.join(root, "index.ts"),
      "export default (pi) => { const host = make(); host.setEditorComponent(() => null); };\n",
    );
    const { evidence } = await analyzeExtensionSource(path.join(root, "index.ts"));
    expect(evidence.get("ui.setEditorComponent")?.[0]?.partial).toBe(true);
  });
});

test.describe("compatibility owner", () => {
  const workspace = { workspaceId: "ws", path: "/tmp/does-not-matter" };
  const target = { workspaceId: "ws", sessionId: "s1" };

  function owner(trusted = true) {
    return new ExtensionCompatibilityOwner({ isProjectTrusted: async () => trusted });
  }

  test("fixture A: supported findings only, nothing to adapt", async () => {
    const { entry } = await fixture("native-only");
    const inventory = await owner().inventory({ workspace, extension: record(entry) });
    expect(new Set(inventory.findings.map((finding) => finding.status))).toEqual(
      new Set(["supported"]),
    );
    expect(inventory.adaptation).toMatchObject({ available: false, reason: "nothing-to-adapt" });
  });

  test("a rich surface does not adapt a terminal finding unless metadata names that registration", async () => {
    const { entry } = await fixture("garden-aware");
    const compat = owner();
    const extension = record(entry);
    const before = await compat.inventory({ workspace, extension });
    expect(statuses(before)["ui.widget.component"]).toBe("adaptable");
    await writeFile(
      path.join(path.dirname(entry), "desktop-adaptation.json"),
      `${JSON.stringify(
        {
          version: 1,
          pairs: [
            {
              capability: "ui.widget.component",
              api: "registerRichSurface",
              id: "header",
              surface: "app-header",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const missed = await compat.inventory({ workspace, extension });
    expect(statuses(missed)["ui.widget.component"]).toBe("adaptable");
    expect(missed.adaptation).toMatchObject({ available: true });
  });

  test("the writer pairs terminal capabilities with the registrations it generates", async () => {
    const { entry } = await fixture("terminal-heavy");
    const helper = path.dirname(path.dirname(require.resolve("@pi-garden/extension-ui")));
    const first = await applyDesktopAdaptation(entry, helper);
    expect(first.changed).toBe(true);
    const inventory = await owner().inventory({ workspace, extension: record(entry) });
    expect(statuses(inventory)).toMatchObject({
      "ui.onTerminalInput": "adapted",
      "ui.widget.component": "adapted",
      "ui.setHeader": "adapted",
      "ui.setFooter": "adapted",
      "ui.custom": "adapted",
      "ui.setEditorComponent": "adapted",
      "tool.renderCall": "adapted",
      "tool.renderResult": "adapted",
      "ui.status": "supported",
    });
    expect(
      inventory.findings.find((finding) => finding.capability === "ui.setHeader")?.adaptedBy,
    ).toMatchObject({
      api: "registerRichSurface",
      id: "header",
      surface: "app-header",
    });
    expect(
      inventory.findings.find((finding) => finding.capability === "tool.renderCall")?.adaptedBy,
    ).toMatchObject({
      api: "registerDesktopToolRenderer",
      id: "tool-fixture-terminal-heavy_tool",
      toolName: "fixture-terminal-heavy_tool",
    });
    expect(inventory.adaptation).toMatchObject({ available: false, reason: "nothing-to-adapt" });
    const second = await applyDesktopAdaptation(entry, helper);
    expect(second.changed).toBe(false);
    const desktop = await readFile(path.join(path.dirname(entry), "pi-garden-desktop.ts"), "utf8");
    expect(desktop.match(/registerRichSurface\(/g)).toHaveLength(4);
    expect(desktop.match(/registerDesktopToolRenderer\(/g)).toHaveLength(1);
    expect(desktop.match(/export function registerDesktopAdaptations/g)).toHaveLength(1);
    expect((await readFile(entry, "utf8")).match(/registerDesktopAdaptations\(/g)).toHaveLength(1);
  });

  test("a rerun preserves skill edits and only appends unpaired capabilities", async () => {
    const { entry, root } = await fixture("terminal-heavy");
    const helper = path.dirname(path.dirname(require.resolve("@pi-garden/extension-ui")));
    await applyDesktopAdaptation(entry, helper);
    const widgetPath = path.join(path.dirname(entry), "pi-garden-desktop", "widget.js");
    const desktopPath = path.join(path.dirname(entry), "pi-garden-desktop.ts");
    const semantic = `export function mount(root, host) {
  root.dataset.testid = "semantic-widget";
  root.textContent = "live ticks";
  return () => {};
}
`;
    await writeFile(widgetPath, semantic);
    const editedDesktop = `${await readFile(desktopPath, "utf8")}\n// skill-owned chord wiring\n`;
    await writeFile(desktopPath, editedDesktop);

    const unchanged = await applyDesktopAdaptation(entry, helper);
    expect(unchanged.changed).toBe(false);
    expect(await readFile(widgetPath, "utf8")).toBe(semantic);
    expect(await readFile(desktopPath, "utf8")).toBe(editedDesktop);

    // Add a second real capability file the writer has not paired yet.
    const headerOnly = path.join(root, "header-only", "index.ts");
    await mkdir(path.dirname(headerOnly), { recursive: true });
    await writeFile(
      headerOnly,
      `export default function fixture(pi) {
  pi.on("session_start", (_e, ctx) => {
    ctx.ui.setHeader(() => ({ render: () => ["h"], invalidate: () => {} }));
  });
}
`,
    );
    await applyDesktopAdaptation(headerOnly, helper);
    const headerFrontend = path.join(path.dirname(headerOnly), "pi-garden-desktop", "header.js");
    const headerSemantic = `export function mount(root) {
  root.dataset.testid = "semantic-header";
  root.textContent = "pi header";
  return () => {};
}
`;
    await writeFile(headerFrontend, headerSemantic);
    // Grow the extension with a footer the first pass did not see.
    await writeFile(
      headerOnly,
      `${await readFile(headerOnly, "utf8")}
// footer added after first adaptation
export function _unused() {}
`.replace(
        `ctx.ui.setHeader(() => ({ render: () => ["h"], invalidate: () => {} }));`,
        `ctx.ui.setHeader(() => ({ render: () => ["h"], invalidate: () => {} }));
    ctx.ui.setFooter(() => ({ render: () => ["f"], invalidate: () => {} }));`,
      ),
    );
    // Re-insert the adaptation call the rewrite may have dropped — keep factory shape.
    const grown = `import { registerDesktopAdaptations } from "./pi-garden-desktop.js";
export default function fixture(pi) {
  registerDesktopAdaptations(pi);
  pi.on("session_start", (_e, ctx) => {
    ctx.ui.setHeader(() => ({ render: () => ["h"], invalidate: () => {} }));
    ctx.ui.setFooter(() => ({ render: () => ["f"], invalidate: () => {} }));
  });
}
`;
    await writeFile(headerOnly, grown);
    const incremental = await applyDesktopAdaptation(headerOnly, helper);
    expect(incremental.changed).toBe(true);
    expect(await readFile(headerFrontend, "utf8")).toBe(headerSemantic);
    expect(await readFile(path.join(path.dirname(headerOnly), "pi-garden-desktop", "footer.js"), "utf8")).toMatch(
      /adapted ui\.setFooter/,
    );
    const desktop = await readFile(path.join(path.dirname(headerOnly), "pi-garden-desktop.ts"), "utf8");
    expect(desktop).toMatch(/registerRichSurface/);
    expect(desktop.match(/surface: "app-footer"/g)?.length ?? 0).toBe(1);
    expect(desktop.match(/surface: "app-header"/g)?.length ?? 0).toBe(1);
  });

  test("fixture B: adaptable findings first, Adapt available for a user extension", async () => {
    const { entry } = await fixture("terminal-heavy");
    const inventory = await owner().inventory({ workspace, extension: record(entry) });
    expect(inventory.findings[0]?.status).toBe("adaptable");
    expect(statuses(inventory)).toMatchObject({
      "ui.onTerminalInput": "adaptable",
      "ui.widget.component": "adaptable",
      "ui.setHeader": "adaptable",
      "ui.setFooter": "adaptable",
      "ui.custom": "adaptable",
      "ui.setEditorComponent": "adaptable",
      "tool.renderCall": "adaptable",
      "tool.renderResult": "adaptable",
      "ui.status": "supported",
      "pi.registerTool": "supported",
    });
    for (const finding of inventory.findings.filter((item) => item.status === "adaptable")) {
      expect(finding.adaptationTarget, finding.capability).toBeTruthy();
    }
    expect(inventory.adaptation).toEqual({
      available: true,
      message: expect.any(String),
    });
  });

  test("fixture C: desktop-native registrations recognized; runtime registration evidence joins them", async () => {
    const { entry } = await fixture("garden-aware");
    const compat = owner();
    const before = await compat.inventory({ workspace, extension: record(entry) });
    expect(statuses(before)).toMatchObject({
      "garden.registerRichSurface": "desktop-native",
      "garden.registerAction": "desktop-native",
      "ui.widget.component": "adaptable",
    });
    expect(before.runtime.generations).toEqual([]);

    await compat.replaceRuntime({
      target,
      generation: "g1",
      extensions: [{ resolvedPath: entry }],
      declarations: [],
      richSurfaces: [
        {
          id: "status",
          surface: "composer-before",
          source: pathToFileURL(entry).href,
          frontend: pathToFileURL(path.join(path.dirname(entry), "x.js")),
          backend: () => ({ id: "b", setup() {} }),
        },
      ],
      editors: [],
      contributions: [],
      actions: [
        {
          kind: "action",
          id: "fixture-garden-aware.tick",
          title: "tick",
          extensionPath: entry,
        },
      ],
    } as never);
    const after = await compat.inventory({ workspace, extension: record(entry) });
    expect(after.runtime.generations).toEqual([{ sessionId: "s1", generation: "g1" }]);
    const surface = after.findings.find((f) => f.capability === "garden.registerRichSurface")!;
    expect(surface.evidence.map((item) => item.kind).sort()).toEqual(["runtime", "source"]);
    const runtime = surface.evidence.find((item) => item.kind === "runtime")!;
    expect(runtime).toMatchObject({ generation: "g1", attribution: "registration" });
  });

  test("fixture D: package-installed extensions are inventoried, never mutated", async () => {
    const { entry } = await fixture("terminal-heavy");
    const inventory = await owner().inventory({
      workspace,
      extension: record(entry, { origin: "package", source: "local" }),
    });
    expect(inventory.findings.length).toBeGreaterThan(0);
    expect(inventory.adaptation).toMatchObject({ available: false, reason: "package" });
    const inNodeModules = await owner().inventory({
      workspace,
      extension: record(entry.replace("fixture-terminal-heavy", "node_modules/x")),
    });
    expect(inNodeModules.adaptation.reason).toBe("package");
  });

  test("fixture E: project-local requires trust; user/global does not; temporary never", async () => {
    const { entry } = await fixture("terminal-heavy", true);
    const project = record(entry, { scope: "project" });
    expect(
      (await owner(false).inventory({ workspace, extension: project })).adaptation,
    ).toMatchObject({
      available: false,
      reason: "untrusted-project",
    });
    expect(
      (await owner(true).inventory({ workspace, extension: project })).adaptation,
    ).toMatchObject({
      available: true,
    });
    expect(
      (await owner(false).inventory({ workspace, extension: record(entry, { scope: "user" }) }))
        .adaptation.available,
    ).toBe(true);
    expect(
      (await owner(true).inventory({ workspace, extension: record(entry, { scope: "temporary" }) }))
        .adaptation,
    ).toMatchObject({ available: false, reason: "temporary" });
  });

  test("fixture F: transcript customization is unsupported and blocks nothing else", async () => {
    const { entry } = await fixture("transcript-only");
    const inventory = await owner().inventory({ workspace, extension: record(entry) });
    expect(statuses(inventory)).toMatchObject({
      "pi.registerMessageRenderer": "unsupported",
      "pi.registerMarkdownTransformer": "unsupported",
      "pi.registerEntryRenderer": "unsupported",
      "pi.registerFlag": "unsupported",
    });
    for (const finding of inventory.findings.filter((item) => item.status === "unsupported")) {
      expect(finding.adaptationTarget).toBeUndefined();
      expect(finding.unsupportedReason).toBeTruthy();
    }
    expect(inventory.adaptation).toMatchObject({ available: false, reason: "nothing-to-adapt" });
  });

  test("builtin pi-garden extensions skip source inspection", async () => {
    const inventory = await owner().inventory({
      workspace,
      extension: record("/pi-garden/builtin/index.ts", { source: "builtin", origin: "top-level" }),
    });
    expect(inventory.source.status).toBe("skipped");
    expect(inventory.adaptation.reason).toBe("builtin");
  });

  test("runtime call-site evidence is generation-bound and retired with its generation", async () => {
    const { entry } = await fixture("terminal-heavy");
    const compat = owner();
    const changes: string[] = [];
    compat.subscribe((workspaceId) => changes.push(workspaceId));
    const runtime = (generation: string) =>
      ({
        target,
        generation,
        extensions: [{ resolvedPath: entry }],
        declarations: [],
        richSurfaces: [],
        editors: [],
        contributions: [],
        actions: [],
      }) as never;

    // Observed before the bridge publishes: held, then attached to the generation.
    await compat.observeTerminalUi({
      target,
      capability: "setHeader",
      extensionPath: entry,
      observedAt: new Date().toISOString(),
      attribution: "call-site",
    });
    await compat.replaceRuntime(runtime("g1"));
    let inventory = await compat.inventory({ workspace, extension: record(entry) });
    const header = () => inventory.findings.find((f) => f.capability === "ui.setHeader")!;
    expect(header().evidence.filter((item) => item.kind === "runtime")).toHaveLength(1);
    expect(inventory.runtime.generations).toEqual([{ sessionId: "s1", generation: "g1" }]);

    // A new generation replaces the old one; stale evidence does not survive as timeless truth.
    await compat.replaceRuntime(runtime("g2"));
    inventory = await compat.inventory({ workspace, extension: record(entry) });
    expect(header().evidence.filter((item) => item.kind === "runtime")).toHaveLength(0);
    expect(inventory.runtime.generations).toEqual([]);

    // Observations for a retired generation are dropped, later ones join the live generation.
    await compat.observeTerminalUi({
      target,
      capability: "custom",
      extensionPath: entry,
      observedAt: new Date().toISOString(),
      attribution: "reported",
    });
    inventory = await compat.inventory({ workspace, extension: record(entry) });
    expect(
      inventory.findings
        .find((f) => f.capability === "ui.custom")!
        .evidence.filter((item) => item.kind === "runtime"),
    ).toMatchObject([{ generation: "g2", attribution: "reported" }]);

    // Invalidation removes the generation entirely.
    compat.invalidateRuntime(target, "g2");
    inventory = await compat.inventory({ workspace, extension: record(entry) });
    expect(inventory.runtime.generations).toEqual([]);
    // A late publish for the invalidated generation is ignored.
    await compat.replaceRuntime(runtime("g2"));
    inventory = await compat.inventory({ workspace, extension: record(entry) });
    expect(inventory.runtime.generations).toEqual([]);

    // Other workspaces never see this evidence.
    const other = await compat.inventory({
      workspace: { workspaceId: "other", path: "/tmp/other" },
      extension: record(entry),
    });
    expect(other.runtime.generations).toEqual([]);
    expect(changes.every((id) => id === "ws")).toBe(true);
    expect(changes.length).toBeGreaterThan(0);
  });
});

test.describe("adapt for desktop invocation", () => {
  test("prompt invokes the canonical skill with the exact target and grouped findings", async () => {
    const { entry } = await fixture("terminal-heavy");
    const compat = new ExtensionCompatibilityOwner({ isProjectTrusted: async () => true });
    const workspace = { workspaceId: "ws", path: "/work/space" };
    const extension = record(entry);
    const inventory = await compat.inventory({ workspace, extension });
    const prompt = buildAdaptForDesktopPrompt({
      extension,
      workspace,
      inventory,
      helperPackageDir: "/app/resources/extension-ui",
      adaptWriterPath: "/app/resources/skills/adapt-for-desktop/apply.mjs",
    });
    expect(prompt.startsWith("/skill:adapt-for-desktop Adapt the Pi extension")).toBe(true);
    expect(prompt).toContain(`Target extension entry: ${entry}`);
    expect(prompt).toContain(`Extension directory: ${path.dirname(entry)}`);
    expect(prompt).toContain("Workspace: /work/space");
    expect(prompt).toContain("Scope: user (editable)");
    expect(prompt).toContain("/app/resources/extension-ui");
    expect(prompt).toContain("/app/resources/skills/adapt-for-desktop/apply.mjs");
    expect(prompt).toContain("- ui.setHeader (");
    expect(prompt).toContain("→ ");
    expect(prompt).not.toContain("Leave untouched");
  });

  test("service starts one ordinary thread and refuses ineligible targets", async () => {
    const { entry } = await fixture("terminal-heavy");
    const compat = new ExtensionCompatibilityOwner({ isProjectTrusted: async () => false });
    const started: { rootWorkspaceId: string; environment: string; prompt: string }[] = [];
    const extensions = new Map<string, RuntimeExtensionRecord>([
      [entry, record(entry, { scope: "project" })],
    ]);
    const service = new ExtensionCompatibilityService(
      compat,
      {
        workspaceFor: (workspaceId: string) =>
          workspaceId === "ws" ? { workspaceId: "ws", path: "/work/space" } : undefined,
        extensionFor: (_workspaceId: string, extensionPath: string) =>
          extensions.get(extensionPath),
        startThread: async (input: {
          rootWorkspaceId: string;
          environment: string;
          prompt: string;
        }) => {
          started.push(input);
          return { ok: true } as never;
        },
      },
      { helperPackageDir: "/helper", adaptWriterPath: "/helper/skills/adapt-for-desktop/apply.mjs" },
    );
    await expect(service.adapt({ workspaceId: "ws", extensionPath: entry })).rejects.toThrow(
      /trust/i,
    );
    expect(started).toHaveLength(0);

    extensions.set(entry, record(entry, { scope: "user" }));
    await service.adapt({ workspaceId: "ws", extensionPath: entry });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ rootWorkspaceId: "ws", environment: "local" });
    expect(started[0]!.prompt.startsWith("/skill:adapt-for-desktop ")).toBe(true);
    expect(started[0]!.prompt).toContain(entry);

    await expect(
      service.adapt({ workspaceId: "ws", extensionPath: "/nope/index.ts" }),
    ).rejects.toThrow();
    await expect(
      service.inventory({ workspaceId: "missing", extensionPath: entry }),
    ).rejects.toThrow();
  });
});

test("fixture names stay aligned with their kinds", () => {
  expect(Object.keys(COMPATIBILITY_FIXTURE_NAMES).sort()).toEqual([
    "garden-aware",
    "native-only",
    "terminal-heavy",
    "transcript-only",
  ]);
});

import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DESKTOP_ADAPTATION_METADATA_NAME,
  type DesktopAdaptationPair,
  type DesktopRegistrationApi,
  type ExtensionCapabilityId,
  type ExtensionSourceEvidence,
} from "../../contracts/extension-compatibility";
import { analyzeExtensionSource } from "./extension-compatibility-analyzer";

/**
 * The Adapt for Desktop writer.
 *
 * One registration per terminal family, recorded in `desktop-adaptation.json`
 * beside the entry. A second run writes nothing when those files already match.
 * Terminal calls stay in the entry so ordinary Pi still has them.
 */

const DESKTOP_MODULE = "pi-garden-desktop.ts";
const FRONTEND_DIR = "pi-garden-desktop";
const ADAPTATION_IMPORT = `import { registerDesktopAdaptations } from "./${DESKTOP_MODULE.replace(/\.ts$/, ".js")}";\n`;
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const REGISTRATION_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

const SURFACE_FAMILIES: readonly {
  readonly capability: ExtensionCapabilityId;
  readonly id: string;
  readonly surface: string;
  readonly title: string;
}[] = [
  { capability: "ui.widget.component", id: "widget", surface: "composer-before", title: "Widget" },
  { capability: "ui.setHeader", id: "header", surface: "app-header", title: "Header" },
  { capability: "ui.setFooter", id: "footer", surface: "app-footer", title: "Footer" },
  { capability: "ui.custom", id: "custom", surface: "overlay", title: "Custom" },
  { capability: "tui.component", id: "tui", surface: "workbench", title: "Terminal screen" },
];

interface PlannedRegistration {
  readonly capabilities: readonly ExtensionCapabilityId[];
  readonly api: DesktopRegistrationApi;
  readonly id: string;
  readonly surface?: string;
  readonly toolName?: string;
  readonly title: string;
  readonly kind: "surface" | "action" | "editor" | "tool";
  /** Shown in the generated frontend so a test can see which capability mounted. */
  readonly marker: ExtensionCapabilityId;
}

export interface ApplyDesktopAdaptationResult {
  readonly changed: boolean;
  readonly entryPath: string;
  readonly pairs: readonly DesktopAdaptationPair[];
}

export async function applyDesktopAdaptation(
  entryPath: string,
  helperPackageDir: string,
): Promise<ApplyDesktopAdaptationResult> {
  const entry = path.resolve(entryPath);
  if (entry.split(path.sep).includes("node_modules")) {
    throw new Error("Refusing to adapt an extension inside node_modules");
  }
  if (!(await isFile(entry))) throw new Error(`Extension entry is not a file: ${entry}`);
  await assertHelperPackage(helperPackageDir);

  const source = await readFile(entry, "utf8");
  if (!/export default function(?:\s+\w+)?\s*\(\s*\w+\s*\)\s*\{/.test(source)) {
    throw new Error(
      "Adapt for Desktop needs `export default function name(pi)` so it can call registerDesktopAdaptations once.",
    );
  }

  const { evidence } = await analyzeExtensionSource(entry);
  const plans = planRegistrations(evidence);
  if (plans.length === 0) {
    throw new Error("No terminal-specific presentation was found to adapt.");
  }

  const directory = path.dirname(entry);
  const pairs = plans.flatMap((plan) =>
    plan.capabilities.map((capability): DesktopAdaptationPair => ({
      capability,
      api: plan.api,
      id: plan.id,
      ...(plan.surface ? { surface: plan.surface } : {}),
      ...(plan.toolName ? { toolName: plan.toolName } : {}),
    })),
  );
  let changed = await vendorHelper(directory, path.resolve(helperPackageDir));
  changed =
    (await writeIfChanged(
      path.join(directory, DESKTOP_MODULE),
      renderDesktopModule(path.basename(entry), plans),
    )) || changed;
  for (const plan of plans) {
    changed =
      (await writeIfChanged(
        path.join(directory, FRONTEND_DIR, `${plan.id}.js`),
        renderFrontend(plan),
      )) || changed;
  }
  changed =
    (await writeIfChanged(
      path.join(directory, DESKTOP_ADAPTATION_METADATA_NAME),
      `${JSON.stringify({ version: 1, pairs }, null, 2)}\n`,
    )) || changed;
  changed = (await writeIfChanged(entry, insertAdaptationCall(source))) || changed;
  return { changed, entryPath: entry, pairs };
}

function planRegistrations(
  evidence: ReadonlyMap<ExtensionCapabilityId, readonly ExtensionSourceEvidence[]>,
): PlannedRegistration[] {
  const plans: PlannedRegistration[] = [];
  if (confident(evidence.get("ui.onTerminalInput"))) {
    plans.push({
      capabilities: ["ui.onTerminalInput"],
      api: "registerAction",
      id: "terminal-input",
      title: "Terminal input",
      kind: "action",
      marker: "ui.onTerminalInput",
    });
  }
  for (const family of SURFACE_FAMILIES) {
    if (!confident(evidence.get(family.capability))) continue;
    plans.push({
      capabilities: [family.capability],
      api: "registerRichSurface",
      id: family.id,
      surface: family.surface,
      title: family.title,
      kind: "surface",
      marker: family.capability,
    });
  }
  if (confident(evidence.get("ui.setEditorComponent"))) {
    plans.push({
      capabilities: ["ui.setEditorComponent"],
      api: "registerDesktopEditor",
      id: "editor",
      title: "Editor",
      kind: "editor",
      marker: "ui.setEditorComponent",
    });
  }
  for (const toolName of toolNames(evidence)) {
    const capabilities = (["tool.renderCall", "tool.renderResult"] as const).filter((capability) =>
      (evidence.get(capability) ?? []).some(
        (item) => item.kind === "source" && !item.partial && item.toolName === toolName,
      ),
    );
    const id = toolRegistrationId(toolName);
    plans.push({
      capabilities,
      api: "registerDesktopToolRenderer",
      id,
      toolName,
      title: toolName,
      kind: "tool",
      marker: capabilities[0] ?? "tool.renderCall",
    });
  }
  return plans;
}

function confident(items: readonly ExtensionSourceEvidence[] | undefined): boolean {
  return items?.some((item) => item.kind === "source" && !item.partial) ?? false;
}

function toolNames(
  evidence: ReadonlyMap<ExtensionCapabilityId, readonly ExtensionSourceEvidence[]>,
): string[] {
  const names = new Set<string>();
  for (const capability of ["tool.renderCall", "tool.renderResult"] as const) {
    for (const item of evidence.get(capability) ?? []) {
      if (
        item.kind === "source" &&
        !item.partial &&
        item.toolName &&
        TOOL_NAME_PATTERN.test(item.toolName)
      ) {
        names.add(item.toolName);
      }
    }
  }
  return [...names].sort();
}

function toolRegistrationId(toolName: string): string {
  const slug = toolName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^[^a-z]+/, "");
  const id = `tool-${slug || "renderer"}`.slice(0, 64);
  if (!REGISTRATION_ID_PATTERN.test(id)) {
    throw new Error(`Cannot derive a desktop id for tool ${toolName}`);
  }
  return id;
}

function renderDesktopModule(entryBase: string, plans: readonly PlannedRegistration[]): string {
  const imports = [...new Set(plans.map((plan) => plan.api))].sort();
  const source = `new URL(${JSON.stringify(`./${entryBase}`)}, import.meta.url).href`;
  const calls = plans.map((plan) => renderRegistration(plan, source)).join("\n");
  return `// Generated by Adapt for Desktop. Pairs live in ${DESKTOP_ADAPTATION_METADATA_NAME}.
import { ${imports.join(", ")} } from "@pi-garden/extension-ui";

export function registerDesktopAdaptations(pi) {
${calls}}
`;
}

function renderRegistration(plan: PlannedRegistration, source: string): string {
  const frontend = `new URL(${JSON.stringify(`./${FRONTEND_DIR}/${plan.id}.js`)}, import.meta.url)`;
  const backend = `() => ({ id: ${JSON.stringify(`pi-garden.adapt.${plan.id}.backend`)}, setup() {} })`;
  if (plan.kind === "action") {
    return `  registerAction(pi, {
    id: ${JSON.stringify(plan.id)},
    title: ${JSON.stringify(plan.title)},
    source: ${source},
    handler: () => {},
  });
`;
  }
  if (plan.kind === "editor") {
    return `  registerDesktopEditor(pi, {
    id: ${JSON.stringify(plan.id)},
    title: ${JSON.stringify(plan.title)},
    source: ${source},
    frontend: ${frontend},
  });
`;
  }
  if (plan.kind === "tool") {
    return `  registerDesktopToolRenderer(pi, {
    id: ${JSON.stringify(plan.id)},
    toolName: ${JSON.stringify(plan.toolName)},
    title: ${JSON.stringify(plan.title)},
    source: ${source},
    frontend: ${frontend},
    backend: ${backend},
  });
`;
  }
  return `  registerRichSurface(pi, {
    id: ${JSON.stringify(plan.id)},
    surface: ${JSON.stringify(plan.surface)},
    title: ${JSON.stringify(plan.title)},
    source: ${source},
    frontend: ${frontend},
    backend: ${backend},
  });
`;
}

function renderFrontend(plan: PlannedRegistration): string {
  return `export function mount(root) {
  const output = document.createElement("output");
  output.dataset.testid = "desktop-adaptation";
  output.dataset.capability = ${JSON.stringify(plan.marker)};
  output.textContent = ${JSON.stringify(`adapted ${plan.marker}`)};
  root.append(output);
  return () => {};
}
`;
}

function insertAdaptationCall(source: string): string {
  const withImport = source.includes(ADAPTATION_IMPORT.trim())
    ? source
    : `${ADAPTATION_IMPORT}${source}`;
  if (withImport.includes("registerDesktopAdaptations(")) return withImport;
  const match = /export default function(?:\s+\w+)?\s*\(\s*(\w+)\s*\)\s*\{/.exec(withImport);
  if (!match?.[1]) {
    throw new Error(
      "Adapt for Desktop needs `export default function name(pi)` so it can call registerDesktopAdaptations once.",
    );
  }
  const index = match.index + match[0].length;
  return `${withImport.slice(0, index)}\n  registerDesktopAdaptations(${match[1]});${withImport.slice(index)}`;
}

async function vendorHelper(
  extensionDirectory: string,
  helperPackageDir: string,
): Promise<boolean> {
  const target = path.join(extensionDirectory, "node_modules", "@pi-garden", "extension-ui");
  if (
    (await isFile(path.join(target, "package.json"))) &&
    (await isFile(path.join(target, "dist", "index.js")))
  ) {
    return false;
  }
  await mkdir(target, { recursive: true });
  await cp(path.join(helperPackageDir, "package.json"), path.join(target, "package.json"));
  await cp(path.join(helperPackageDir, "dist"), path.join(target, "dist"), { recursive: true });
  return true;
}

async function assertHelperPackage(helperPackageDir: string): Promise<void> {
  const root = path.resolve(helperPackageDir);
  if (
    !(await isFile(path.join(root, "package.json"))) ||
    !(await isFile(path.join(root, "dist", "index.js")))
  ) {
    throw new Error(
      `@pi-garden/extension-ui package directory must contain package.json and dist: ${root}`,
    );
  }
}

async function writeIfChanged(file: string, contents: string): Promise<boolean> {
  try {
    if ((await readFile(file, "utf8")) === contents) return false;
  } catch {
    // The file is not there yet.
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  return true;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

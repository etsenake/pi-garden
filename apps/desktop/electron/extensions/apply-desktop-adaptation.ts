import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DESKTOP_ADAPTATION_METADATA_NAME,
  type DesktopAdaptationMetadata,
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
 * beside the entry. Scaffold files are written once; a later run never
 * regenerates an existing frontend or the desktop module body after the skill
 * has edited them. Only unpaired capabilities get new registrations. Terminal
 * calls stay in the entry so ordinary Pi still has them.
 *
 * A pairing record or mounted placeholder is scaffolding, not semantic
 * adaptation: the skill still has to wire live behaviour into those files.
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
  const planned = planRegistrations(evidence);
  if (planned.length === 0) {
    throw new Error("No terminal-specific presentation was found to adapt.");
  }

  const directory = path.dirname(entry);
  const existingMeta = await readAdaptationMetadata(directory);
  const existingPairs = existingMeta?.pairs ?? [];
  const newPlans = planned.filter((plan) => !planIsCovered(plan, existingPairs));
  const pairs = mergePairs(
    existingPairs,
    newPlans.flatMap((plan) =>
      plan.capabilities.map((capability): DesktopAdaptationPair => ({
        capability,
        api: plan.api,
        id: plan.id,
        ...(plan.surface ? { surface: plan.surface } : {}),
        ...(plan.toolName ? { toolName: plan.toolName } : {}),
      })),
    ),
  );

  let changed = await vendorHelper(directory, path.resolve(helperPackageDir));

  const desktopPath = path.join(directory, DESKTOP_MODULE);
  if (!(await isFile(desktopPath))) {
    // First scaffold: write the full module for every planned registration.
    changed =
      (await writeIfChanged(desktopPath, renderDesktopModule(path.basename(entry), planned))) ||
      changed;
    for (const plan of planned) {
      changed =
        (await writeIfChanged(
          path.join(directory, FRONTEND_DIR, `${plan.id}.js`),
          renderFrontend(plan),
        )) || changed;
    }
  } else if (newPlans.length > 0) {
    // Add only unpaired registrations; never rewrite existing skill-edited bodies.
    const previous = await readFile(desktopPath, "utf8");
    changed =
      (await writeIfChanged(
        desktopPath,
        appendRegistrations(previous, path.basename(entry), newPlans),
      )) || changed;
    for (const plan of newPlans) {
      const frontendPath = path.join(directory, FRONTEND_DIR, `${plan.id}.js`);
      if (await isFile(frontendPath)) continue;
      changed = (await writeIfChanged(frontendPath, renderFrontend(plan))) || changed;
    }
  }
  // else: every capability is already paired — leave edited scaffolds alone.

  changed =
    (await writeIfChanged(
      path.join(directory, DESKTOP_ADAPTATION_METADATA_NAME),
      `${JSON.stringify({ version: 1, pairs } satisfies DesktopAdaptationMetadata, null, 2)}\n`,
    )) || changed;
  changed = (await writeIfChanged(entry, insertAdaptationCall(source))) || changed;
  return { changed, entryPath: entry, pairs };
}

function planIsCovered(
  plan: PlannedRegistration,
  pairs: readonly DesktopAdaptationPair[],
): boolean {
  return plan.capabilities.every((capability) =>
    pairs.some(
      (pair) =>
        pair.capability === capability &&
        pair.api === plan.api &&
        pair.id === plan.id &&
        (plan.surface === undefined || pair.surface === plan.surface) &&
        (plan.toolName === undefined || pair.toolName === plan.toolName),
    ),
  );
}

function mergePairs(
  existing: readonly DesktopAdaptationPair[],
  added: readonly DesktopAdaptationPair[],
): DesktopAdaptationPair[] {
  const out = [...existing];
  for (const pair of added) {
    if (
      out.some(
        (item) =>
          item.capability === pair.capability &&
          item.api === pair.api &&
          item.id === pair.id &&
          item.surface === pair.surface &&
          item.toolName === pair.toolName,
      )
    ) {
      continue;
    }
    out.push(pair);
  }
  return out;
}

async function readAdaptationMetadata(
  directory: string,
): Promise<DesktopAdaptationMetadata | undefined> {
  const file = path.join(directory, DESKTOP_ADAPTATION_METADATA_NAME);
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as DesktopAdaptationMetadata;
    if (raw?.version !== 1 || !Array.isArray(raw.pairs)) return undefined;
    return raw;
  } catch {
    return undefined;
  }
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

/**
 * Append registrations for newly unpaired capabilities without regenerating
 * the existing module body (which the skill may have edited).
 */
function appendRegistrations(
  existing: string,
  entryBase: string,
  plans: readonly PlannedRegistration[],
): string {
  if (plans.length === 0) return existing;
  const source = `new URL(${JSON.stringify(`./${entryBase}`)}, import.meta.url).href`;
  const neededImports = new Set(plans.map((plan) => plan.api));
  let next = existing;
  const importMatch = /import\s*\{([^}]+)\}\s*from\s*["']@pi-garden\/extension-ui["']\s*;/.exec(
    next,
  );
  if (importMatch) {
    const current = new Set(
      importMatch[1]!
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    );
    for (const name of neededImports) current.add(name);
    const merged = [...current].sort().join(", ");
    next = `${next.slice(0, importMatch.index)}import { ${merged} } from "@pi-garden/extension-ui";${next.slice(importMatch.index + importMatch[0].length)}`;
  } else {
    next = `import { ${[...neededImports].sort().join(", ")} } from "@pi-garden/extension-ui";\n${next}`;
  }
  const calls = plans.map((plan) => renderRegistration(plan, source)).join("\n");
  const closer = next.lastIndexOf("\n}");
  if (closer === -1) {
    throw new Error(`Cannot append desktop adaptations to ${DESKTOP_MODULE}`);
  }
  return `${next.slice(0, closer)}\n${calls}${next.slice(closer)}`;
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
  output.dataset.scaffold = "true";
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

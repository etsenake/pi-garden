import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Phase 9 extension fixtures. Each is a real Pi extension that loads under
 * ordinary Pi and under pi-garden; they differ only in which host APIs they
 * reach for, so the same file exercises the analyzer, the owner, the
 * Extensions detail UI and the Adapt gating.
 */
export type CompatibilityFixtureKind =
  | "native-only" // A: nothing terminal-specific
  | "terminal-heavy" // B: one of every adaptable family
  | "garden-aware" // C: already registers pi-garden surfaces, one terminal widget left
  | "transcript-only"; // F: message/markdown/entry renderers, no desktop target

export const COMPATIBILITY_FIXTURE_NAMES: Readonly<Record<CompatibilityFixtureKind, string>> = {
  "native-only": "fixture-native-only",
  "terminal-heavy": "fixture-terminal-heavy",
  "garden-aware": "fixture-garden-aware",
  "transcript-only": "fixture-transcript-only",
};

/** The helper package as the Adapt skill vendors it: package.json plus dist. */
export async function vendorExtensionUi(
  extensionDirectory: string,
  helperPackageDir = dirname(dirname(require.resolve("@pi-garden/extension-ui"))),
): Promise<string> {
  const target = join(extensionDirectory, "node_modules", "@pi-garden", "extension-ui");
  await mkdir(target, { recursive: true });
  await cp(join(helperPackageDir, "package.json"), join(target, "package.json"));
  await cp(join(helperPackageDir, "dist"), join(target, "dist"), { recursive: true });
  return target;
}

/**
 * Writes one fixture as `<extensionsDir>/<name>/index.ts` and returns the entry path.
 * `singleFile` writes `<extensionsDir>/<name>.ts` instead (Pi's other discovery shape).
 */
export async function writeCompatibilityFixture(
  kind: CompatibilityFixtureKind,
  extensionsDir: string,
  options: { readonly singleFile?: boolean } = {},
): Promise<string> {
  const name = COMPATIBILITY_FIXTURE_NAMES[kind];
  const entry = options.singleFile
    ? join(extensionsDir, `${name}.ts`)
    : join(extensionsDir, name, "index.ts");
  await mkdir(dirname(entry), { recursive: true });
  if (kind === "garden-aware") {
    if (options.singleFile) throw new Error("garden-aware fixture needs its own directory");
    await vendorExtensionUi(dirname(entry));
    await mkdir(join(dirname(entry), `${name}.desktop`), { recursive: true });
    await writeFile(join(dirname(entry), `${name}.desktop`, "status.js"), GARDEN_AWARE_FRONTEND);
  }
  await writeFile(entry, FIXTURE_SOURCE[kind](name));
  return entry;
}

const FIXTURE_SOURCE: Readonly<Record<CompatibilityFixtureKind, (name: string) => string>> = {
  "native-only": (name) => `
export default function fixture(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("${name}", "ready");
    ctx.ui.setWidget("${name}", ["${name} widget line"]);
  });
  pi.registerCommand("${name}", {
    description: "Native-only fixture command",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Pick", ["one", "two"]);
      ctx.ui.notify(\`picked \${choice ?? "nothing"}\`, "info");
      ctx.ui.setEditorText("from ${name}");
    },
  });
  pi.registerShortcut("ctrl+alt+9", { description: "${name} shortcut", handler: () => {} });
}
`,
  "terminal-heavy": (name) => `
const emptyComponent = () => ({ render: () => [], invalidate: () => {}, handleInput: () => {} });

export default function fixture(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("${name}", "terminal ui armed");
    ctx.ui.onTerminalInput(() => undefined);
    ctx.ui.setWidget("${name}-panel", emptyComponent);
    ctx.ui.setHeader(emptyComponent);
    ctx.ui.setFooter(emptyComponent);
    ctx.ui.setEditorComponent(emptyComponent);
  });
  pi.registerCommand("${name}-pick", {
    description: "Opens a terminal-only picker",
    handler: async (_args, ctx) => {
      try {
        await ctx.ui.custom(() => emptyComponent());
      } catch (error) {
        ctx.ui.notify(String(error instanceof Error ? error.message : error), "warning");
      }
    },
  });
  pi.registerTool({
    name: "${name}_tool",
    label: "${name} tool",
    description: "Terminal-heavy fixture tool",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
    renderCall() { return emptyComponent(); },
    renderResult() { return emptyComponent(); },
  });
}
`,
  "garden-aware": (name) => `
import { registerAction, registerRichSurface } from "@pi-garden/extension-ui";

const emptyComponent = () => ({ render: () => [], invalidate: () => {} });
const STATE_SERVICE = Object.freeze({ id: "${name}.state.v1", local: false });
const background = { value: () => undefined, get abortSignal() { return undefined; } };

export default function fixture(pi) {
  let ticks = 0;
  const listeners = new Set();
  const publish = () => { for (const listener of listeners) listener({ ticks }); };

  registerRichSurface(pi, {
    id: "status",
    surface: "composer-before",
    title: "${name} status",
    source: import.meta.url,
    frontend: new URL("./${name}.desktop/status.js", import.meta.url),
    backend: () => ({
      id: "${name}.status.backend",
      setup(env) {
        const state = env.replicatedState({ ticks });
        const listener = (next) => state.replace(background, next);
        listeners.add(listener);
        env.own(() => listeners.delete(listener));
        env.provide(STATE_SERVICE, { state });
      },
    }),
  });
  registerAction(pi, {
    id: "${name}.tick",
    title: "${name}: tick",
    source: import.meta.url,
    handler: (ctx) => { ticks += 1; publish(); ctx.ui.setStatus("${name}", \`ticks \${ticks}\`); },
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("${name}", "garden-aware");
    ctx.ui.setWidget("${name}-terminal", emptyComponent);
  });
  pi.registerCommand("${name}-tick", {
    description: "Advance the fixture counter",
    handler: async (_args, ctx) => { ticks += 1; publish(); ctx.ui.notify(\`ticks \${ticks}\`, "info"); },
  });
}
`,
  "transcript-only": (name) => `
export default function fixture(pi) {
  pi.registerMessageRenderer("${name}-message", () => undefined);
  pi.registerMarkdownTransformer((tokens) => tokens);
  pi.registerEntryRenderer("${name}-entry", () => undefined);
  pi.registerFlag("${name}-flag", { description: "Fixture flag", type: "boolean", default: false });
  pi.registerCommand("${name}", {
    description: "Transcript-only fixture",
    handler: async (_args, ctx) => { ctx.ui.notify("transcript fixture", "info"); },
  });
}
`,
};

const GARDEN_AWARE_FRONTEND = `
export async function mount(root, host) {
  const background = { value: () => undefined, get abortSignal() { return undefined; } };
  const service = { id: "fixture-garden-aware.state.v1", local: false };
  const binding = host.services.open({
    services: [service],
    assertAccess: () => host.signal.throwIfAborted(),
    onError: (reason) => { root.textContent = String(reason); },
  });
  const state = binding.use(service).state;
  await binding.ready(background);
  root.innerHTML = '<output data-testid="garden-aware-ticks"></output>';
  const render = (value) => { root.querySelector("output").textContent = "ticks " + value.ticks; };
  if (state.value) render(state.value);
  const stop = state.subscribe(render);
  return () => { stop(); return binding.dispose(background); };
}
`;

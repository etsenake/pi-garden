#!/usr/bin/env node
/**
 * Scaffold a rich-surface extension.
 * Usage: node apply.mjs <output-extension-dir> <surface-id> <surface-kind> <helper-package-dir>
 */
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SURFACES = new Set([
  "composer-before",
  "composer-after",
  "sidebar",
  "thread-header",
  "overlay",
  "settings",
  "app-header",
  "app-footer",
]);

const [outDirArg, surfaceId, surfaceKind, helperArg] = process.argv.slice(2);
if (!outDirArg || !surfaceId || !surfaceKind || !helperArg || process.argv.length > 6) {
  console.error(
    "usage: apply.mjs <output-extension-dir> <surface-id> <surface-kind> <helper-package-dir>",
  );
  process.exit(1);
}
if (!/^[a-z][a-z0-9._-]{0,63}$/.test(surfaceId)) {
  console.error("surface-id must match ^[a-z][a-z0-9._-]{0,63}$");
  process.exit(1);
}
if (!SURFACES.has(surfaceKind)) {
  console.error(`surface-kind must be one of: ${[...SURFACES].join(", ")}`);
  process.exit(1);
}

const outDir = path.resolve(outDirArg);
const helper = path.resolve(helperArg);
await assertHelper(helper);
await mkdir(outDir, { recursive: true });
await mkdir(path.join(outDir, "pi-garden-desktop"), { recursive: true });

let changed = await vendorHelper(outDir, helper);
const frontendRel = `./pi-garden-desktop/${surfaceId}.js`;
const serviceId = `${surfaceId}.state.v1`;

changed =
  (await writeIfAbsent(
    path.join(outDir, "index.ts"),
    `import { registerRichSurface, type DesktopExtensionAPI } from "@pi-garden/extension-ui";

const STATE_SERVICE = Object.freeze({ id: "${serviceId}", local: false });

const background = {
  value: () => undefined,
  get abortSignal() {
    return undefined as AbortSignal | undefined;
  },
};

export default function ${camelId(surfaceId)}(pi: DesktopExtensionAPI): void {
  registerRichSurface(pi, {
    id: "${surfaceId}",
    surface: "${surfaceKind}",
    title: "${titleCase(surfaceId)}",
    source: import.meta.url,
    frontend: new URL(${JSON.stringify(frontendRel)}, import.meta.url),
    backend: () => ({
      id: "${surfaceId}.backend",
      setup(env) {
        const state = env.replicatedState({ label: "${titleCase(surfaceId)}", ready: true });
        env.provide(STATE_SERVICE, { state });
      },
    }),
  });
}

export { STATE_SERVICE, background };
`,
  )) || changed;

changed =
  (await writeIfAbsent(
    path.join(outDir, "pi-garden-desktop", `${surfaceId}.js`),
    `const STATE_SERVICE = Object.freeze({ id: "${serviceId}", local: false });

function applyTheme(root, theme) {
  root.style.setProperty("--bg", theme.background);
  root.style.setProperty("--fg", theme.foreground);
  root.style.setProperty("--accent", theme.accent);
  root.style.colorScheme = theme.mode;
  if (theme.snapshot?.seed) {
    root.style.setProperty("--seed-surface", theme.snapshot.seed.surface);
    root.style.setProperty("--seed-ink", theme.snapshot.seed.ink);
    root.style.setProperty("--seed-accent", theme.snapshot.seed.accent);
  }
}

function render(root, state, theme) {
  applyTheme(root, theme);
  root.replaceChildren();
  const style = document.createElement("style");
  style.textContent = \`
    .panel{font:13px/1.45 system-ui,sans-serif;padding:10px 12px;color:var(--fg);background:var(--bg)}
    .panel strong{color:var(--accent)}
  \`;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = "<strong>" + (state?.label ?? "${titleCase(surfaceId)}") + "</strong>" +
    (state?.ready ? " · ready" : "");
  root.append(style, panel);
}

export async function mount(root, host) {
  host.signal.throwIfAborted();
  const background = {
    value: () => undefined,
    get abortSignal() {
      return undefined;
    },
  };
  const binding = host.services.open({
    services: [STATE_SERVICE],
    assertAccess: () => host.signal.throwIfAborted(),
    onError: (reason) => {
      root.textContent = String(reason);
    },
  });
  const service = binding.use(STATE_SERVICE);
  await binding.ready(background);
  const stopState = service.state.subscribe((next) => render(root, next, host.theme));
  const stopTheme = host.subscribeTheme((theme) => render(root, service.state.value, theme));
  if (service.state.value) render(root, service.state.value, host.theme);
  else render(root, { label: "${titleCase(surfaceId)}", ready: false }, host.theme);
  const dispose = () => {
    stopState();
    stopTheme();
    binding.dispose(background).catch(() => {});
  };
  host.signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
`,
  )) || changed;

changed =
  (await writeIfAbsent(
    path.join(outDir, "package.json"),
    `${JSON.stringify(
      {
        name: surfaceId,
        private: true,
        type: "module",
        pi: { extensions: ["./index.ts"] },
      },
      null,
      2,
    )}\n`,
  )) || changed;

console.log(changed ? "created" : "unchanged");

function camelId(id) {
  return id.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/^[^a-zA-Z]+/, "ext");
}

function titleCase(id) {
  return id
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function vendorHelper(directory, helperPackageDir) {
  const target = path.join(directory, "node_modules", "@pi-garden", "extension-ui");
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

async function assertHelper(helperPackageDir) {
  if (
    !(await isFile(path.join(helperPackageDir, "package.json"))) ||
    !(await isFile(path.join(helperPackageDir, "dist", "index.js")))
  ) {
    throw new Error(
      `@pi-garden/extension-ui package directory must contain package.json and dist: ${helperPackageDir}`,
    );
  }
}

async function writeIfAbsent(file, contents) {
  try {
    await readFile(file, "utf8");
    return false;
  } catch {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
    return true;
  }
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

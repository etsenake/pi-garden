#!/usr/bin/env node
/**
 * Scaffold a workbench desktop-view extension.
 * Usage: node apply.mjs <output-extension-dir> <view-id> <helper-package-dir>
 */
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const [outDirArg, viewId, helperArg] = process.argv.slice(2);
if (!outDirArg || !viewId || !helperArg || process.argv.length > 5) {
  console.error("usage: apply.mjs <output-extension-dir> <view-id> <helper-package-dir>");
  process.exit(1);
}
if (!/^[a-z][a-z0-9._-]{0,63}$/.test(viewId)) {
  console.error("view-id must match ^[a-z][a-z0-9._-]{0,63}$");
  process.exit(1);
}

const outDir = path.resolve(outDirArg);
const helper = path.resolve(helperArg);
await assertHelper(helper);
await mkdir(outDir, { recursive: true });
await mkdir(path.join(outDir, "pi-garden-desktop"), { recursive: true });

let changed = await vendorHelper(outDir, helper);
const serviceId = `${viewId}.state.v1`;
const frontendRel = `./pi-garden-desktop/${viewId}.js`;

changed =
  (await writeIfAbsent(
    path.join(outDir, "index.ts"),
    `import { registerDesktopView, type DesktopExtensionAPI } from "@pi-garden/extension-ui";

const STATE_SERVICE = Object.freeze({ id: "${serviceId}", local: false });

export default function ${camelId(viewId)}(pi: DesktopExtensionAPI): void {
  // Register Pi commands/tools on the same factory when you cast to ExtensionAPI.
  registerDesktopView(pi, {
    id: "${viewId}",
    title: "${titleCase(viewId)}",
    source: import.meta.url,
    frontend: new URL(${JSON.stringify(frontendRel)}, import.meta.url),
    backend: () => ({
      id: "${viewId}.backend",
      setup(env) {
        const state = env.replicatedState({
          title: "${titleCase(viewId)}",
          message: "Replace this scaffold with your workflow.",
        });
        env.provide(STATE_SERVICE, {
          state,
          async ping() {
            const next = { ...state.value, message: "Ping " + new Date().toISOString() };
            state.replace(
              { value: () => undefined, get abortSignal() { return undefined; } },
              next,
            );
            return next;
          },
        });
      },
    }),
  });
}
`,
  )) || changed;

changed =
  (await writeIfAbsent(
    path.join(outDir, "pi-garden-desktop", `${viewId}.js`),
    `const STATE_SERVICE = Object.freeze({ id: "${serviceId}", local: false });

function applyTheme(root, theme) {
  root.style.setProperty("--bg", theme.background);
  root.style.setProperty("--fg", theme.foreground);
  root.style.setProperty("--accent", theme.accent);
  root.style.colorScheme = theme.mode;
  const tokens = theme.snapshot && theme.snapshot.tokens;
  if (tokens) {
    for (const [key, value] of Object.entries(tokens)) {
      if (typeof value === "string") root.style.setProperty(key, value);
    }
  }
}

function render(root, state, theme, onPing) {
  applyTheme(root, theme);
  root.replaceChildren();
  const style = document.createElement("style");
  style.textContent = \`
    .view{font:14px/1.5 system-ui,sans-serif;padding:24px;min-height:100%;color:var(--fg);background:var(--bg)}
    h1{font-size:20px;margin:0 0 8px} p{margin:0 0 16px;opacity:.85}
    button{font:inherit;padding:8px 12px;border-radius:7px;border:1px solid color-mix(in srgb,var(--fg) 24%,transparent);
      background:var(--accent);color:#fff;cursor:pointer}
  \`;
  const view = document.createElement("main");
  view.className = "view";
  const h1 = document.createElement("h1");
  h1.textContent = state?.title ?? "${titleCase(viewId)}";
  const p = document.createElement("p");
  p.textContent = state?.message ?? "";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Ping backend";
  button.addEventListener("click", () => onPing());
  view.append(h1, p, button);
  root.append(style, view);
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
  const paint = () =>
    render(root, service.state.value, host.theme, () => {
      service.ping().catch((error) => {
        root.textContent = String(error);
      });
    });
  const stopState = service.state.subscribe(paint);
  const stopTheme = host.subscribeTheme(paint);
  paint();
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
        name: viewId,
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

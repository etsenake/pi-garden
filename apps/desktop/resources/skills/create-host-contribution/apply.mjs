#!/usr/bin/env node
/**
 * Scaffold a host-rendered contribution extension.
 * Usage: node apply.mjs <output-extension-dir> <extension-id> <helper-package-dir>
 */
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const [outDirArg, extensionId, helperArg] = process.argv.slice(2);
if (!outDirArg || !extensionId || !helperArg || process.argv.length > 5) {
  console.error("usage: apply.mjs <output-extension-dir> <extension-id> <helper-package-dir>");
  process.exit(1);
}

if (!/^[a-z][a-z0-9._-]{0,63}$/.test(extensionId)) {
  console.error("extension-id must match ^[a-z][a-z0-9._-]{0,63}$");
  process.exit(1);
}

const outDir = path.resolve(outDirArg);
const helper = path.resolve(helperArg);
await assertHelper(helper);
await mkdir(outDir, { recursive: true });

const indexPath = path.join(outDir, "index.ts");
const packagePath = path.join(outDir, "package.json");
let changed = false;

changed = (await vendorHelper(outDir, helper)) || changed;
changed =
  (await writeIfAbsent(
    indexPath,
    `import {
  registerAction,
  registerComposerAfter,
  registerComposerBefore,
  registerHeaderBadge,
  registerSidebarFooter,
  registerSidebarSection,
  registerStatusChrome,
  type DesktopExtensionAPI,
} from "@pi-garden/extension-ui";

/**
 * Host-rendered contributions only. No browser frontend.
 * Edit text, tone, and order; keep ids stable.
 */
export default function ${camelId(extensionId)}(pi: DesktopExtensionAPI): void {
  registerAction(pi, {
    id: "${extensionId}.hello",
    title: "Hello from ${extensionId}",
    source: import.meta.url,
    handler: () => {
      // Runs in the extension process. Wire real work here.
    },
  });

  registerHeaderBadge(pi, {
    id: "${extensionId}",
    text: "Ready",
    tone: "accent",
    actionId: "${extensionId}.hello",
  });
  registerSidebarSection(pi, { id: "${extensionId}", text: "Lane", tone: "muted", order: 0 });
  registerSidebarFooter(pi, { id: "${extensionId}", text: "Foot", tone: "default" });
  registerComposerBefore(pi, { id: "${extensionId}", text: "Before", tone: "accent" });
  registerComposerAfter(pi, { id: "${extensionId}", text: "After", tone: "success" });
  registerStatusChrome(pi, { id: "${extensionId}", text: "Live", tone: "warning" });
}
`,
  )) || changed;

changed =
  (await writeIfAbsent(
    packagePath,
    `${JSON.stringify(
      {
        name: extensionId,
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

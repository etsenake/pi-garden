import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Focused copies of real upstream Pi example extensions (not synthetic
 * compatibility fixtures). Each proves one adaptation family end-to-end.
 */

function piExamplesDir(): string {
  // Exports map blocks require.resolve of package.json / dist paths; walk from
  // this helper (apps/desktop/tests/helpers) to the workspace node_modules copy.
  return join(
    __dirname,
    "../../../../node_modules/@earendil-works/pi-coding-agent/examples/extensions",
  );
}

export type RealPiExtensionKind = "todo" | "custom-header";

export const REAL_PI_EXTENSION_FILES: Readonly<Record<RealPiExtensionKind, string>> = {
  todo: "todo.ts",
  "custom-header": "custom-header.ts",
};

/** Copy one real Pi example into `<extensionsDir>/<name>/index.ts`. */
export async function writeRealPiExtension(
  kind: RealPiExtensionKind,
  extensionsDir: string,
): Promise<string> {
  const name = kind === "todo" ? "pi-todo" : "pi-custom-header";
  const entry = join(extensionsDir, name, "index.ts");
  await mkdir(dirname(entry), { recursive: true });
  const source = await readFile(join(piExamplesDir(), REAL_PI_EXTENSION_FILES[kind]), "utf8");
  // Adapt writer requires `export default function name(pi)` so it can insert
  // one registerDesktopAdaptations call. Upstream examples use an anonymous
  // default; rename without changing behaviour.
  const adapted = source.replace(
    /export default function\s*\(\s*pi\s*(?::\s*ExtensionAPI)?\s*\)/,
    "export default function extension(pi)",
  );
  if (adapted === source) {
    throw new Error(`Could not normalize default export for ${kind}`);
  }
  await writeFile(entry, adapted);
  return entry;
}

/** Semantic tool-renderer frontend for the real todo extension after scaffolding. */
export function todoToolRendererFrontend(): string {
  return `export function mount(root, host) {
  const output = document.createElement("output");
  output.dataset.testid = "todo-tool-renderer";
  const paint = (tool) => {
    if (!tool) {
      output.textContent = "todo idle";
      return;
    }
    const args = tool.args && typeof tool.args === "object" ? tool.args : {};
    const action = typeof args.action === "string" ? args.action : "";
    const resultText =
      tool.result &&
      Array.isArray(tool.result.content) &&
      tool.result.content[0] &&
      tool.result.content[0].type === "text"
        ? tool.result.content[0].text
        : "";
    output.dataset.phase = tool.phase || "";
    output.dataset.action = action;
    output.textContent = [action, resultText].filter(Boolean).join(" · ") || "todo";
  };
  paint(host.tool);
  const stop = host.subscribeTool ? host.subscribeTool(paint) : () => {};
  root.append(output);
  return () => stop();
}
`;
}

/** Semantic header frontend for the real custom-header extension. */
export function customHeaderFrontend(): string {
  return `export function mount(root) {
  const banner = document.createElement("div");
  banner.dataset.testid = "pi-custom-header";
  banner.textContent = "pi custom header";
  root.append(banner);
  return () => {};
}
`;
}

export async function vendorExtensionUiFor(
  extensionDirectory: string,
  helperPackageDir = dirname(dirname(require.resolve("@pi-garden/extension-ui"))),
): Promise<void> {
  const target = join(extensionDirectory, "node_modules", "@pi-garden", "extension-ui");
  await mkdir(target, { recursive: true });
  await cp(join(helperPackageDir, "package.json"), join(target, "package.json"));
  await cp(join(helperPackageDir, "dist"), join(target, "dist"), { recursive: true });
}

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(__filename);
const helperPath = require.resolve("@pi-garden/extension-ui");

function markModule(label: string, extra = ""): string {
  return `
export async function mount(root, host) {
  root.innerHTML = '<p class="rich-mark">${label}</p><output id="theme"></output><pre id="boundary"></pre><output id="overlay-result"></output>${extra}';
  const paint = () => {
    const theme = root.querySelector("#theme");
    if (theme) theme.textContent = (host.theme.snapshot && host.theme.snapshot.id) || host.theme.mode;
  };
  paint();
  const stopTheme = host.subscribeTheme(paint);
  let parentAccess = "allowed";
  try { void parent.document.body; } catch { parentAccess = "blocked"; }
  const boundary = root.querySelector("#boundary");
  if (boundary) boundary.textContent = JSON.stringify({
    preload: typeof window.piApp,
    process: typeof process,
    require: typeof require,
    parentAccess,
    origin: self.origin,
  });
  const open = root.querySelector("#open-picker");
  if (open) open.onclick = async () => {
    const result = await host.actions.presentOverlay("picker");
    const output = root.querySelector("#overlay-result");
    if (output) output.textContent = JSON.stringify(result);
  };
  return () => stopTheme();
}
`;
}

const overlayModule = `
export async function mount(root, host) {
  root.innerHTML = '<p>picker</p><button id="return" type="button">Return north</button><button id="cancel" type="button">Cancel pick</button>';
  root.querySelector("#return").onclick = () => { void host.actions.settle({ picked: "north" }); };
  root.querySelector("#cancel").onclick = () => { void host.actions.cancel(); };
  return () => {};
}
`;

const toolModule = `
export async function mount(root, host) {
  const pre = document.createElement("pre");
  pre.id = "tool-state";
  root.appendChild(pre);
  const paint = (tool) => {
    pre.textContent = JSON.stringify({
      toolName: tool.toolName,
      toolCallId: tool.toolCallId,
      arguments: tool.arguments ?? null,
      argumentsComplete: tool.argumentsComplete,
      executionStarted: tool.executionStarted,
      phase: tool.phase,
      partial: tool.partial ?? null,
      result: tool.result ?? null,
      error: tool.error ?? null,
      expanded: tool.expanded,
      themeId: host.theme.snapshot && host.theme.snapshot.id,
    });
  };
  if (host.tool) paint(host.tool);
  const stopTool = host.subscribeTool(paint);
  const stopTheme = host.subscribeTheme(() => { if (host.tool) paint(host.tool); });
  return () => { stopTool(); stopTheme(); };
}
`;

const brokenModule = `export function mount() { throw new Error("renderer exploded"); }\n`;

function surface(
  id: string,
  surfaceName: string,
  file: string,
  options: { title?: string; order?: number } = {},
): string {
  const title = options.title ?? id;
  const order = options.order === undefined ? "" : `, order: ${options.order}`;
  return `registerRichSurface(pi, {
    id: ${JSON.stringify(id)},
    surface: ${JSON.stringify(surfaceName)},
    title: ${JSON.stringify(title)},
    source: import.meta.url,
    frontend: new URL(${JSON.stringify(`./dist/${file}`)}, import.meta.url),
    backend: () => ({ id: ${JSON.stringify(`${id}.backend`)}, setup() {} })${order}
  });`;
}

export async function installRichSurfaceFixtures(input: {
  readonly workspacePath: string;
  readonly agentDir: string;
}): Promise<{
  readonly projectExtensionPath: string;
  readonly conflictExtensionPath: string;
  readonly userExtensionPath: string;
}> {
  const directory = join(input.workspacePath, ".pi", "extensions");
  const dist = join(directory, "dist");
  await mkdir(dist, { recursive: true });
  const files: Record<string, string> = {
    "header.js": markModule("app-header"),
    "footer.js": markModule("app-footer"),
    "alpha.js": markModule("sidebar-alpha"),
    "zeta.js": markModule("sidebar-zeta"),
    "middle.js": markModule("sidebar-middle"),
    "thread.js": markModule(
      "thread-header",
      '<button id="open-picker" type="button">Open picker</button>',
    ),
    "before.js": markModule("composer-before"),
    "after.js": markModule("composer-after"),
    "settings.js": markModule("project-garden"),
    "overlay.js": overlayModule,
    "rich-bench.js": markModule("rich-workbench"),
    "legacy-bench.js": markModule("legacy-workbench"),
    "conflict-header.js": markModule("other-header"),
    "tool.js": toolModule,
    "broken.js": brokenModule,
  };
  await Promise.all(
    Object.entries(files).map(([name, source]) => writeFile(join(dist, name), source, "utf8")),
  );
  const projectExtensionPath = join(directory, "rich-garden.ts");
  await writeFile(
    projectExtensionPath,
    `
import { registerDesktopToolRenderer, registerDesktopView, registerRichSurface } from ${JSON.stringify(helperPath)};
export default function richGarden(pi) {
  pi.registerCommand("rich-tools", {
    description: "Set tools expanded",
    handler: async (args, ctx) => {
      ctx.ui.setToolsExpanded(args.trim() === "on");
      ctx.ui.notify("tools " + args.trim(), "info");
    },
  });
  ${surface("garden-header", "app-header", "header.js", { title: "Garden header" })}
  ${surface("garden-footer", "app-footer", "footer.js", { title: "Garden footer" })}
  ${surface("alpha", "sidebar", "alpha.js", { title: "Alpha", order: 0 })}
  ${surface("zeta", "sidebar", "zeta.js", { title: "Zeta", order: 0 })}
  ${surface("middle", "sidebar", "middle.js", { title: "Middle", order: 1 })}
  ${surface("garden-thread", "thread-header", "thread.js", { title: "Thread header" })}
  ${surface("garden-before", "composer-before", "before.js", { title: "Before composer" })}
  ${surface("garden-after", "composer-after", "after.js", { title: "After composer" })}
  ${surface("picker", "overlay", "overlay.js", { title: "Pick a place" })}
  ${surface("project-garden", "settings", "settings.js", { title: "Project garden" })}
  ${surface("rich-bench", "workbench", "rich-bench.js", { title: "Rich workbench" })}
  registerDesktopView(pi, {
    id: "legacy-bench",
    title: "Legacy workbench",
    source: import.meta.url,
    frontend: new URL("./dist/legacy-bench.js", import.meta.url),
    backend: () => ({ id: "legacy.backend", setup() {} }),
  });
  registerDesktopToolRenderer(pi, {
    id: "probe-tool",
    toolName: "garden_probe",
    title: "Probe tool",
    source: import.meta.url,
    frontend: new URL("./dist/tool.js", import.meta.url),
    backend: () => ({ id: "probe.backend", setup() {} }),
  });
  registerDesktopToolRenderer(pi, {
    id: "broken-tool",
    toolName: "garden_broken",
    title: "Broken tool",
    source: import.meta.url,
    frontend: new URL("./dist/broken.js", import.meta.url),
    backend: () => ({ id: "broken.backend", setup() {} }),
  });
}
`,
    "utf8",
  );
  await writeFile(
    join(directory, "rich-conflict.ts"),
    `
import { registerRichSurface } from ${JSON.stringify(helperPath)};
export default function richConflict(pi) {
  registerRichSurface(pi, {
    id: "other-header",
    surface: "app-header",
    title: "Other header",
    source: import.meta.url,
    frontend: new URL("./dist/conflict-header.js", import.meta.url),
    backend: () => ({ id: "other.backend", setup() {} }),
  });
}
`,
    "utf8",
  );
  const userDirectory = join(input.agentDir, "extensions");
  await mkdir(join(userDirectory, "dist"), { recursive: true });
  await writeFile(
    join(userDirectory, "dist", "user-settings.js"),
    markModule("user-garden"),
    "utf8",
  );
  const conflictExtensionPath = join(directory, "rich-conflict.ts");
  const userExtensionPath = join(userDirectory, "user-rich.ts");
  await writeFile(
    userExtensionPath,
    `
import { registerRichSurface } from ${JSON.stringify(helperPath)};
export default function userRich(pi) {
  registerRichSurface(pi, {
    id: "user-garden",
    surface: "settings",
    title: "User garden",
    source: import.meta.url,
    frontend: new URL("./dist/user-settings.js", import.meta.url),
    backend: () => ({ id: "user.backend", setup() {} }),
  });
}
`,
    "utf8",
  );
  return { projectExtensionPath, conflictExtensionPath, userExtensionPath };
}

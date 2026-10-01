/**
 * Build the plain-file reference the packaged app ships beside `skills/`.
 *
 * Agents read Pi and Pi Garden docs, API types, and source from here with
 * ordinary tools. Inside app.asar they can only `read` a known path, and
 * electron-builder strips `*.d.ts` files and Pi's examples from it.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const defaultOutputDir = path.join(desktopDir, "build", "reference");

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const PACKAGE_ENTRIES = ["README.md", "CHANGELOG.md", "docs", "examples", "src"];
const GARDEN_EXCLUDED_PREFIXES = ["apps/website/", "video/", "assets/"];
const SKIPPED_FILE_NAMES = new Set(["pnpm-lock.yaml", "npm-shrinkwrap.json"]);
const BINARY_OR_MAP =
  /\.(png|jpe?g|gif|webp|ico|icns|svg|mp4|webm|mov|wasm|node|woff2?|ttf|otf|zip|t?gz|pdf|map)$/i;

/** Files a packaged reference must contain; checked after building and after packaging. */
export const REFERENCE_REQUIRED_FILES = [
  "INDEX.md",
  "packages/@earendil-works/pi-coding-agent/README.md",
  "packages/@earendil-works/pi-coding-agent/docs/extensions.md",
  "packages/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts",
  "packages/@earendil-works/chord/dist/types.d.ts",
  "pi-garden/AGENTS.md",
  "pi-garden/docs/desktop-extension-contract.md",
  "pi-garden/packages/extension-ui/src/index.ts",
  "pi-garden/apps/desktop/electron/main.ts",
];

export function assertReferenceComplete(referenceDir) {
  const missing = REFERENCE_REQUIRED_FILES.filter(
    (file) => !existsSync(path.join(referenceDir, file)),
  );
  if (missing.length > 0) {
    throw new Error(`Reference at ${referenceDir} is missing: ${missing.join(", ")}`);
  }
}

export function buildReference(outputDir = defaultOutputDir) {
  rmSync(outputDir, { recursive: true, force: true });
  const packages = copyPiPackages(path.join(outputDir, "packages"));
  const garden = copyGardenSource(path.join(outputDir, "pi-garden"));
  writeFileSync(path.join(outputDir, "INDEX.md"), indexMarkdown(garden, packages), "utf8");
  assertReferenceComplete(outputDir);
  return outputDir;
}

function copyPiPackages(targetRoot) {
  const piDir = resolvePackageDir(PI_PACKAGE, desktopDir);
  const piManifest = readManifest(piDir);
  const dependencyNames = Object.keys(piManifest.dependencies ?? {}).filter((name) =>
    name.startsWith("@earendil-works/"),
  );
  const packages = [{ name: PI_PACKAGE, dir: piDir }].concat(
    dependencyNames.map((name) => ({ name, dir: resolvePackageDir(name, piDir) })),
  );
  return packages.map(({ name, dir }) => {
    const target = path.join(targetRoot, ...name.split("/"));
    for (const entry of PACKAGE_ENTRIES) {
      copyTree(path.join(dir, entry), path.join(target, entry), isTextFile);
    }
    copyTree(path.join(dir, "dist"), path.join(target, "dist"), (file) => file.endsWith(".d.ts"));
    return { name, version: readManifest(dir).version };
  });
}

function copyGardenSource(target) {
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const file of tracked) {
    if (GARDEN_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    const source = path.join(repoRoot, file);
    if (!isTextFile(source) || !existsSync(source) || !statSync(source).isFile()) continue;
    copyFile(source, path.join(target, file));
  }
  return {
    version: readManifest(desktopDir).version,
    commit: git(["rev-parse", "HEAD"]).trim(),
    dirty: git(["status", "--porcelain"]).trim().length > 0,
  };
}

function copyTree(source, target, include) {
  if (!existsSync(source)) return;
  const stats = statSync(source);
  if (stats.isFile()) {
    if (include(source)) copyFile(source, target);
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(source)) {
    if (entry === "node_modules") continue;
    copyTree(path.join(source, entry), path.join(target, entry), include);
  }
}

function copyFile(source, target) {
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function isTextFile(file) {
  return !BINARY_OR_MAP.test(file) && !SKIPPED_FILE_NAMES.has(path.basename(file));
}

function resolvePackageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", ...name.split("/"));
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    if (path.dirname(dir) === dir) throw new Error(`Cannot resolve ${name} from ${fromDir}`);
  }
}

function readManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function indexMarkdown(garden, packages) {
  const pi = "packages/@earendil-works/pi-coding-agent";
  const commit = `${garden.commit}${garden.dirty ? " with uncommitted changes" : ""}`;
  return `# Pi Garden reference

Plain-file copy of the docs, API types, and source behind this Pi Garden build.
List it with \`ls\`, search it with \`rg\`, read it with \`read\`. It is read-only.

## Versions

- Pi Garden ${garden.version}, commit ${commit}
${packages.map(({ name, version }) => `- ${name} ${version}`).join("\n")}

## Layout

| Path | Contents |
| --- | --- |
| \`pi-garden/\` | Pi Garden source at that commit, without dependencies, media, or the website |
| \`${pi}/\` | Pi README, CHANGELOG, \`docs/\`, \`examples/\`, and \`dist/**/*.d.ts\` |
| \`packages/@earendil-works/<name>/\` | Pi's runtime packages: README, \`src/\` when published, \`dist/**/*.d.ts\` |

## Start here

| Question | Read |
| --- | --- |
| Writing a Pi extension | \`${pi}/docs/extensions.md\`, \`${pi}/dist/core/extensions/types.d.ts\` |
| Pi example extensions | \`${pi}/examples/extensions/\` |
| Pi settings, compaction, sessions | \`${pi}/docs/settings.md\`, \`${pi}/docs/compaction.md\`, \`${pi}/docs/sessions.md\` |
| Pi SDK and TUI | \`${pi}/docs/sdk.md\`, \`${pi}/docs/tui.md\`, \`packages/@earendil-works/pi-tui/dist/\` |
| Chord services and replicated state | \`packages/@earendil-works/chord/dist/types.d.ts\` |
| Pi Garden desktop extensions | \`pi-garden/docs/desktop-extension-contract.md\`, \`pi-garden/packages/extension-ui/src/\` |
| Working desktop extensions | \`pi-garden/examples/desktop-extensions/\` |
| Pi Garden architecture and host code | \`pi-garden/docs/architecture.md\`, \`pi-garden/AGENTS.md\`, \`pi-garden/apps/desktop/\` |
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputDir = buildReference(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`Built reference → ${path.relative(desktopDir, outputDir)}`);
}

import { realpath, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { builtinThemeCatalog, type ThemeCatalogEntry } from "../../contracts/theme-catalog";
import { parseExternalThemeDocument } from "../../contracts/theme-document";
import { isThemePresetId } from "../../contracts/desktop-state";

/**
 * Pi theme resources. User themes live in `PI_CODING_AGENT_DIR/themes` (default
 * `~/.pi/agent/themes`). Project themes live in `<workspace>/.pi/themes` and are
 * loaded only when Pi's trust store allows that project: a project with
 * trust-requiring `.pi` resources is excluded until `trust.json` says yes for
 * the directory or an ancestor. Invalid files are skipped.
 *
 * Pi package themes and npm package themes are not scanned. Pi's `settings.json`
 * theme globs are not reimplemented; exact `!`, `+`, and `-` overrides against
 * `themes/<file>` or the file name are.
 */

const CONFIG_DIR = ".pi";
const TRUST_RESOURCES = [
  "settings.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
];
const MAX_THEME_BYTES = 256 * 1024;

export interface ThemeDiscoveryWorkspace {
  readonly path: string;
}

export async function discoverThemeCatalog(input: {
  readonly agentDir: string;
  readonly workspaces: readonly ThemeDiscoveryWorkspace[];
}): Promise<readonly ThemeCatalogEntry[]> {
  const entries: ThemeCatalogEntry[] = [...builtinThemeCatalog()];
  const seen = new Set(entries.map((entry) => entry.id));
  const userPatterns = await readThemeOverrides(join(input.agentDir, "settings.json"));
  const userThemes = await readThemeDirectory(join(input.agentDir, "themes"), userPatterns);
  for (const theme of userThemes) {
    if (seen.has(theme.id) || isThemePresetId(theme.id)) {
      console.warn(`[theme] skipping user theme ${theme.id}; it collides with a built-in id`);
      continue;
    }
    seen.add(theme.id);
    entries.push({ ...theme, scope: "user" });
  }

  const trust = await readTrustStore(join(input.agentDir, "trust.json"));
  for (const workspace of input.workspaces) {
    if (!(await projectThemesAllowed(workspace.path, trust))) continue;
    const projectPatterns = await readThemeOverrides(
      join(workspace.path, CONFIG_DIR, "settings.json"),
    );
    const projectThemes = await readThemeDirectory(
      join(workspace.path, CONFIG_DIR, "themes"),
      projectPatterns,
    );
    for (const theme of projectThemes) {
      if (isThemePresetId(theme.id)) {
        console.warn(`[theme] skipping project theme ${theme.id}; it collides with a built-in id`);
        continue;
      }
      if (
        entries.some(
          (entry) =>
            entry.scope === "project" &&
            entry.id === theme.id &&
            entry.workspacePath === workspace.path,
        )
      ) {
        console.warn(`[theme] skipping duplicate project theme ${theme.id}`);
        continue;
      }
      entries.push({ ...theme, scope: "project", workspacePath: workspace.path });
    }
  }
  return entries;
}

export function resolveThemeAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  if (!override) return join(homedir(), CONFIG_DIR, "agent");
  return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
}

async function readThemeDirectory(
  directory: string,
  overrides: readonly string[],
): Promise<
  readonly (Omit<ThemeCatalogEntry, "scope" | "workspacePath"> & { readonly sourcePath: string })[]
> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const themes = [];
  for (const name of names.sort()) {
    if (name.startsWith(".") || !name.endsWith(".json")) continue;
    if (!themeFileEnabled(name, overrides)) continue;
    const sourcePath = join(directory, name);
    try {
      const info = await stat(sourcePath);
      if (!info.isFile() || info.size > MAX_THEME_BYTES) continue;
      const raw = await readFile(sourcePath, "utf8");
      const parsed = parseExternalThemeDocument(JSON.parse(stripBom(raw)));
      themes.push({
        id: parsed.id,
        name: parsed.name,
        description: parsed.description,
        sourcePath,
        variants: parsed.variants,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[theme] skipped ${sourcePath}: ${message}`);
    }
  }
  return themes;
}

function themeFileEnabled(fileName: string, patterns: readonly string[]): boolean {
  const relative = `themes/${fileName}`;
  let enabled = true;
  for (const pattern of patterns) {
    const prefix = pattern[0];
    if (prefix !== "!" && prefix !== "+" && prefix !== "-") continue;
    const target = pattern.slice(1).replaceAll("\\", "/").replace(/^\.\//, "");
    const matches = target === fileName || target === relative;
    if (!matches) continue;
    if (prefix === "!") enabled = false;
    else if (prefix === "+") enabled = true;
    else enabled = false;
  }
  return enabled;
}

async function readThemeOverrides(settingsPath: string): Promise<readonly string[]> {
  try {
    const parsed: unknown = JSON.parse(stripBom(await readFile(settingsPath, "utf8")));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    const themes = (parsed as { themes?: unknown }).themes;
    if (!Array.isArray(themes)) return [];
    return themes.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

async function projectThemesAllowed(
  workspacePath: string,
  trust: ReadonlyMap<string, boolean>,
): Promise<boolean> {
  if (!(await hasTrustRequiringResources(workspacePath))) return true;
  let current = await canonicalPath(workspacePath);
  while (true) {
    const decision = trust.get(current);
    if (decision !== undefined) return decision;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function hasTrustRequiringResources(workspacePath: string): Promise<boolean> {
  const configDir = join(workspacePath, CONFIG_DIR);
  for (const entry of TRUST_RESOURCES) {
    try {
      await stat(join(configDir, entry));
      return true;
    } catch {
      // absent
    }
  }
  return false;
}

async function readTrustStore(trustPath: string): Promise<ReadonlyMap<string, boolean>> {
  const decisions = new Map<string, boolean>();
  try {
    const parsed: unknown = JSON.parse(stripBom(await readFile(trustPath, "utf8")));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return decisions;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") {
        decisions.set(await canonicalPath(key), value);
      }
    }
  } catch {
    return decisions;
  }
  return decisions;
}

async function canonicalPath(path: string): Promise<string> {
  const resolved = resolve(path);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

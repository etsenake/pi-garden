import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ResolvedResource } from "@earendil-works/pi-coding-agent";
import { builtinThemeCatalog, type ThemeCatalogEntry } from "../../contracts/theme-catalog";
import { parseExternalThemeDocument } from "../../contracts/theme-document";
import { isThemePresetId } from "../../contracts/desktop-state";
import { projectIsTrusted } from "./project-trust";

/**
 * Theme discovery delegates to Pi 0.87.1's package manager. For each workspace
 * it resolves the same enabled theme files Pi would: `themes/` directories,
 * `settings.json` `themes` files and directories, package `pi.themes` globs,
 * and `!` / `+` / `-` filters. Project resources are included only when Pi's
 * trust store allows that project. Missing npm or git packages are skipped
 * rather than installed. Each enabled file is then parsed by the desktop theme
 * mapping; a file Pi would reject but the mapping accepts (a Garden document)
 * is kept, and a file the mapping cannot represent is skipped.
 *
 * Precedence follows Pi's resolved order: the first theme that maps to an id
 * wins. A project theme is published only when it wins in that workspace, so a
 * later package theme does not hide an earlier user theme. User themes stay in
 * the catalog for workspaces where no project theme won.
 */

const CONFIG_DIR = ".pi";
const MAX_THEME_BYTES = 256 * 1024;

export interface ThemeDiscoveryWorkspace {
  readonly path: string;
}

export async function discoverThemeCatalog(input: {
  readonly agentDir: string;
  readonly workspaces: readonly ThemeDiscoveryWorkspace[];
}): Promise<readonly ThemeCatalogEntry[]> {
  const entries: ThemeCatalogEntry[] = [...builtinThemeCatalog()];
  const parsedByPath = new Map<string, ThemeCatalogEntry | undefined>();
  let userThemesAdded = false;

  for (const workspace of input.workspaces) {
    const trusted = await projectIsTrusted(input.agentDir, workspace.path);
    const resources = await resolveEnabledThemes(input.agentDir, workspace.path, trusted);
    if (!resources) continue;
    if (!userThemesAdded) {
      await appendUserThemes(entries, resources, parsedByPath);
      userThemesAdded = true;
    }
    if (!trusted) continue;
    await appendWinningProjectThemes(entries, resources, workspace.path, parsedByPath);
  }

  if (!userThemesAdded) {
    const resources = await resolveEnabledThemes(input.agentDir, input.agentDir, false);
    if (resources) await appendUserThemes(entries, resources, parsedByPath);
  }
  return entries;
}

export function resolveThemeAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  if (!override) return join(homedir(), CONFIG_DIR, "agent");
  return override.startsWith("~") ? join(homedir(), override.slice(1)) : override;
}

async function resolveEnabledThemes(
  agentDir: string,
  cwd: string,
  projectTrusted: boolean,
): Promise<readonly ResolvedResource[] | undefined> {
  try {
    const { DefaultPackageManager, SettingsManager } =
      await import("@earendil-works/pi-coding-agent");
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    const resolved = await packageManager.resolve(async () => "skip");
    return resolved.themes.filter((theme) => theme.enabled);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[theme] Pi theme resolution failed for ${cwd}: ${message}`);
    return undefined;
  }
}

async function appendUserThemes(
  entries: ThemeCatalogEntry[],
  resources: readonly ResolvedResource[],
  parsedByPath: Map<string, ThemeCatalogEntry | undefined>,
): Promise<void> {
  const seen = new Set(entries.map((entry) => entry.id));
  for (const resource of resources) {
    if (resource.metadata.scope !== "user") continue;
    const theme = await themeFromResource(resource, parsedByPath);
    if (!theme || seen.has(theme.id)) continue;
    seen.add(theme.id);
    entries.push(theme);
  }
}

async function appendWinningProjectThemes(
  entries: ThemeCatalogEntry[],
  resources: readonly ResolvedResource[],
  workspacePath: string,
  parsedByPath: Map<string, ThemeCatalogEntry | undefined>,
): Promise<void> {
  const claimed = new Set<string>();
  for (const resource of resources) {
    const theme = await themeFromResource(resource, parsedByPath);
    if (!theme || claimed.has(theme.id)) continue;
    claimed.add(theme.id);
    if (resource.metadata.scope !== "project") continue;
    const published = entries.some(
      (entry) =>
        entry.scope === "project" && entry.id === theme.id && entry.workspacePath === workspacePath,
    );
    if (published) continue;
    entries.push({ ...theme, scope: "project", workspacePath });
  }
}

async function themeFromResource(
  resource: ResolvedResource,
  parsedByPath: Map<string, ThemeCatalogEntry | undefined>,
): Promise<ThemeCatalogEntry | undefined> {
  if (resource.metadata.scope !== "user" && resource.metadata.scope !== "project") {
    return undefined;
  }
  if (parsedByPath.has(resource.path)) return parsedByPath.get(resource.path);
  const parsed = await readDiscoveredTheme(resource.path);
  if (!parsed || isThemePresetId(parsed.id)) {
    if (parsed && isThemePresetId(parsed.id)) {
      console.warn(`[theme] skipping ${resource.path}; ${parsed.id} collides with a built-in id`);
    }
    parsedByPath.set(resource.path, undefined);
    return undefined;
  }
  const entry: ThemeCatalogEntry = {
    id: parsed.id,
    name: parsed.name,
    description: parsed.description,
    scope: resource.metadata.scope,
    sourcePath: resource.path,
    piResource: {
      source: resource.metadata.source,
      origin: resource.metadata.origin,
      scope: resource.metadata.scope,
    },
    variants: parsed.variants,
  };
  parsedByPath.set(resource.path, entry);
  return entry;
}

async function readDiscoveredTheme(filePath: string) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return undefined;
    if (info.size > MAX_THEME_BYTES) {
      console.warn(`[theme] skipped ${filePath}: larger than ${MAX_THEME_BYTES} bytes`);
      return undefined;
    }
    const raw = await readFile(filePath, "utf8");
    return parseExternalThemeDocument(JSON.parse(stripBom(raw)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[theme] skipped ${filePath}: ${message}`);
    return undefined;
  }
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { RuntimeToolsSettings } from "@pi-garden/session-driver/runtime-types";
import { builtinExtensionPath } from "./builtin-extensions.js";
import { setPiDefaultTools } from "./compat/pi-tools-settings.js";

/** Tools enabled at startup when `defaultTools` does not change them. */
export const DEFAULT_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;

/** Pi built-ins toggled via `-builtin:<name>` / `+builtin:<name>` in `extensions`. */
export const PI_TOGGLEABLE_BUILTIN_NAMES = [
  "mcp",
  "codemode",
  "tool-search",
  "llama.cpp",
] as const;

export type PiToggleableBuiltinName = (typeof PI_TOGGLEABLE_BUILTIN_NAMES)[number];

export function isPiToggleableBuiltinName(name: string): name is PiToggleableBuiltinName {
  return (PI_TOGGLEABLE_BUILTIN_NAMES as readonly string[]).includes(name);
}

export function getToolsSettings(settingsManager: SettingsManager): RuntimeToolsSettings {
  const raw = settingsManager.getSettings().defaultTools;
  const defaultTools =
    Array.isArray(raw) && raw.every((entry) => typeof entry === "string")
      ? [...raw]
      : undefined;
  const resolved = settingsManager.getDefaultTools();
  return {
    defaultTools,
    resolvedDefaultTools: resolved ?? [...DEFAULT_TOOL_NAMES],
    disabledBuiltins: listDisabledBuiltins(settingsManager),
  };
}

export function setDefaultTools(settingsManager: SettingsManager, entries: string[]): void {
  setPiDefaultTools(settingsManager, [...entries]);
}

export function setPiBuiltinEnabled(
  settingsManager: SettingsManager,
  name: string,
  enabled: boolean,
): void {
  if (!isPiToggleableBuiltinName(name)) {
    throw new Error(
      `Unknown Pi built-in "${name}". Expected one of: ${PI_TOGGLEABLE_BUILTIN_NAMES.join(", ")}`,
    );
  }
  const path = builtinExtensionPath(name);
  const globalPaths = [...(settingsManager.getGlobalSettings().extensions ?? [])];
  const next = replaceBuiltinPattern(globalPaths, path, enabled);
  settingsManager.setExtensionPaths(next);
}

function listDisabledBuiltins(settingsManager: SettingsManager): string[] {
  const global = settingsManager.getGlobalSettings().extensions ?? [];
  const project = settingsManager.getProjectSettings().extensions ?? [];
  return PI_TOGGLEABLE_BUILTIN_NAMES.filter((name) => {
    const path = builtinExtensionPath(name);
    const projectDecision = lastForceDecision(project, path);
    if (projectDecision !== undefined) return !projectDecision;
    const globalDecision = lastForceDecision(global, path);
    return globalDecision === false;
  });
}

/** Last `+path` / `-path` wins; plain / `!` patterns do not apply to built-ins here. */
function lastForceDecision(patterns: readonly string[], path: string): boolean | undefined {
  let decision: boolean | undefined;
  for (const pattern of patterns) {
    if (pattern === `+${path}`) decision = true;
    else if (pattern === `-${path}`) decision = false;
  }
  return decision;
}

function replaceBuiltinPattern(
  patterns: readonly string[],
  path: string,
  enabled: boolean,
): string[] {
  const next = patterns.filter((pattern) => stripPrefix(pattern) !== path);
  next.push(`${enabled ? "+" : "-"}${path}`);
  return next;
}

function stripPrefix(pattern: string): string {
  return pattern.startsWith("+") || pattern.startsWith("-") || pattern.startsWith("!")
    ? pattern.slice(1)
    : pattern;
}

export function resolveDefaultTools(entries: readonly string[]): string[] {
  const plain = entries.filter((entry) => !isToolModifier(entry));
  const tools = plain.length > 0 || entries.length === 0 ? [...plain] : [...DEFAULT_TOOL_NAMES];
  for (const entry of entries) {
    if (!isToolModifier(entry)) continue;
    const name = entry.slice(1);
    const index = tools.indexOf(name);
    if (entry.startsWith("+") && index === -1 && name) tools.push(name);
    else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
  }
  return tools;
}

function isToolModifier(entry: string): boolean {
  return entry.startsWith("+") || entry.startsWith("-");
}

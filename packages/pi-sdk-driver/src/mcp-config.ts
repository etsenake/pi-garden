/**
 * Thin CRUD over Pi's mcp.json files. Reimplemented here because Pi's load/add/update/remove
 * helpers are not part of the public package surface.
 *
 * Paths: `{agentDir}/mcp.json` (global) and `{cwd}/.pi/mcp.json` (project, when trusted).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpExposure, McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { DesktopMcpServerRecord } from "@pi-garden/session-driver/runtime-types";

export type { DesktopMcpServerRecord };
export type DesktopMcpScope = DesktopMcpServerRecord["scope"];
export type DesktopMcpExposure = NonNullable<DesktopMcpServerRecord["exposure"]>;
export type DesktopMcpServerConfig = McpServerConfig;

export interface DesktopMcpConfigPatch {
  readonly enabled?: boolean;
  readonly exposure?: McpExposure;
}

export interface LoadedDesktopMcpConfig {
  readonly servers: readonly DesktopMcpServerRecord[];
  readonly autoEnableCodemode?: boolean;
  readonly errors: readonly string[];
}

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const MCP_EXPOSURES: readonly McpExposure[] = [
  "codemode",
  "codemode-deferred",
  "deferred",
  "direct",
  "hidden",
];

export function desktopMcpConfigPath(
  agentDir: string,
  cwd: string,
  scope: DesktopMcpScope,
): string {
  return scope === "global" ? join(agentDir, "mcp.json") : join(cwd, ".pi", "mcp.json");
}

export function loadDesktopMcpConfig(options: {
  readonly agentDir: string;
  readonly cwd: string;
  readonly projectTrusted: boolean;
}): LoadedDesktopMcpConfig {
  const servers = new Map<string, DesktopMcpServerRecord>();
  const errors: string[] = [];
  let autoEnableCodemode: boolean | undefined;

  const readFile = (path: string, scope: DesktopMcpScope): void => {
    if (!existsSync(path)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
      errors.push(`${path}: expected an object with an "mcpServers" object`);
      return;
    }
    if (typeof parsed.autoEnableCodemode === "boolean") {
      autoEnableCodemode = parsed.autoEnableCodemode;
    } else if (parsed.autoEnableCodemode !== undefined) {
      errors.push(`${path}: autoEnableCodemode must be a boolean`);
    }
    for (const [name, value] of Object.entries(parsed.mcpServers ?? {})) {
      const validated = validateDesktopMcpServerConfig(name, value);
      if (typeof validated === "string") {
        errors.push(`${path}: ${validated}`);
        continue;
      }
      servers.set(name, toDesktopMcpServerRecord(name, validated, path, scope));
    }
  };

  readFile(desktopMcpConfigPath(options.agentDir, options.cwd, "global"), "global");
  if (options.projectTrusted) {
    readFile(desktopMcpConfigPath(options.agentDir, options.cwd, "project"), "project");
  }

  return {
    servers: [...servers.values()],
    ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }),
    errors,
  };
}

export function addMcpServer(
  path: string,
  name: string,
  config: DesktopMcpServerConfig,
): boolean {
  const validated = validateDesktopMcpServerConfig(name, config);
  if (typeof validated === "string") {
    throw new Error(validated);
  }
  let replaced = false;
  editMcpServers(path, (servers, parsed) => {
    const target = servers ?? {};
    replaced = target[name] !== undefined;
    target[name] = validated;
    parsed.mcpServers = target;
    return true;
  });
  return replaced;
}

export function removeMcpServer(path: string, name: string): boolean {
  if (!existsSync(path)) return false;
  let removed = false;
  editMcpServers(path, (servers) => {
    if (!servers || servers[name] === undefined) return false;
    delete servers[name];
    removed = true;
    return true;
  });
  return removed;
}

export function updateMcpServer(
  path: string,
  name: string,
  patch: DesktopMcpConfigPatch,
): void {
  editMcpServers(path, (servers) => {
    const server = servers?.[name];
    if (!isRecord(server)) {
      throw new Error(`${path} does not define MCP server "${name}"`);
    }
    if (patch.enabled !== undefined) {
      if (patch.enabled) delete server.enabled;
      else server.enabled = false;
    }
    if (patch.exposure !== undefined) {
      if (patch.exposure === "codemode") delete server.exposure;
      else server.exposure = patch.exposure;
    }
    return true;
  });
}

export function validateDesktopMcpServerConfig(
  name: string,
  value: unknown,
): McpServerConfig | string {
  if (!SERVER_NAME.test(name)) {
    return `invalid server name "${name}" (use letters, digits, "_" and "-")`;
  }
  if (!isRecord(value)) return `server "${name}" must be an object`;

  const { type, exposure, enabled, timeout, toolExposure } = value;
  if (exposure !== undefined && !isExposure(exposure)) {
    return `server "${name}": exposure must be one of ${MCP_EXPOSURES.join(", ")}`;
  }
  if (toolExposure !== undefined) {
    if (!isRecord(toolExposure)) {
      return `server "${name}": toolExposure must map tool names to exposures`;
    }
    for (const [tool, toolValue] of Object.entries(toolExposure)) {
      if (!isExposure(toolValue)) {
        return `server "${name}": toolExposure "${tool}" must be one of ${MCP_EXPOSURES.join(", ")}`;
      }
    }
  }
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return `server "${name}": enabled must be a boolean`;
  }
  if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
    return `server "${name}": timeout must be a positive number of seconds`;
  }
  if (type === "sse") {
    return `server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`;
  }

  if (
    typeof value.url === "string" &&
    (type === undefined || type === "http" || type === "streamable-http")
  ) {
    if (!URL.canParse(value.url) || !/^https?:$/.test(new URL(value.url).protocol)) {
      return `server "${name}": url must be an http or https URL`;
    }
    if (value.headers !== undefined && !isStringRecord(value.headers)) {
      return `server "${name}": headers must map names to strings`;
    }
    if (value.oauth !== undefined && !isRecord(value.oauth)) {
      return `server "${name}": oauth must be an object`;
    }
    return value as unknown as McpServerConfig;
  }

  if (typeof value.command === "string" && (type === undefined || type === "stdio")) {
    if (
      value.args !== undefined &&
      !(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"))
    ) {
      return `server "${name}": args must be an array of strings`;
    }
    if (value.env !== undefined && !isStringRecord(value.env)) {
      return `server "${name}": env must map names to strings`;
    }
    if (value.cwd !== undefined && typeof value.cwd !== "string") {
      return `server "${name}": cwd must be a string`;
    }
    return value as unknown as McpServerConfig;
  }

  return `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`;
}

function toDesktopMcpServerRecord(
  name: string,
  config: McpServerConfig,
  sourcePath: string,
  scope: DesktopMcpScope,
): DesktopMcpServerRecord {
  return {
    name,
    scope,
    enabled: config.enabled !== false,
    exposure: config.exposure ?? "codemode",
    transport: summarizeMcpTransport(config),
    sourcePath,
  };
}

function summarizeMcpTransport(config: McpServerConfig): string {
  if ("url" in config && typeof config.url === "string") {
    return `http ${config.url}`;
  }
  const stdio = config as { command: string; args?: string[] };
  const args = stdio.args?.length ? ` ${stdio.args.join(" ")}` : "";
  return `stdio ${stdio.command}${args}`;
}

function editMcpServers(
  path: string,
  edit: (
    servers: Record<string, unknown> | undefined,
    parsed: Record<string, unknown>,
  ) => boolean,
): void {
  const text = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const parsed: unknown = text === undefined ? {} : JSON.parse(text);
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
    throw new Error(`${path}: expected an object with an "mcpServers" object`);
  }
  const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : undefined;
  if (!edit(servers, parsed)) return;
  const indent = (text && /^([ \t]+)\S/m.exec(text)?.[1]) || "  ";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed, null, indent)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isExposure(value: unknown): value is McpExposure {
  return typeof value === "string" && (MCP_EXPOSURES as readonly string[]).includes(value);
}

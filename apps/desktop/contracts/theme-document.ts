import {
  contrastRatio,
  parseHex,
  syntaxThemeIds,
  type SyntaxThemeId,
  type ThemeSeed,
} from "./theme";
import { isThemeId } from "./desktop-state";

/*
 * External themes are data files in Pi's theme directories. Two documents are
 * accepted:
 *
 * 1. `pi-garden.theme/v1` — the seed model the desktop already derives tokens
 *    from, including an explicit syntax theme. Pi's own theme schema rejects
 *    this document (`additionalProperties: false` and a required `colors` map),
 *    so the Pi CLI reports it as an invalid theme. Pi Garden still loads it.
 * 2. A Pi 0.87.1 theme (`name` + `colors`, optional `vars` and `export`). Pi
 *    does not carry a desktop seed or a Shiki theme id, so the six seed colours
 *    are taken from the closest Pi roles and the syntax theme falls back to the
 *    bundled GitHub theme for the detected variant. 256-colour indexes are
 *    converted to hex. An empty string (terminal default) cannot seed a colour.
 */

export const GARDEN_THEME_FORMAT = "pi-garden.theme/v1";

export interface ExternalThemeVariant {
  readonly seed: ThemeSeed;
  readonly syntaxTheme: SyntaxThemeId;
}

export interface ParsedExternalTheme {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly origin: "garden" | "pi";
  readonly variants: {
    readonly light?: ExternalThemeVariant;
    readonly dark?: ExternalThemeVariant;
  };
}

const SEED_KEYS = ["surface", "ink", "accent", "added", "removed", "warning"] as const;

const PI_OPTIONAL_COLOR_KEYS = [
  "scrollbarTrack",
  "scrollbarThumb",
  "searchMatchBg",
  "searchMatchText",
  "thinkingMax",
] as const;

const PI_COLOR_KEYS = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "scrollbarTrack",
  "scrollbarThumb",
  "selectedBg",
  "searchMatchBg",
  "searchMatchText",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "thinkingMax",
  "bashMode",
] as const;

const PI_TOP_KEYS = ["$schema", "name", "vars", "colors", "export"] as const;
const EXPORT_KEYS = ["pageBg", "cardBg", "infoBg"] as const;

const CUBE = [0, 95, 135, 175, 215, 255] as const;
const ANSI_16 = [
  "#000000",
  "#cd3131",
  "#0dbc79",
  "#e5e510",
  "#2472c8",
  "#bc3fbc",
  "#11a8cd",
  "#e5e5e5",
  "#666666",
  "#f14c4c",
  "#23d18b",
  "#f5f543",
  "#3b8eea",
  "#d670d6",
  "#29b8db",
  "#ffffff",
] as const;

export function parseExternalThemeDocument(value: unknown): ParsedExternalTheme {
  const record = objectRecord(value);
  if (!record) {
    throw new Error("Theme document must be a JSON object");
  }
  if (record.format === GARDEN_THEME_FORMAT) {
    return parseGardenTheme(record);
  }
  if ("format" in record) {
    throw new Error("Unsupported theme format");
  }
  return parsePiTheme(record);
}

function parseGardenTheme(record: Record<string, unknown>): ParsedExternalTheme {
  assertExactKeys(record, ["format", "id", "name", "description", "variants"], "theme");
  if (!isThemeId(record.id)) {
    throw new Error(
      "Theme id must be 1-80 characters without slashes, colons, or control characters",
    );
  }
  const name = requireText(record.name, "name", 80);
  const description =
    record.description === undefined ? "" : requireText(record.description, "description", 240);
  const variantsRecord = objectRecord(record.variants);
  if (!variantsRecord) {
    throw new Error("Theme variants must be an object");
  }
  assertExactKeys(variantsRecord, ["light", "dark"], "variants");
  const light =
    variantsRecord.light === undefined ? undefined : parseVariant(variantsRecord.light, "light");
  const dark =
    variantsRecord.dark === undefined ? undefined : parseVariant(variantsRecord.dark, "dark");
  if (!light && !dark) {
    throw new Error("Theme must include a light or dark variant");
  }
  return {
    id: record.id,
    name,
    description,
    origin: "garden",
    variants: { ...(light ? { light } : {}), ...(dark ? { dark } : {}) },
  };
}

function parseVariant(value: unknown, label: string): ExternalThemeVariant {
  const record = objectRecord(value);
  if (!record) {
    throw new Error(`Theme variant ${label} must be an object`);
  }
  assertExactKeys(record, ["seed", "syntaxTheme"], label);
  const seedRecord = objectRecord(record.seed);
  if (!seedRecord) {
    throw new Error(`Theme variant ${label} seed must be an object`);
  }
  assertExactKeys(seedRecord, SEED_KEYS, `${label} seed`);
  const seed = {
    surface: requireHex(seedRecord.surface, `${label} surface`),
    ink: requireHex(seedRecord.ink, `${label} ink`),
    accent: requireHex(seedRecord.accent, `${label} accent`),
    added: requireHex(seedRecord.added, `${label} added`),
    removed: requireHex(seedRecord.removed, `${label} removed`),
    warning: requireHex(seedRecord.warning, `${label} warning`),
  };
  assertSeedContrast(seed, label);
  if (!isSyntaxThemeId(record.syntaxTheme)) {
    throw new Error(`Theme variant ${label} syntaxTheme is not a bundled syntax theme`);
  }
  return { seed, syntaxTheme: record.syntaxTheme };
}

function parsePiTheme(record: Record<string, unknown>): ParsedExternalTheme {
  assertExactKeys(record, PI_TOP_KEYS, "theme");
  if (typeof record.name !== "string" || !isThemeId(record.name)) {
    throw new Error("Pi theme name must be a theme id without slashes or colons");
  }
  const colors = objectRecord(record.colors);
  if (!colors) {
    throw new Error("Pi theme colors must be an object");
  }
  assertExactKeys(colors, PI_COLOR_KEYS, "colors");
  const optionalColors = new Set<string>(PI_OPTIONAL_COLOR_KEYS);
  for (const key of PI_COLOR_KEYS) {
    if (optionalColors.has(key)) continue;
    if (colors[key] === undefined) {
      throw new Error(`Pi theme is missing required color ${key}`);
    }
  }
  const vars = record.vars === undefined ? {} : objectRecord(record.vars);
  if (!vars) {
    throw new Error("Pi theme vars must be an object");
  }
  for (const [key, value] of Object.entries(vars)) {
    if (!isPiColorValue(value)) {
      throw new Error(`Pi theme var ${key} must be a hex colour, palette index, or variable name`);
    }
  }
  const exported = record.export === undefined ? {} : objectRecord(record.export);
  if (!exported) {
    throw new Error("Pi theme export must be an object");
  }
  assertExactKeys(exported, EXPORT_KEYS, "export");

  const resolve = (key: string, source: Record<string, unknown>): string | undefined => {
    if (source[key] === undefined) return undefined;
    return resolvePiColor(source[key], vars, []);
  };
  const surface =
    resolve("pageBg", exported) ??
    resolve("toolPendingBg", colors) ??
    resolve("userMessageBg", colors);
  const ink = resolve("text", colors);
  const accent = resolve("accent", colors);
  const added = resolve("success", colors);
  const removed = resolve("error", colors);
  const warning = resolve("warning", colors);
  if (!surface || !ink || !accent || !added || !removed || !warning) {
    throw new Error(
      "Pi theme is missing a resolvable surface, text, accent, success, error, or warning colour",
    );
  }
  const seed = { surface, ink, accent, added, removed, warning };
  const variant = relativeLuminance(surface) > relativeLuminance(ink) ? "light" : "dark";
  assertSeedContrast(seed, variant);
  const syntaxTheme: SyntaxThemeId =
    variant === "light" ? "github-light-default" : "github-dark-default";
  return {
    id: record.name,
    name: record.name,
    description: `Pi theme. Syntax highlighting uses the bundled ${syntaxTheme} theme.`,
    origin: "pi",
    variants: { [variant]: { seed, syntaxTheme } },
  };
}

function resolvePiColor(
  value: unknown,
  vars: Record<string, unknown>,
  stack: readonly string[],
): string | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= 255 ? color256ToHex(value) : undefined;
  }
  if (typeof value !== "string" || value === "") return undefined;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (stack.includes(value) || !Object.hasOwn(vars, value)) return undefined;
  return resolvePiColor(vars[value], vars, [...stack, value]);
}

function isPiColorValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 255;
  if (typeof value !== "string") return false;
  if (value === "" || /^#[0-9a-f]{6}$/i.test(value)) return true;
  return isThemeId(value) || /^[A-Za-z][\w-]*$/.test(value);
}

export function color256ToHex(index: number): string {
  if (index < 16) return ANSI_16[index]!;
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    const hex = level.toString(16).padStart(2, "0");
    return `#${hex}${hex}${hex}`;
  }
  const cube = index - 16;
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  const red = CUBE[Math.floor(cube / 36)]!;
  const green = CUBE[Math.floor((cube % 36) / 6)]!;
  const blue = CUBE[cube % 6]!;
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function assertSeedContrast(seed: ThemeSeed, label: string): void {
  if (contrastRatio(seed.surface, seed.ink) < 3) {
    throw new Error(`Theme variant ${label} surface and ink must contrast at least 3:1`);
  }
}

function relativeLuminance(color: string): number {
  const [r, g, b] = parseHex(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function requireHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${label} must be a #rrggbb colour`);
  }
  return value.toLowerCase();
}

function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value !== value.trim()) {
    throw new Error(`${label} must be 1-${max} characters`);
  }
  return value;
}

function isSyntaxThemeId(value: unknown): value is SyntaxThemeId {
  return typeof value === "string" && syntaxThemeIds.includes(value as SyntaxThemeId);
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype" ||
      !allowed.includes(key)
    ) {
      throw new Error(`Unsupported ${label} field ${key}`);
    }
  }
}

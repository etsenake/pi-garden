import {
  defaultThemePresetId,
  isThemeId,
  isThemePresetId,
  type ThemeSelectionScope,
} from "./desktop-state";
import {
  deriveThemeTokens,
  themePresets,
  type ResolvedTheme,
  type SyntaxThemeId,
  type ThemeSeed,
  type ThemeTokens,
} from "./theme";

/**
 * One discovered or built-in theme after validation. Built-ins and external
 * files share this shape; tokens are still derived from the seed.
 */
/** Provenance copied from Pi 0.87.1 `PathMetadata` after package resolution. */
export interface ThemeResourceProvenance {
  readonly source: string;
  readonly origin: "package" | "top-level";
  readonly scope: "user" | "project";
}

export interface ThemeCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly scope: ThemeSelectionScope;
  readonly sourcePath?: string;
  readonly workspacePath?: string;
  /** Set for themes Pi resolved. Distinguishes a package resource from a directory or settings path. */
  readonly piResource?: ThemeResourceProvenance;
  readonly variants: {
    readonly light?: ThemeVariantDefinition;
    readonly dark?: ThemeVariantDefinition;
  };
}

export interface ThemeVariantDefinition {
  readonly seed: ThemeSeed;
  readonly syntaxTheme: SyntaxThemeId;
}

export interface ThemeSelection {
  readonly id: string;
  readonly scope: ThemeSelectionScope;
  readonly workspacePath?: string;
}

/** Browser-safe snapshot extension UI can read without Electron. */
export interface DesktopThemeSnapshot {
  readonly id: string;
  readonly name: string;
  readonly variant: ResolvedTheme;
  readonly syntaxTheme: SyntaxThemeId;
  readonly tokens: Readonly<Record<string, string>>;
  readonly seed: ThemeSeed;
}

export interface PresentedTheme {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly variant: ResolvedTheme;
  readonly tokens: ThemeTokens;
  readonly syntaxTheme: SyntaxThemeId;
  readonly seed: ThemeSeed;
}

export function builtinThemeCatalog(): readonly ThemeCatalogEntry[] {
  return themePresets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    scope: "builtin" as const,
    variants: preset.variants,
  }));
}

export function themesForWorkspace(
  catalog: readonly ThemeCatalogEntry[],
  workspacePath: string | undefined,
): readonly ThemeCatalogEntry[] {
  const project = catalog.filter(
    (entry) => entry.scope === "project" && entry.workspacePath === workspacePath,
  );
  const projectIds = new Set(project.map((entry) => entry.id));
  const user = catalog.filter((entry) => entry.scope === "user" && !projectIds.has(entry.id));
  const builtin = catalog.filter((entry) => entry.scope === "builtin");
  return [...builtin, ...user, ...project];
}

export function effectiveThemeId(
  catalog: readonly ThemeCatalogEntry[],
  selection: ThemeSelection,
  workspacePath: string | undefined,
): string {
  if (selection.scope === "project") {
    const match = catalog.find(
      (entry) =>
        entry.scope === "project" &&
        entry.id === selection.id &&
        entry.workspacePath === selection.workspacePath &&
        entry.workspacePath === workspacePath,
    );
    return match ? match.id : defaultThemePresetId;
  }
  const visible = themesForWorkspace(catalog, workspacePath);
  const match = visible.find(
    (entry) =>
      entry.id === selection.id &&
      (entry.scope === selection.scope ||
        (selection.scope === "builtin" && entry.scope === "builtin")),
  );
  if (match) return match.id;
  if (isThemePresetId(selection.id)) return selection.id;
  return defaultThemePresetId;
}

export function reconcileThemeSelection(
  catalog: readonly ThemeCatalogEntry[],
  selection: ThemeSelection,
): { readonly selection: ThemeSelection; readonly fellBack: boolean } {
  if (isThemePresetId(selection.id)) {
    return {
      selection: { id: selection.id, scope: "builtin" },
      fellBack: selection.scope !== "builtin",
    };
  }
  if (selection.scope === "project") {
    const match = catalog.find(
      (entry) =>
        entry.scope === "project" &&
        entry.id === selection.id &&
        entry.workspacePath === selection.workspacePath,
    );
    if (match) return { selection, fellBack: false };
    return { selection: { id: defaultThemePresetId, scope: "builtin" }, fellBack: true };
  }
  const user = catalog.find((entry) => entry.scope === "user" && entry.id === selection.id);
  if (user)
    return { selection: { id: user.id, scope: "user" }, fellBack: selection.scope !== "user" };
  return { selection: { id: defaultThemePresetId, scope: "builtin" }, fellBack: true };
}

export function presentTheme(
  catalog: readonly ThemeCatalogEntry[],
  themeId: string,
  preferred: ResolvedTheme,
): PresentedTheme {
  const entry =
    catalog.find((candidate) => candidate.id === themeId) ??
    builtinThemeCatalog().find((candidate) => candidate.id === themeId) ??
    builtinThemeCatalog()[0]!;
  const variant = entry.variants[preferred] ? preferred : entry.variants.dark ? "dark" : "light";
  const definition = entry.variants[variant] ?? themePresets[0]!.variants[variant];
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    variant,
    seed: definition.seed,
    syntaxTheme: definition.syntaxTheme,
    tokens: deriveThemeTokens(definition.seed, variant),
  };
}

export function themeSnapshot(theme: PresentedTheme): DesktopThemeSnapshot {
  return {
    id: theme.id,
    name: theme.name,
    variant: theme.variant,
    syntaxTheme: theme.syntaxTheme,
    seed: theme.seed,
    tokens: { ...theme.tokens },
  };
}

export function swatchesForTheme(theme: PresentedTheme): readonly string[] {
  return [
    theme.tokens["--sidebar"]!,
    theme.tokens["--main"]!,
    theme.tokens["--accent"]!,
    theme.tokens["--text-strong"]!,
  ];
}

export function isSelectableThemeId(value: unknown): value is string {
  return isThemeId(value);
}

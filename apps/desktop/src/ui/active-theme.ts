import { useSyncExternalStore } from "react";
import { defaultThemePresetId, isThemePresetId } from "../../contracts/desktop-state";
import type { PresentedTheme } from "../../contracts/theme-catalog";
import {
  presentTheme,
  builtinThemeCatalog,
  type ThemeCatalogEntry,
} from "../../contracts/theme-catalog";
import type { ResolvedTheme, SyntaxThemeId, ThemeSeed, ThemeTokens } from "../../contracts/theme";

/*
 * The one place the renderer's theme is applied. `applyTheme` writes every
 * derived token as a CSS variable; components that cannot read CSS (the
 * terminal, the syntax highlighter, extension views) subscribe with
 * `useActiveTheme`.
 */

export interface ActiveTheme {
  readonly id: string;
  readonly name: string;
  readonly variant: ResolvedTheme;
  readonly tokens: ThemeTokens;
  readonly syntaxTheme: SyntaxThemeId;
  readonly seed: ThemeSeed;
}

const STYLE_ELEMENT_ID = "pi-theme";
// Remembers the last theme so the next launch paints it before state loads.
const LAST_THEME_KEY = "pi-garden.last-theme";

let active: ActiveTheme = toActiveTheme(
  presentTheme(builtinThemeCatalog(), defaultThemePresetId, "light"),
);
const listeners = new Set<() => void>();

export function applyPresentedTheme(theme: PresentedTheme): void {
  const next = toActiveTheme(theme);
  if (!sameTheme(active, next) || !styleElement()) {
    active = next;
    writeTokens(active);
    for (const listener of listeners) listener();
  }
  try {
    localStorage.setItem(LAST_THEME_KEY, `${theme.id}:${theme.variant}`);
  } catch {
    // Storage can be unavailable; the next launch then starts from Default.
  }
}

/** Applies a built-in theme saved by the previous launch, or Default light. */
export function applyLastTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LAST_THEME_KEY);
  } catch {
    saved = null;
  }
  const separator = saved?.lastIndexOf(":") ?? -1;
  const presetId = separator > 0 ? saved?.slice(0, separator) : undefined;
  const variant = separator > 0 ? saved?.slice(separator + 1) : undefined;
  applyPresentedTheme(
    presentTheme(
      builtinThemeCatalog(),
      isThemePresetId(presetId) ? presetId : defaultThemePresetId,
      variant === "dark" ? "dark" : "light",
    ),
  );
}

export function useActiveTheme(): ActiveTheme {
  return useSyncExternalStore(subscribe, getActiveTheme);
}

export function getActiveTheme(): ActiveTheme {
  return active;
}

export function activeThemeFromCatalog(
  catalog: readonly ThemeCatalogEntry[],
  themeId: string,
  preferred: ResolvedTheme,
): PresentedTheme {
  return presentTheme(catalog, themeId, preferred);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function toActiveTheme(theme: PresentedTheme): ActiveTheme {
  return {
    id: theme.id,
    name: theme.name,
    variant: theme.variant,
    tokens: theme.tokens,
    syntaxTheme: theme.syntaxTheme,
    seed: theme.seed,
  };
}

function sameTheme(left: ActiveTheme, right: ActiveTheme): boolean {
  return (
    left.id === right.id &&
    left.variant === right.variant &&
    left.syntaxTheme === right.syntaxTheme &&
    left.tokens["--main"] === right.tokens["--main"] &&
    left.tokens["--accent"] === right.tokens["--accent"] &&
    left.tokens["--text-strong"] === right.tokens["--text-strong"] &&
    left.tokens["--sidebar"] === right.tokens["--sidebar"]
  );
}

function styleElement(): HTMLStyleElement | null {
  return document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
}

function writeTokens(theme: ActiveTheme): void {
  const root = document.documentElement;
  let element = styleElement();
  if (!element) {
    element = document.createElement("style");
    element.id = STYLE_ELEMENT_ID;
    document.head.append(element);
  }
  const declarations = Object.entries(theme.tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  element.textContent = `:root {\n  color-scheme: ${theme.variant};\n${declarations}\n}\n`;
  root.classList.toggle("dark", theme.variant === "dark");
  root.dataset.themePreset = theme.id;
}

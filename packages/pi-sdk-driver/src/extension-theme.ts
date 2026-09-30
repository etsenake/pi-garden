import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Pi's `Theme` formatters emit 16-colour SGR roles. The desktop ANSI parser maps
 * those roles onto semantic tokens (`blue` → accent, `red` → error, …), so
 * status and widget text follows the active Pi Garden palette without truecolor
 * terminal emulation. A formatter does not embed another theme's hex: Pi theme
 * files have no desktop seed, and arbitrary `Theme` instances are not applied.
 */

export interface HostThemeCatalogEntry {
  readonly name: string;
  readonly path?: string;
}

export interface HostThemePort {
  refresh(): Promise<void>;
  listThemes(workspacePath: string): readonly HostThemeCatalogEntry[];
  activeThemeName(workspacePath: string): string;
  setTheme(
    workspacePath: string,
    name: string,
  ): { readonly success: boolean; readonly error?: string };
}

const FOREGROUND: Record<ThemeColor, number> = {
  accent: 4,
  border: 8,
  borderAccent: 4,
  borderMuted: 8,
  success: 2,
  error: 1,
  warning: 3,
  muted: 8,
  dim: 8,
  text: 15,
  thinkingText: 8,
  scrollbarTrack: 8,
  scrollbarThumb: 7,
  searchMatchText: 15,
  userMessageText: 15,
  customMessageText: 15,
  customMessageLabel: 4,
  toolTitle: 15,
  toolOutput: 7,
  mdHeading: 15,
  mdLink: 4,
  mdLinkUrl: 6,
  mdCode: 6,
  mdCodeBlock: 6,
  mdCodeBlockBorder: 8,
  mdQuote: 8,
  mdQuoteBorder: 8,
  mdHr: 8,
  mdListBullet: 4,
  toolDiffAdded: 2,
  toolDiffRemoved: 1,
  toolDiffContext: 8,
  syntaxComment: 8,
  syntaxKeyword: 5,
  syntaxFunction: 6,
  syntaxVariable: 15,
  syntaxString: 2,
  syntaxNumber: 3,
  syntaxType: 4,
  syntaxOperator: 7,
  syntaxPunctuation: 7,
  thinkingOff: 8,
  thinkingMinimal: 6,
  thinkingLow: 2,
  thinkingMedium: 3,
  thinkingHigh: 4,
  thinkingXhigh: 12,
  thinkingMax: 12,
  bashMode: 3,
};

const BACKGROUND = {
  selectedBg: 4,
  searchMatchBg: 3,
  userMessageBg: 8,
  customMessageBg: 8,
  toolPendingBg: 8,
  toolSuccessBg: 2,
  toolErrorBg: 1,
};

export function createSemanticTheme(name: string): Theme {
  return new Theme(FOREGROUND, BACKGROUND, "truecolor", { name });
}

/**
 * Pi's extension runner copies the UI context with an object spread, which
 * reads `ctx.ui.theme` once per session. Pi's own TUI survives that because its
 * `theme` export is one mutable object; mirror that by handing out a single
 * `Theme` whose `name` resolves against the desktop selection on every read.
 */
export function createLiveTheme(currentName: () => string): Theme {
  const theme = createSemanticTheme(currentName());
  Object.defineProperty(theme, "name", { get: currentName, enumerable: true });
  return theme;
}

export function themeCatalogForExtension(
  port: HostThemePort | undefined,
  workspacePath: string,
): { readonly name: string; readonly path: string | undefined }[] {
  const themes = port?.listThemes(workspacePath) ?? [];
  return themes
    .map((theme) => ({ name: theme.name, path: theme.path }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function setExtensionTheme(
  port: HostThemePort | undefined,
  workspacePath: string,
  theme: string | { readonly name?: string },
): { success: boolean; error?: string } {
  const name = typeof theme === "string" ? theme : theme.name;
  if (!name) {
    return {
      success: false,
      error: "Theme cannot be represented by the desktop theme system",
    };
  }
  if (!port) {
    return { success: false, error: "Theme switching is unavailable" };
  }
  return port.setTheme(workspacePath, name);
}

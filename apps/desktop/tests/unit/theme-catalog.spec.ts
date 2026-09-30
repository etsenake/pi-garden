import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { decodePersistedUiState } from "../../electron/persistence/app-store-persistence";
import { discoverThemeCatalog } from "../../electron/platform/theme-resources";
import { themePresetIds } from "../../contracts/desktop-state";
import { themeTokensFor } from "../../contracts/theme";
import {
  builtinThemeCatalog,
  effectiveThemeId,
  presentTheme,
  reconcileThemeSelection,
  themesForWorkspace,
} from "../../contracts/theme-catalog";
import { color256ToHex, parseExternalThemeDocument } from "../../contracts/theme-document";

const harbor = {
  format: "pi-garden.theme/v1",
  id: "harbor",
  name: "Harbor",
  description: "Cool coastal neutrals.",
  variants: {
    dark: {
      seed: {
        surface: "#0b1d2a",
        ink: "#d6e4ee",
        accent: "#7eb6d6",
        added: "#3fb950",
        removed: "#f85149",
        warning: "#d29922",
      },
      syntaxTheme: "github-dark-default",
    },
    light: {
      seed: {
        surface: "#f3f7fa",
        ink: "#1a2a33",
        accent: "#0b6e99",
        added: "#1a7f37",
        removed: "#cf222e",
        warning: "#9a6700",
      },
      syntaxTheme: "github-light-default",
    },
  },
};

const requiredPiColors = [
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
  "selectedBg",
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
  "bashMode",
];

function piTheme(overrides: Record<string, unknown> = {}) {
  const colors: Record<string, unknown> = {};
  for (const key of requiredPiColors) colors[key] = "#888888";
  return {
    name: "tide",
    vars: { sea: "#2472c8" },
    export: { pageBg: "#102030" },
    colors: {
      ...colors,
      accent: "sea",
      text: "#d0d8e0",
      success: "#3fb950",
      error: "#f85149",
      warning: 3,
      ...overrides,
    },
  };
}

test("garden and Pi theme documents feed the same seed model", () => {
  const garden = parseExternalThemeDocument(harbor);
  expect(garden.id).toBe("harbor");
  expect(garden.variants.light?.syntaxTheme).toBe("github-light-default");
  expect(garden.variants.dark?.seed.accent).toBe("#7eb6d6");

  const pi = parseExternalThemeDocument(piTheme());
  expect(pi.origin).toBe("pi");
  expect(pi.variants.dark?.seed).toMatchObject({
    surface: "#102030",
    ink: "#d0d8e0",
    accent: "#2472c8",
    warning: color256ToHex(3),
  });
  expect(pi.variants.dark?.syntaxTheme).toBe("github-dark-default");
  expect(pi.variants.light).toBeUndefined();
  expect(color256ToHex(196)).toMatch(/^#[0-9a-f]{6}$/);
});

test("malformed theme documents are rejected", () => {
  expect(() => parseExternalThemeDocument({ ...harbor, id: "bad/id" })).toThrow(/id/);
  expect(() => parseExternalThemeDocument({ ...harbor, css: "body{}" })).toThrow(/Unsupported/);
  expect(() =>
    parseExternalThemeDocument({
      ...harbor,
      variants: {
        dark: {
          ...harbor.variants.dark,
          seed: { ...harbor.variants.dark.seed, surface: "#111111", ink: "#121212" },
        },
      },
    }),
  ).toThrow(/contrast/);
  expect(() => parseExternalThemeDocument(piTheme({ text: "" }))).toThrow(/surface, text, accent/);
  expect(() => parseExternalThemeDocument(piTheme({ invented: "#ffffff" }))).toThrow(/Unsupported/);
  expect(() => parseExternalThemeDocument({ format: "theme/v2" })).toThrow(
    /Unsupported theme format/,
  );
});

test("built-in themes keep their palettes through the shared catalog", () => {
  const catalog = builtinThemeCatalog();
  expect(catalog.map((entry) => entry.id)).toEqual([...themePresetIds]);
  for (const id of themePresetIds) {
    for (const variant of ["light", "dark"] as const) {
      expect(presentTheme(catalog, id, variant).tokens).toEqual(themeTokensFor(id, variant));
    }
  }
});

test("catalog scope, shadowing, and fallback stay on one selection", () => {
  const builtins = builtinThemeCatalog();
  const user = {
    ...builtins[0]!,
    id: "harbor",
    name: "Harbor",
    scope: "user" as const,
    sourcePath: "/user/harbor.json",
  };
  const project = {
    ...user,
    scope: "project" as const,
    workspacePath: "/work/a",
    sourcePath: "/work/a/harbor.json",
  };
  const catalog = [...builtins, user, project];
  const visible = themesForWorkspace(catalog, "/work/a");
  expect(visible.filter((entry) => entry.id === "harbor")).toEqual([project]);
  expect(themesForWorkspace(catalog, "/work/b").some((entry) => entry.scope === "project")).toBe(
    false,
  );

  expect(
    effectiveThemeId(
      catalog,
      { id: "harbor", scope: "project", workspacePath: "/work/a" },
      "/work/b",
    ),
  ).toBe("garden");
  expect(
    effectiveThemeId(
      catalog,
      { id: "harbor", scope: "project", workspacePath: "/work/a" },
      "/work/a",
    ),
  ).toBe("harbor");

  expect(reconcileThemeSelection(builtins, { id: "harbor", scope: "user" }).selection).toEqual({
    id: "garden",
    scope: "builtin",
  });
  expect(
    reconcileThemeSelection(catalog, {
      id: "harbor",
      scope: "project",
      workspacePath: "/work/a",
    }).fellBack,
  ).toBe(false);
  const darkOnly = {
    ...project,
    variants: { dark: project.variants.dark },
  };
  expect(presentTheme([darkOnly], "harbor", "light").variant).toBe("dark");
});

test("theme discovery reads user and trusted project files and skips invalid ones", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-themes-"));
  const workspace = await mkdtemp(join(tmpdir(), "pi-theme-work-"));
  const other = await mkdtemp(join(tmpdir(), "pi-theme-other-"));
  await mkdir(join(agentDir, "themes"), { recursive: true });
  await writeFile(join(agentDir, "themes", "harbor.json"), JSON.stringify(harbor));
  await writeFile(join(agentDir, "themes", "broken.json"), "{");
  await writeFile(join(agentDir, "themes", "tide.json"), JSON.stringify(piTheme()));
  await mkdir(join(workspace, ".pi", "themes"), { recursive: true });
  await writeFile(
    join(workspace, ".pi", "themes", "pier.json"),
    JSON.stringify({ ...harbor, id: "pier", name: "Pier" }),
  );
  await mkdir(join(other, ".pi", "themes"), { recursive: true });
  await writeFile(
    join(other, ".pi", "themes", "secret.json"),
    JSON.stringify({ ...harbor, id: "secret", name: "Secret" }),
  );
  await writeFile(
    join(agentDir, "trust.json"),
    JSON.stringify({ [workspace]: true, [other]: false }),
  );

  const catalog = await discoverThemeCatalog({
    agentDir,
    workspaces: [{ path: workspace }, { path: other }],
  });
  const ids = catalog.map((entry) => `${entry.scope}:${entry.id}`);
  expect(ids).toContain("builtin:default");
  expect(ids).toContain("user:harbor");
  expect(ids).toContain("user:tide");
  expect(ids).toContain(`project:pier`);
  expect(ids.some((id) => id.endsWith(":secret"))).toBe(false);
  expect(catalog.some((entry) => entry.id === "broken")).toBe(false);
});

test("persisted theme ids survive and malformed ids are dropped", () => {
  expect(
    decodePersistedUiState({
      version: 19,
      themePresetId: "github",
      composerDraft: "kept",
    }).themePresetId,
  ).toBe("github");
  const external = decodePersistedUiState({
    version: 19,
    themePresetId: "harbor",
    themeSelectionScope: "project",
    themeSelectionWorkspacePath: "/work/a",
  });
  expect(external.themePresetId).toBe("harbor");
  expect(external.themeSelectionScope).toBe("project");
  expect(external.themeSelectionWorkspacePath).toBe("/work/a");
  const dropped = decodePersistedUiState({
    version: 19,
    themePresetId: "bad/id",
    themeMode: "dark",
    composerDraft: "kept",
  });
  expect(dropped.themePresetId).toBeUndefined();
  expect(dropped.themeMode).toBe("dark");
  expect(dropped.composerDraft).toBe("kept");
});

import { mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { presentTheme } from "../../contracts/theme-catalog";
import {
  addWorkspaceViaIpc,
  createNamedThread,
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openWindowViaShortcut,
  seedAgentDir,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

const require = createRequire(__filename);
const helperPath = require.resolve("@pi-garden/extension-ui");

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

test("user themes are discovered, selected, persisted, and shared with extensions", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("theme-user");
  await seedAgentDir(agentDir);
  await mkdir(join(agentDir, "themes"), { recursive: true });
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await writeFile(join(agentDir, "themes", "harbor.json"), `${JSON.stringify(harbor, null, 2)}\n`);
  await writeFile(join(agentDir, "themes", "broken.json"), "{ not json");
  await writeFile(
    join(agentDir, "extensions", "theme-probe.ts"),
    `import { registerHeaderBadge } from ${JSON.stringify(helperPath)};
export default function themeProbe(pi) {
  registerHeaderBadge(pi, { id: "theme-probe", text: "Theme probe", tone: "accent" });
  pi.registerCommand("theme-status", {
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("theme-probe", ctx.ui.theme.fg("accent", ctx.ui.theme.name || ""));
      ctx.ui.setWidget("theme-probe", [ctx.ui.theme.fg("accent", "widget")]);
    },
  });
  pi.registerCommand("theme-catalog", {
    handler: async (_args, ctx) => {
      const names = ctx.ui.getAllThemes().map((theme) => theme.name).join(",");
      const found = ctx.ui.getTheme("harbor") ? "yes" : "no";
      const missing = ctx.ui.getTheme("not-a-theme") ? "yes" : "no";
      ctx.ui.setStatus("theme-catalog", names + " harbor:" + found + " missing:" + missing);
    },
  });
  pi.registerCommand("theme-set", {
    handler: async (args, ctx) => {
      const result = args === "bogus" ? ctx.ui.setTheme({} as string) : ctx.ui.setTheme(args || "harbor");
      ctx.ui.setStatus("theme-set", result.success ? "ok" : (result.error || "failed"));
    },
  });
}
`,
  );
  const viewDir = join(workspacePath, ".pi", "extensions", "theme-view");
  await mkdir(join(viewDir, "dist"), { recursive: true });
  await writeFile(
    join(viewDir, "index.ts"),
    `import { registerDesktopView } from ${JSON.stringify(helperPath)};
export default function themeView(pi) {
  registerDesktopView(pi, {
    id: "theme-view",
    title: "Theme view",
    source: import.meta.url,
    frontend: new URL("./dist/desktop.js", import.meta.url),
    backend: () => ({ id: "theme-view.backend", setup() {} }),
  });
}
`,
  );
  await writeFile(
    join(viewDir, "dist", "desktop.js"),
    `export function mount(root) {
  const probe = document.createElement("p");
  probe.textContent = "theme probe";
  probe.style.color = "var(--accent)";
  root.append(probe);
  return () => probe.remove();
}
`,
  );

  let harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Theme thread");
    await openAppearance(window);
    await window.getByRole("radio", { name: "Light", exact: true }).click();
    const preset = window.getByLabel("Color preset");
    await expect(preset.locator("option", { hasText: "Harbor" })).toHaveCount(1);
    await expect(preset.locator("option", { hasText: "broken" })).toHaveCount(0);
    await preset.selectOption({ label: "Harbor" });
    await expect.poll(() => rootThemeId(window)).toBe("harbor");
    await expect.poll(() => rootCssVariable(window, "--main")).toBe("#f3f7fa");
    await expect.poll(() => rootCssVariable(window, "--accent")).toBe("#0b6e99");
    const swatch = window.locator(".settings-preset-swatches span").first();
    await expect(swatch).toBeVisible();
    await window.getByRole("button", { name: "Back to app" }).click();

    const composer = window.getByTestId("composer");
    await composer.fill("/theme-status ");
    await composer.press("Enter");
    const status = window.locator("[data-status-key='theme-probe']");
    await expect(status).toContainText("harbor");
    const painted = await computedColor(window, "[data-status-key='theme-probe'] .ansi-fg-blue");
    await expect(window.locator("[data-widget-key='theme-probe']")).toContainText("widget");
    const badge = window.locator(".header-badge[data-tone='accent']");
    await expect(badge).toHaveText("Theme probe");
    const badgeColor = await badge.evaluate((element) => getComputedStyle(element).color);

    if (!(await window.getByTestId("workbench").isVisible())) {
      await window.getByTestId("toggle-side-panel").click();
    }
    await window.getByTestId("workbench-add-tab").click();
    await window
      .getByTestId("workbench-chooser")
      .getByRole("button", { name: "Theme view", exact: true })
      .click();
    const frame = window.frameLocator('[data-testid="extension-view-frame"]');
    const probe = frame.getByText("theme probe", { exact: true });
    await expect(probe).toBeVisible();
    const viewColor = await probe.evaluate((element) => getComputedStyle(element).color);
    expect(viewColor).toBe(painted);

    await window.evaluate(async () => {
      const app = globalThis.window.piApp;
      if (!app) throw new Error("piApp IPC bridge is unavailable");
      await app.setThemePresetId("tokyo-night");
    });
    await expect.poll(() => rootThemeId(window)).toBe("tokyo-night");
    await expect
      .poll(() => computedColor(window, "[data-status-key='theme-probe'] .ansi-fg-blue"))
      .not.toBe(painted);
    await expect
      .poll(() => badge.evaluate((element) => getComputedStyle(element).color))
      .not.toBe(badgeColor);
    await expect
      .poll(() => probe.evaluate((element) => getComputedStyle(element).color))
      .not.toBe(viewColor);

    await composer.fill("/theme-set harbor ");
    await composer.press("Enter");
    await expect(window.locator("[data-status-key='theme-set']")).toHaveText("ok");
    await expect.poll(() => rootThemeId(window)).toBe("harbor");
    await composer.fill("/theme-set bogus ");
    await composer.press("Enter");
    await expect(window.locator("[data-status-key='theme-set']")).toContainText(
      "cannot be represented",
    );
    await expect.poll(() => rootThemeId(window)).toBe("harbor");
    await composer.fill("/theme-catalog ");
    await composer.press("Enter");
    const catalog = window.locator("[data-status-key='theme-catalog']");
    await expect(catalog).toContainText("harbor:yes");
    await expect(catalog).toContainText("missing:no");
    await expect(catalog).toContainText("default");
    await expect(catalog).not.toContainText("broken");
  } finally {
    await harness.close();
  }

  harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect.poll(() => rootThemeId(window)).toBe("harbor");
    await expect.poll(() => rootCssVariable(window, "--accent")).toBe("#0b6e99");
    await createNamedThread(window, "Theme thread again");
    await unlink(join(agentDir, "themes", "harbor.json"));
    const composer = window.getByTestId("composer");
    await composer.fill("/reload ");
    await composer.press("Enter");
    await expect.poll(() => rootThemeId(window)).toBe("garden");
    const state = await getDesktopState(window);
    expect(state.themeCatalog.some((theme) => theme.id === "harbor")).toBe(false);
    expect(state.resolvedThemeId).toBe("garden");
  } finally {
    await harness.close();
  }
});

test("project themes stay inside the trusted workspace", async () => {
  test.setTimeout(180_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const trustedPath = await realpath(await makeWorkspace("theme-trusted"));
  const otherPath = await realpath(await makeWorkspace("theme-other"));
  await seedAgentDir(agentDir);
  await mkdir(join(agentDir, "themes"), { recursive: true });
  await writeFile(join(agentDir, "themes", "harbor.json"), `${JSON.stringify(harbor, null, 2)}\n`);
  await mkdir(join(trustedPath, ".pi", "themes"), { recursive: true });
  await mkdir(join(otherPath, ".pi", "themes"), { recursive: true });
  // Pier shares Harbor's palette except for a distinct dark surface, so window
  // backgrounds tell the two apart.
  const pier = {
    ...harbor,
    id: "pier",
    name: "Pier",
    variants: {
      ...harbor.variants,
      dark: {
        ...harbor.variants.dark,
        seed: { ...harbor.variants.dark.seed, surface: "#1a1024" },
      },
    },
  };
  await writeFile(
    join(trustedPath, ".pi", "themes", "pier.json"),
    `${JSON.stringify(pier, null, 2)}\n`,
  );
  await writeFile(
    join(otherPath, ".pi", "themes", "secret.json"),
    `${JSON.stringify({ ...harbor, id: "secret", name: "Secret" }, null, 2)}\n`,
  );
  await writeFile(
    join(agentDir, "trust.json"),
    `${JSON.stringify({ [trustedPath]: true }, null, 2)}\n`,
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [trustedPath],
    testMode: "background",
  });
  try {
    const first = await harness.firstWindow();
    await waitForWorkspaceByPath(first, trustedPath);
    await addWorkspaceViaIpc(first, otherPath);
    // Adding a workspace selects it; the first window should be looking at
    // the trusted project when it opens Appearance.
    await selectWorkspace(first, trustedPath);
    await openAppearance(first);
    await first.getByRole("radio", { name: "Dark", exact: true }).click();
    const preset = first.getByLabel("Color preset");
    await expect(preset.locator("option", { hasText: "Pier" })).toHaveCount(1);
    await expect(preset.locator("option", { hasText: "Secret" })).toHaveCount(0);
    await expect(preset.locator("option", { hasText: "Harbor" })).toHaveCount(1);
    await preset.selectOption({ label: "Pier" });
    await expect.poll(() => rootCssVariable(first, "--main")).toBe("#1a1024");
    const pierWindow = presentTheme((await getDesktopState(first)).themeCatalog, "pier", "dark")
      .tokens["--window"];

    const second = await openWindowViaShortcut(harness, first);
    await selectWorkspace(second, otherPath);
    await openAppearance(second);
    const otherPreset = second.getByLabel("Color preset");
    await expect(otherPreset.locator("option", { hasText: "Pier" })).toHaveCount(0);
    await expect(otherPreset.locator("option", { hasText: "Secret" })).toHaveCount(0);
    await expect(otherPreset.locator("option", { hasText: "Harbor" })).toHaveCount(1);
    await expect.poll(() => rootCssVariable(second, "--main")).not.toBe("#1a1024");
    await expect.poll(() => rootThemeId(first)).toBe("pier");

    await otherPreset.selectOption({ label: "Harbor" });
    await expect.poll(() => rootThemeId(second)).toBe("harbor");
    await expect.poll(() => rootThemeId(first)).toBe("harbor");
    await expect.poll(() => rootCssVariable(first, "--accent")).toBe("#7eb6d6");
    await expect
      .poll(() =>
        harness.electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((window) => window.getBackgroundColor().toLowerCase()),
        ),
      )
      .not.toContain(pierWindow?.toLowerCase());
  } finally {
    await harness.close();
  }
});

async function openAppearance(window: Page): Promise<void> {
  await window.keyboard.press(desktopShortcut(","));
  await expect(window.getByTestId("settings-surface")).toBeVisible();
  await window.getByRole("button", { name: "Appearance", exact: true }).click();
}

async function selectWorkspace(window: Page, workspacePath: string): Promise<void> {
  await window.evaluate(async (path) => {
    const app = globalThis.window.piApp;
    if (!app) throw new Error("piApp IPC bridge is unavailable");
    const state = await app.getState();
    const workspace = state.workspaces.find((entry) => entry.path === path);
    if (!workspace) throw new Error(`Missing workspace ${path}`);
    await app.selectWorkspace(workspace.id);
  }, workspacePath);
  await expect
    .poll(async () => {
      const state = await getDesktopState(window);
      return state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId)?.path;
    })
    .toBe(workspacePath);
}

async function rootThemeId(window: Page): Promise<string | undefined> {
  return window.evaluate(() => document.documentElement.dataset.themePreset);
}

async function rootCssVariable(window: Page, name: string): Promise<string> {
  return window.evaluate(
    (tokenName) => getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim(),
    name,
  );
}

async function computedColor(window: Page, selector: string): Promise<string> {
  return window.locator(selector).evaluate((element) => getComputedStyle(element).color);
}

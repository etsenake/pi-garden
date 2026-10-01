import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authoringSkillName,
  authoringWriterPath,
  buildDesktopAuthoringPrompt,
} from "../../contracts/desktop-authoring";
import { parseExternalThemeDocument } from "../../contracts/theme-document";

const skillsDir = path.resolve(__dirname, "../../resources/skills");
const helperDir = path.resolve(__dirname, "../../../../packages/extension-ui");

function runNode(
  script: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

test("authoring skill names match bundled directories", () => {
  expect(authoringSkillName("host-contribution")).toBe("create-host-contribution");
  expect(authoringSkillName("rich-surface")).toBe("create-rich-surface");
  expect(authoringSkillName("desktop-view")).toBe("create-desktop-view");
  expect(authoringSkillName("theme")).toBe("theme-pi-garden");
});

test("authoring prompts inject writer and helper paths", () => {
  const prompt = buildDesktopAuthoringPrompt({
    kind: "rich-surface",
    workspacePath: "/ws",
    paths: {
      helperPackageDir: "/helper",
      skillsDir: "/skills",
      extensionsDir: "/ws/.pi/extensions",
      themesDir: "/agent/themes",
    },
    id: "status",
    surface: "sidebar",
  });
  expect(prompt).toContain("/skill:create-rich-surface ");
  expect(prompt).toContain(authoringWriterPath("/skills", "rich-surface"));
  expect(prompt).toContain("/helper");
  expect(prompt).toContain("Suggested surface: sidebar");
});

test("theme authoring prompts use Garden writer paths", () => {
  const prompt = buildDesktopAuthoringPrompt({
    kind: "theme",
    workspacePath: "/ws",
    paths: {
      helperPackageDir: "/helper",
      skillsDir: "/skills",
      extensionsDir: "/ws/.pi/extensions",
      themesDir: "/agent/themes",
    },
    id: "harbor",
  });
  expect(prompt).toContain("/skill:theme-pi-garden ");
  expect(prompt).toContain("/agent/themes");
  expect(prompt).toContain("pi-garden.theme/v1");
  expect(prompt).not.toContain("@pi-garden/extension-ui");
});

test("create-host-contribution writer scaffolds an extension", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-author-host-"));
  try {
    const out = path.join(root, "badge-ext");
    const result = await runNode(path.join(skillsDir, "create-host-contribution", "apply.mjs"), [
      out,
      "badge-ext",
      helperDir,
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("created");
    const source = await readFile(path.join(out, "index.ts"), "utf8");
    expect(source).toContain("registerHeaderBadge");
    expect(
      await readFile(path.join(out, "node_modules/@pi-garden/extension-ui/package.json"), "utf8"),
    ).toBeTruthy();
    const second = await runNode(path.join(skillsDir, "create-host-contribution", "apply.mjs"), [
      out,
      "badge-ext",
      helperDir,
    ]);
    expect(second.stdout).toContain("unchanged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("theme-pi-garden writer scaffolds a parseable Garden document", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-author-theme-"));
  try {
    const result = await runNode(path.join(skillsDir, "theme-pi-garden", "apply.mjs"), [
      root,
      "coast",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("created");
    const raw: unknown = JSON.parse(await readFile(path.join(root, "coast.json"), "utf8"));
    const parsed = parseExternalThemeDocument(raw);
    expect(parsed.origin).toBe("garden");
    expect(parsed.id).toBe("coast");
    expect(parsed.variants.light?.syntaxTheme).toBe("github-light-default");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

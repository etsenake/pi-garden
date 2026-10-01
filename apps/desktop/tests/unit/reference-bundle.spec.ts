import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const builder = path.resolve(__dirname, "../../scripts/build-reference.mjs");

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)));
}

test("the reference ships Pi docs, examples, types and Pi Garden source as plain text files", () => {
  const outputDir = path.join(mkdtempSync(path.join(tmpdir(), "pi-garden-reference-")), "out");
  try {
    const result = spawnSync(process.execPath, [builder, outputDir], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const pi = "packages/@earendil-works/pi-coding-agent";
    for (const file of [
      `${pi}/docs/extensions.md`,
      `${pi}/examples/extensions/trigger-compact.ts`,
      `${pi}/dist/core/extensions/types.d.ts`,
      "packages/@earendil-works/chord/dist/types.d.ts",
      "pi-garden/docs/desktop-extension-contract.md",
      "pi-garden/packages/extension-ui/src/index.ts",
      "pi-garden/apps/desktop/resources/skills/create-rich-surface/SKILL.md",
    ]) {
      expect(existsSync(path.join(outputDir, file)), file).toBe(true);
    }

    const files = listFiles(outputDir);
    expect(files.filter((file) => file.split(path.sep).includes("node_modules"))).toEqual([]);
    expect(files.filter((file) => /\.(png|wasm|node|map)$/.test(file))).toEqual([]);
    expect(
      files.filter((file) => file.startsWith(path.join("pi-garden", "apps", "website"))),
    ).toEqual([]);
    expect(files.filter((file) => file.endsWith("pnpm-lock.yaml"))).toEqual([]);
    expect(
      files.filter((file) => file.startsWith(path.join(pi, "dist")) && !file.endsWith(".d.ts")),
    ).toEqual([]);

    const index = readFileSync(path.join(outputDir, "INDEX.md"), "utf8");
    expect(index).toMatch(/Pi Garden \d+\.\d+\.\d+, commit [0-9a-f]{40}/);
    expect(index).toMatch(/@earendil-works\/pi-coding-agent \d+\.\d+\.\d+/);
  } finally {
    rmSync(path.dirname(outputDir), { recursive: true, force: true });
  }
});

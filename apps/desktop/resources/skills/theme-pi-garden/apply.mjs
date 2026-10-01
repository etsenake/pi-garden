#!/usr/bin/env node
/**
 * Scaffold a pi-garden.theme/v1 document.
 * Usage: node apply.mjs <themes-directory> <theme-id>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SYNTAX = [
  "github-light-default",
  "github-dark-default",
  "catppuccin-latte",
  "catppuccin-mocha",
  "tokyo-night-light",
  "tokyo-night",
  "nord-light",
  "nord",
  "dracula-light",
  "dracula",
  "gruvbox-light-medium",
  "gruvbox-dark-medium",
  "light-plus",
  "dark-plus",
];

const [themesDirArg, themeId] = process.argv.slice(2);
if (!themesDirArg || !themeId || process.argv.length > 4) {
  console.error("usage: apply.mjs <themes-directory> <theme-id>");
  process.exit(1);
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(themeId) || /[/:]/.test(themeId)) {
  console.error("theme-id must be 1-80 safe characters without slashes or colons");
  process.exit(1);
}

const themesDir = path.resolve(themesDirArg);
const outFile = path.join(themesDir, `${themeId}.json`);
await mkdir(themesDir, { recursive: true });

try {
  await readFile(outFile, "utf8");
  console.log("unchanged");
  console.log(`syntaxTheme options: ${SYNTAX.join(", ")}`);
  process.exit(0);
} catch {
  // create
}

const name = themeId
  .split(/[._-]/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

const document = {
  format: "pi-garden.theme/v1",
  id: themeId,
  name,
  description: "Garden seed theme. Edit surface/ink/accent/added/removed/warning; keep contrast ≥ 3:1.",
  variants: {
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
  },
};

await writeFile(outFile, `${JSON.stringify(document, null, 2)}\n`);
console.log("created");
console.log(outFile);
console.log(`syntaxTheme options: ${SYNTAX.join(", ")}`);

#!/usr/bin/env node
/**
 * Packaged-safe Adapt for Desktop CLI.
 *
 * Usage: node apply.mjs <extension-entry> <helper-package-dir>
 *
 * Loads the esbuild bundle emitted beside this file during the desktop build.
 * Checkout can still use `apply.ts` through jiti when the bundle is absent.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundled = path.join(here, "apply-desktop-adaptation.mjs");
const [entry, helper] = process.argv.slice(2);

if (!entry || !helper || process.argv.length > 4) {
  console.error("usage: apply.mjs <extension-entry> <helper-package-dir>");
  process.exit(1);
}

if (!existsSync(bundled)) {
  console.error(
    `missing ${path.basename(bundled)}; run the desktop build (bundle-adapt-writer) first`,
  );
  process.exit(1);
}

try {
  const { applyDesktopAdaptation } = await import(pathToFileURL(bundled).href);
  const result = await applyDesktopAdaptation(entry, helper);
  console.log(result.changed ? "adapted" : "unchanged");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

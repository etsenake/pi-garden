/**
 * Checkout Adapt for Desktop CLI (jiti).
 *
 * Prefer `apply.mjs` in the packaged app and in prompts that name an absolute
 * writer path. This TypeScript entry remains for local jiti runs before the
 * desktop build has emitted the skill-local bundle.
 */
import { applyDesktopAdaptation } from "../../../electron/extensions/apply-desktop-adaptation.ts";

const [entry, helper] = process.argv.slice(2);
if (!entry || !helper || process.argv.length > 4) {
  console.error("usage: apply.ts <extension-entry> <helper-package-dir>");
  process.exit(1);
}

try {
  const result = await applyDesktopAdaptation(entry, helper);
  console.log(result.changed ? "adapted" : "unchanged");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

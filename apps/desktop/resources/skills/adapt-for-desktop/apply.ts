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

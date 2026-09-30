/**
 * Bundle the Adapt for Desktop writer into the shipped skill directory.
 *
 * The skill runs under ordinary Pi (checkout or packaged app) with plain Node.
 * Packaging only copies `resources/skills`, so the writer cannot import Electron
 * main sources at runtime. This step emits one self-contained ESM next to
 * `apply.mjs` that both environments execute.
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(desktopDir, "electron/extensions/apply-desktop-adaptation.ts");
const outfile = path.join(
  desktopDir,
  "resources/skills/adapt-for-desktop/apply-desktop-adaptation.mjs",
);

await esbuild.build({
  absWorkingDir: desktopDir,
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "bundle",
  logLevel: "info",
  // Keep Node builtins external; bundle acorn and local TS.
  external: ["node:*"],
});

console.log(`Bundled Adapt writer → ${path.relative(desktopDir, outfile)}`);

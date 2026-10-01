import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const outputDir = path.join(desktopDir, "build", "native");
const helpers = [
  {
    sourcePath: path.join(desktopDir, "resources", "notification-status-helper.swift"),
    outputPath: path.join(outputDir, "pi-garden-notification-status-helper"),
    infoPlistPath: path.join(outputDir, "pi-garden-notification-status-helper-Info.plist"),
  },
];

if (process.platform !== "darwin") {
  console.log("Skipping notification status helper build outside macOS.");
  process.exit(0);
}

const appId = await readAppId();
await mkdir(outputDir, { recursive: true });
for (const helper of helpers) {
  // usernotificationsd only answers for com.pi-garden.desktop when the caller's
  // code-signing identifier is that bundle id. Embedding an Info.plist makes
  // codesign (ours or electron-builder's) derive the identifier from it instead
  // of the file name, which macOS rejects as a different client.
  await writeFile(helper.infoPlistPath, infoPlist(appId), "utf8");
  await execFileAsync(
    "xcrun",
    [
      "swiftc",
      helper.sourcePath,
      "-O",
      "-o",
      helper.outputPath,
      "-Xlinker",
      "-sectcreate",
      "-Xlinker",
      "__TEXT",
      "-Xlinker",
      "__info_plist",
      "-Xlinker",
      helper.infoPlistPath,
    ],
    { cwd: desktopDir },
  );
  console.log(`Built native helper at ${helper.outputPath} (${appId})`);
}

async function readAppId() {
  const config = await readFile(path.join(desktopDir, "electron-builder.yml"), "utf8");
  const appId = /^appId:\s*["']?([\w.-]+)["']?\s*$/m.exec(config)?.[1];
  if (!appId) {
    throw new Error("Could not read appId from electron-builder.yml");
  }
  return appId;
}

function infoPlist(bundleId) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
</dict>
</plist>
`;
}

import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  getRealAuthConfig,
  getSelectedTranscript,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import {
  customHeaderFrontend,
  writeRealPiExtension,
} from "../helpers/real-pi-extension-fixtures";

/**
 * Cloud-provider Adapt-for-Desktop soak: real Bedrock (or the seeded agent
 * default) drives the skill conversation, runs the writer, reloads, and
 * refreshes inventory. Distinct from the scripted local conversation proof.
 */

const realAuth = getRealAuthConfig();
const ARTIFACT_DIR = join(process.cwd(), ".artifacts", "adapt-live-cloud");

function awsEnvOverrides(): NodeJS.ProcessEnv {
  // Bedrock auth is ambient AWS SSO / profile, scrubbed by the launcher by default.
  return {
    ...(process.env.AWS_PROFILE ? { AWS_PROFILE: process.env.AWS_PROFILE } : {}),
    ...(process.env.AWS_REGION ? { AWS_REGION: process.env.AWS_REGION } : {}),
    ...(process.env.AWS_DEFAULT_REGION
      ? { AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION }
      : {}),
    ...(process.env.AWS_ACCESS_KEY_ID
      ? { AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID }
      : {}),
    ...(process.env.AWS_SECRET_ACCESS_KEY
      ? { AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY }
      : {}),
    ...(process.env.AWS_SESSION_TOKEN
      ? { AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN }
      : {}),
  };
}

test("cloud Adapt for Desktop conversation adapts real custom-header end to end", async () => {
  test.skip(!realAuth.enabled, realAuth.skipReason ?? "real auth disabled");
  test.setTimeout(600_000);

  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("cloud-adapt-conversation");
  await mkdir(join(agentDir, "extensions"), { recursive: true });
  await copyFile(join(realAuth.sourceDir!, "auth.json"), join(agentDir, "auth.json"));
  await copyFile(join(realAuth.sourceDir!, "settings.json"), join(agentDir, "settings.json"));
  try {
    await copyFile(join(realAuth.sourceDir!, "models.json"), join(agentDir, "models.json"));
  } catch {
    // optional
  }

  const entry = await writeRealPiExtension("custom-header", join(agentDir, "extensions"));
  const metadataPath = join(dirname(entry), "desktop-adaptation.json");

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    envOverrides: awsEnvOverrides(),
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await expect(window.getByTestId("extensions-surface")).toBeVisible({ timeout: 20_000 });
    await window
      .getByTestId("extensions-list")
      .getByRole("button", { name: /pi-custom-header/i })
      .click();
    await expect(window.getByTestId("extension-compatibility")).toBeVisible({ timeout: 20_000 });
    await expect(window.getByTestId("adapt-for-desktop")).toBeEnabled();
    await window.getByTestId("adapt-for-desktop").click();

    await expect(window.getByTestId("composer")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        async () =>
          access(metadataPath).then(
            () => "written",
            () => "missing",
          ),
        { timeout: 480_000 },
      )
      .toBe("written");
    await expect(window.getByTestId("send")).not.toHaveAttribute("aria-label", "Stop run", {
      timeout: 180_000,
    });

    await writeFile(join(dirname(entry), "pi-garden-desktop", "header.js"), customHeaderFrontend());
    await window.getByTestId("composer").fill("/reload ");
    await window.getByTestId("composer").press("Enter");
    await expect(
      window
        .getByTestId("rich-surface-app-header")
        .frameLocator('[data-testid="rich-surface-frame"]')
        .getByTestId("pi-custom-header"),
    ).toHaveText("pi custom header", { timeout: 60_000 });

    await window.getByRole("button", { name: "Extensions", exact: true }).click();
    await window
      .getByTestId("extensions-list")
      .getByRole("button", { name: /pi-custom-header/i })
      .click();
    const section = window.getByTestId("extension-compatibility");
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.getByTestId("extension-compatibility-summary")).toContainText("adapted", {
      timeout: 60_000,
    });

    await mkdir(ARTIFACT_DIR, { recursive: true });
    const transcript = await getSelectedTranscript(window);
    const finalState = await getDesktopState(window);
    await writeFile(
      join(ARTIFACT_DIR, "conversation.json"),
      `${JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          entry,
          metadataPath,
          workspaceId: workspace.id,
          selectedSessionId: finalState.selectedSessionId,
          transcript: transcript?.transcript ?? [],
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await harness.close();
  }
});

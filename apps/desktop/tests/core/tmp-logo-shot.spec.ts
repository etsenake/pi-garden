import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
} from "../helpers/electron-app";

test("tmp: new thread hero renders the garden mark", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("tmp-logo-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await openNewThread(window);
    const logo = window.getByTestId("new-thread-logo").locator("img");
    await expect(logo).toBeVisible();
    await expect
      .poll(() => logo.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await window.locator(".new-thread").screenshot({ path: "/tmp/new-thread-hero.png" });
  } finally {
    await harness.close();
  }
});

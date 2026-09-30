import { expect, test } from "@playwright/test";
import { HeaderBadgeOwner } from "../../electron/extensions/header-badge-owner";

const sessionA = { workspaceId: "workspace-a", sessionId: "session-a" };
const sessionB = { workspaceId: "workspace-b", sessionId: "session-b" };

test("sorts badges by id, keeps one entry per id, and drops invalid entries", () => {
  const owner = new HeaderBadgeOwner();
  owner.replaceRuntime({
    target: sessionA,
    generation: "gen-1",
    badges: [
      { id: "zeta", text: "Zeta" },
      { id: "garden", text: "Garden" },
      { id: "garden", text: "Garden 2" },
      { id: "Broken", text: "Nope" },
      { id: "alpha", text: "" },
    ],
  });

  expect(owner.list(sessionA)).toEqual([
    { id: "garden", text: "Garden 2" },
    { id: "zeta", text: "Zeta" },
  ]);
});

test("keeps sessions isolated and ignores stale runtime generations", () => {
  const owner = new HeaderBadgeOwner();
  const published: string[] = [];
  owner.subscribe((target) => {
    published.push(`${target.workspaceId}:${target.sessionId}:${owner.list(target).length}`);
  });

  owner.replaceRuntime({
    target: sessionA,
    generation: "gen-a1",
    badges: [{ id: "garden", text: "Garden" }],
  });
  owner.replaceRuntime({
    target: sessionB,
    generation: "gen-b1",
    badges: [
      { id: "local", text: "Local" },
      { id: "garden", text: "Garden" },
    ],
  });
  expect(owner.list(sessionA)).toEqual([{ id: "garden", text: "Garden" }]);
  expect(owner.list(sessionB)).toEqual([
    { id: "garden", text: "Garden" },
    { id: "local", text: "Local" },
  ]);

  owner.replaceRuntime({
    target: sessionA,
    generation: "gen-a2",
    badges: [{ id: "garden", text: "Garden" }],
  });
  owner.replaceRuntime({
    target: sessionA,
    generation: "gen-a1",
    badges: [
      { id: "garden", text: "Garden" },
      { id: "ghost", text: "Ghost" },
    ],
  });
  owner.invalidateRuntime(sessionA, "gen-a1");
  expect(owner.list(sessionA)).toEqual([{ id: "garden", text: "Garden" }]);
  expect(owner.list(sessionB)).toEqual([
    { id: "garden", text: "Garden" },
    { id: "local", text: "Local" },
  ]);

  owner.invalidateRuntime(sessionA, "gen-a2");
  owner.replaceRuntime({
    target: sessionA,
    generation: "gen-a2",
    badges: [{ id: "garden", text: "Garden" }],
  });
  expect(owner.list(sessionA)).toEqual([]);
  expect(owner.list(sessionB)).toEqual([
    { id: "garden", text: "Garden" },
    { id: "local", text: "Local" },
  ]);
  expect(published.at(-1)).toBe("workspace-a:session-a:0");
});

test("replaces badges for the current generation without duplicating them", () => {
  const owner = new HeaderBadgeOwner();
  owner.replaceRuntime({
    target: sessionA,
    generation: "gen-1",
    badges: [{ id: "garden", text: "Garden" }],
  });
  owner.replaceRuntime({
    target: sessionA,
    generation: "gen-1",
    badges: [
      { id: "local", text: "Local" },
      { id: "garden", text: "Updated" },
    ],
  });

  expect(owner.list(sessionA)).toEqual([
    { id: "garden", text: "Updated" },
    { id: "local", text: "Local" },
  ]);
});

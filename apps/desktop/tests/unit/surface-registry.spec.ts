import { expect, test } from "@playwright/test";
import { SurfaceRegistry } from "../../electron/extensions/surface-registry";

const sessionA = { workspaceId: "workspace-a", sessionId: "session-a" };
const sessionB = { workspaceId: "workspace-b", sessionId: "session-b" };

test("orders by surface then order then id, replaces same ids, and drops invalid entries", () => {
  const registry = new SurfaceRegistry();
  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-1",
    contributions: [
      { id: "zeta", surface: "conversation-header", text: "Zeta", tone: "muted", order: 1 },
      { id: "garden", surface: "conversation-header", text: "Garden" },
      {
        id: "garden",
        surface: "conversation-header",
        text: "Garden 2",
        tone: "success",
        order: -1,
      },
      { id: "garden", surface: "sidebar-footer", text: "Root", order: 5 },
      { id: "alpha", surface: "sidebar-footer", text: "Alpha", order: 5 },
      { id: "garden", surface: "sidebar-section", text: "Stale", order: 9 },
      { id: "quiet", surface: "sidebar-section", text: "Quiet", tone: "muted", order: -1 },
      { id: "garden", surface: "sidebar-section", text: "Lane", tone: "accent", order: 1 },
      { id: "Broken", surface: "conversation-header", text: "Nope" },
      { id: "alpha", surface: "conversation-header", text: "" },
      { id: "purple", surface: "conversation-header", text: "Nope", tone: "purple" },
      { id: "styled", surface: "conversation-header", text: "Nope", color: "#ff0000" },
      { id: "wide", surface: "conversation-header", text: "Nope", order: 1.5 },
      { id: "foreign", surface: "status-bar", text: "Nope" },
      { id: "break", surface: "conversation-header", text: "line\nbreak" },
      { id: "huge", surface: "sidebar-footer", text: "x".repeat(33) },
    ],
  });

  expect(registry.list(sessionA)).toEqual([
    {
      id: "garden",
      surface: "conversation-header",
      text: "Garden 2",
      tone: "success",
      order: -1,
    },
    {
      id: "zeta",
      surface: "conversation-header",
      text: "Zeta",
      tone: "muted",
      order: 1,
    },
    {
      id: "alpha",
      surface: "sidebar-footer",
      text: "Alpha",
      tone: "default",
      order: 5,
    },
    {
      id: "garden",
      surface: "sidebar-footer",
      text: "Root",
      tone: "default",
      order: 5,
    },
    {
      id: "quiet",
      surface: "sidebar-section",
      text: "Quiet",
      tone: "muted",
      order: -1,
    },
    {
      id: "garden",
      surface: "sidebar-section",
      text: "Lane",
      tone: "accent",
      order: 1,
    },
  ]);
});

test("keeps sessions isolated and ignores stale runtime generations", () => {
  const registry = new SurfaceRegistry();
  const published: string[] = [];
  registry.subscribe((target) => {
    published.push(`${target.workspaceId}:${target.sessionId}:${registry.list(target).length}`);
  });

  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-a1",
    contributions: [
      { id: "garden", surface: "conversation-header", text: "Garden" },
      { id: "garden", surface: "sidebar-footer", text: "Root" },
    ],
  });
  registry.replaceRuntime({
    target: sessionB,
    generation: "gen-b1",
    contributions: [
      { id: "local", surface: "conversation-header", text: "Local" },
      { id: "garden", surface: "conversation-header", text: "Garden" },
      { id: "local", surface: "sidebar-footer", text: "Local side" },
    ],
  });
  expect(registry.list(sessionA)).toEqual([
    {
      id: "garden",
      surface: "conversation-header",
      text: "Garden",
      tone: "default",
      order: 0,
    },
    {
      id: "garden",
      surface: "sidebar-footer",
      text: "Root",
      tone: "default",
      order: 0,
    },
  ]);
  expect(registry.list(sessionB)).toEqual([
    {
      id: "garden",
      surface: "conversation-header",
      text: "Garden",
      tone: "default",
      order: 0,
    },
    {
      id: "local",
      surface: "conversation-header",
      text: "Local",
      tone: "default",
      order: 0,
    },
    {
      id: "local",
      surface: "sidebar-footer",
      text: "Local side",
      tone: "default",
      order: 0,
    },
  ]);

  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-a2",
    contributions: [
      { id: "garden", surface: "conversation-header", text: "Garden" },
      { id: "garden", surface: "sidebar-footer", text: "Root" },
    ],
  });
  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-a1",
    contributions: [
      { id: "garden", surface: "conversation-header", text: "Garden" },
      { id: "ghost", surface: "sidebar-footer", text: "Ghost" },
    ],
  });
  registry.invalidateRuntime(sessionA, "gen-a1");
  expect(registry.list(sessionA)).toEqual([
    {
      id: "garden",
      surface: "conversation-header",
      text: "Garden",
      tone: "default",
      order: 0,
    },
    {
      id: "garden",
      surface: "sidebar-footer",
      text: "Root",
      tone: "default",
      order: 0,
    },
  ]);
  expect(registry.list(sessionB)).toEqual([
    {
      id: "garden",
      surface: "conversation-header",
      text: "Garden",
      tone: "default",
      order: 0,
    },
    {
      id: "local",
      surface: "conversation-header",
      text: "Local",
      tone: "default",
      order: 0,
    },
    {
      id: "local",
      surface: "sidebar-footer",
      text: "Local side",
      tone: "default",
      order: 0,
    },
  ]);

  registry.invalidateRuntime(sessionA, "gen-a2");
  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-a2",
    contributions: [{ id: "garden", surface: "conversation-header", text: "Garden" }],
  });
  expect(registry.list(sessionA)).toEqual([]);
  expect(registry.list(sessionB)).toEqual([
    {
      id: "garden",
      surface: "conversation-header",
      text: "Garden",
      tone: "default",
      order: 0,
    },
    {
      id: "local",
      surface: "conversation-header",
      text: "Local",
      tone: "default",
      order: 0,
    },
    {
      id: "local",
      surface: "sidebar-footer",
      text: "Local side",
      tone: "default",
      order: 0,
    },
  ]);
  expect(published.at(-1)).toBe("workspace-a:session-a:0");
});

test("two windows read one snapshot and a stale generation restores nothing", () => {
  const registry = new SurfaceRegistry();
  const windowA: string[][] = [];
  const windowB: string[][] = [];
  const snapshot = () => registry.list(sessionA).map((contribution) => contribution.text);
  registry.subscribe(() => {
    windowA.push(snapshot());
    windowB.push(snapshot());
  });

  registry.replaceRuntime({
    target: sessionA,
    generation: "live",
    contributions: [
      { id: "garden", surface: "composer-before", text: "Before" },
      { id: "garden", surface: "composer-after", text: "After" },
      { id: "garden", surface: "sidebar-section", text: "Lane" },
      { id: "garden", surface: "sidebar-footer", text: "Foot" },
      { id: "garden", surface: "status-chrome", text: "Live" },
    ],
  });
  registry.replaceRuntime({
    target: sessionA,
    generation: "next",
    contributions: [{ id: "garden", surface: "status-chrome", text: "Next" }],
  });
  registry.replaceRuntime({
    target: sessionA,
    generation: "live",
    contributions: [
      { id: "ghost", surface: "composer-before", text: "Ghost" },
      { id: "garden", surface: "sidebar-section", text: "Restored lane" },
      { id: "garden", surface: "sidebar-footer", text: "Restored foot" },
      { id: "garden", surface: "status-chrome", text: "Restored" },
    ],
  });
  registry.invalidateRuntime(sessionA, "live");

  expect(snapshot()).toEqual(["Next"]);
  expect(windowA.at(-1)).toEqual(["Next"]);
  expect(windowB.at(-1)).toEqual(["Next"]);
  expect(windowA).toEqual(windowB);
});

test("replaces the current generation without duplicating either surface", () => {
  const registry = new SurfaceRegistry();
  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-1",
    contributions: [
      { id: "garden", surface: "conversation-header", text: "Garden", tone: "success", order: 4 },
      { id: "garden", surface: "sidebar-footer", text: "Root", tone: "muted", order: 4 },
    ],
  });
  registry.replaceRuntime({
    target: sessionA,
    generation: "gen-1",
    contributions: [
      { id: "local", surface: "conversation-header", text: "Local", tone: "warning" },
      { id: "garden", surface: "conversation-header", text: "Updated", tone: "error", order: 2 },
      { id: "garden", surface: "sidebar-footer", text: "Moved", order: 1 },
    ],
  });

  expect(registry.list(sessionA)).toEqual([
    {
      id: "local",
      surface: "conversation-header",
      text: "Local",
      tone: "warning",
      order: 0,
    },
    {
      id: "garden",
      surface: "conversation-header",
      text: "Updated",
      tone: "error",
      order: 2,
    },
    {
      id: "garden",
      surface: "sidebar-footer",
      text: "Moved",
      tone: "default",
      order: 1,
    },
  ]);
});

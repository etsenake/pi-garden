import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_VIEW_DISCOVER,
  DESKTOP_VIEW_REGISTER,
  DESKTOP_VIEW_UNREGISTER,
  SURFACE_CONTRIBUTION_DISCOVER,
  SURFACE_CONTRIBUTION_REGISTER,
  SURFACE_CONTRIBUTION_UNREGISTER,
  EXTENSION_ACTION_DISCOVER,
  EXTENSION_ACTION_REGISTER,
  EXTENSION_ACTION_UNREGISTER,
  normalizeShortcut,
  normalizeSurfaceContribution,
  compareRichSurfacePlacement,
  compareSingletonOwners,
  registerAction,
  registerComposerAfter,
  registerDesktopToolRenderer,
  registerRichSurface,
  RICH_SURFACE_DISCOVER,
  RICH_SURFACE_REGISTER,
  RICH_SURFACE_UNREGISTER,
  registerComposerBefore,
  registerDesktopView,
  registerHeaderBadge,
  registerSidebarFooter,
  registerSidebarSection,
  registerStatusChrome,
  type DesktopExtensionAPI,
  type DesktopViewRegistrationEvent,
  type RichSurfaceRegistrationEvent,
  type SurfaceContribution,
  type SurfaceContributionRegistrationEvent,
} from "../dist/index.js";
import { parseDesktopHostAction } from "../dist/browser.js";

await test("terminal registration is optional and desktop discovery replays the same closure", () => {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const shutdown: (() => void)[] = [];
  const pi: DesktopExtensionAPI = {
    events: {
      emit(channel, value) {
        for (const listener of listeners.get(channel) ?? []) listener(value);
      },
      on(channel, listener) {
        const handlers = listeners.get(channel) ?? new Set();
        handlers.add(listener);
        listeners.set(channel, handlers);
        return () => {
          handlers.delete(listener);
        };
      },
    },
    on(_event, listener) {
      shutdown.push(listener);
    },
  };
  let factoryCalls = 0;
  const declaration = {
    id: "review",
    title: "Review",
    source: "file:///extension/index.ts",
    frontend: new URL("file:///extension/dist/desktop.js"),
    backend() {
      factoryCalls += 1;
      return { id: "review-backend", setup() {} };
    },
  };
  const registration = registerDesktopView(pi, declaration);
  assert.equal(registration.available, false);
  const discovered: unknown[] = [];
  const removed: unknown[] = [];
  pi.events.on(DESKTOP_VIEW_REGISTER, (value) => {
    const event = value as DesktopViewRegistrationEvent;
    discovered.push(event.declaration);
    event.accept?.();
  });
  pi.events.on(DESKTOP_VIEW_UNREGISTER, (value) => {
    removed.push(value);
  });
  pi.events.emit(DESKTOP_VIEW_DISCOVER, undefined);
  pi.events.emit(DESKTOP_VIEW_DISCOVER, undefined);
  assert.equal(registration.available, true);
  assert.deepEqual(discovered, [declaration, declaration]);
  assert.equal(factoryCalls, 0, "discovery must not instantiate another backend");
  shutdown.forEach((listener) => listener());
  registration.dispose();
  pi.events.emit(DESKTOP_VIEW_DISCOVER, undefined);
  assert.equal(registration.available, false);
  assert.deepEqual(removed, [declaration]);
  assert.equal(discovered.length, 2);
});

await test("host actions reject foreign target identities and non-JSON values", () => {
  assert.deepEqual(parseDesktopHostAction({ type: "openFile", path: "src/app.ts", line: 3 }), {
    type: "openFile",
    path: "src/app.ts",
    line: 3,
  });
  assert.deepEqual(
    parseDesktopHostAction({
      type: "prepareTaskDraft",
      title: "Fix",
      prompt: "Review finding",
      files: [{ path: "src/app.ts", line: 3 }],
    }),
    {
      type: "prepareTaskDraft",
      title: "Fix",
      prompt: "Review finding",
      files: [{ path: "src/app.ts", line: 3 }],
    },
  );
  assert.deepEqual(parseDesktopHostAction({ type: "presentOverlay", id: "picker" }), {
    type: "presentOverlay",
    id: "picker",
  });
  assert.deepEqual(parseDesktopHostAction({ type: "settleOverlay", value: { ok: true } }), {
    type: "settleOverlay",
    value: { ok: true },
  });
  assert.deepEqual(parseDesktopHostAction({ type: "cancelOverlay" }), { type: "cancelOverlay" });
  for (const action of [
    { type: "openFile", path: "src/app.ts", sessionId: "other" },
    { type: "openFile", path: "src/app.ts", line: 0 },
    { type: "openFile", path: "src/app.ts", column: Number.NaN },
    {
      type: "prepareTaskDraft",
      title: "Fix",
      prompt: "Review finding",
      files: [{ path: "a", workspaceId: "other" }],
    },
    { type: "prepareTaskDraft", title: "Fix", prompt: undefined },
    { type: "presentOverlay", id: "Bad Id" },
    { type: "settleOverlay", value: () => undefined },
    { type: "cancelOverlay", extra: true },
    { type: "shell", command: "rm -rf /" },
    { type: "unknown" },
  ])
    assert.throws(() => parseDesktopHostAction(action));
});

function createExtensionApi(): DesktopExtensionAPI & {
  readonly shutdown: () => void;
} {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const shutdownListeners: (() => void)[] = [];
  return {
    events: {
      emit(channel, value) {
        for (const listener of listeners.get(channel) ?? []) listener(value);
      },
      on(channel, listener) {
        const handlers = listeners.get(channel) ?? new Set();
        handlers.add(listener);
        listeners.set(channel, handlers);
        return () => {
          handlers.delete(listener);
        };
      },
    },
    on(_event, listener) {
      shutdownListeners.push(listener);
    },
    shutdown() {
      for (const listener of shutdownListeners) listener();
    },
  };
}

const gardenContribution = {
  id: "garden",
  surface: "conversation-header",
  text: "Garden",
  tone: "default",
  order: 0,
} as const;

await test("header badge discovery replays one contribution and shutdown removes it", () => {
  const pi = createExtensionApi();
  const registration = registerHeaderBadge(pi, { id: "garden", text: "  Garden  " });
  assert.equal(registration.available, false);
  const discovered: unknown[] = [];
  const removed: unknown[] = [];
  pi.events.on(SURFACE_CONTRIBUTION_REGISTER, (value) => {
    const event = value as SurfaceContributionRegistrationEvent;
    discovered.push(event.contribution);
    event.accept?.();
  });
  pi.events.on(SURFACE_CONTRIBUTION_UNREGISTER, (value) => {
    removed.push(value);
  });
  pi.events.emit(SURFACE_CONTRIBUTION_DISCOVER, undefined);
  pi.events.emit(SURFACE_CONTRIBUTION_DISCOVER, undefined);
  assert.equal(registration.available, true);
  assert.deepEqual(discovered, [gardenContribution, gardenContribution]);
  assert.equal(discovered[0], discovered[1]);
  pi.shutdown();
  pi.events.emit(SURFACE_CONTRIBUTION_DISCOVER, undefined);
  assert.equal(registration.available, false);
  assert.deepEqual(removed, [gardenContribution]);
  assert.equal(discovered.length, 2);
});

await test("contribution registration rejects values the host cannot render", () => {
  const pi = createExtensionApi();
  for (const badge of [
    { id: "Garden", text: "Garden" },
    { id: "1garden", text: "Garden" },
    { id: "garden", text: "" },
    { id: "garden", text: "   " },
    { id: "garden", text: "line\nbreak" },
    { id: "garden", text: "x".repeat(33) },
    { id: "garden", text: "Garden", tone: "purple" },
    { id: "garden", text: "Garden", tone: "" },
    { id: "garden", text: "Garden", color: "#ff0000" },
    { id: "garden", text: "Garden", className: "danger" },
    { id: "garden", text: "Garden", order: 1.5 },
    { id: "garden", text: "Garden", order: Number.NaN },
    { id: "garden", text: "Garden", order: Number.POSITIVE_INFINITY },
    { id: "garden", text: "Garden", order: "1" },
    { id: "garden", text: "Garden", surface: "sidebar-footer" },
    { id: "garden", text: "Garden", html: "<b>Garden</b>" },
  ]) {
    assert.throws(() => registerHeaderBadge(pi, badge as { id: string; text: string }));
    assert.throws(() => registerSidebarFooter(pi, badge as { id: string; text: string }));
    assert.throws(() => registerSidebarSection(pi, badge as { id: string; text: string }));
    assert.throws(() => registerComposerBefore(pi, badge as { id: string; text: string }));
    assert.throws(() => registerComposerAfter(pi, badge as { id: string; text: string }));
    assert.throws(() => registerStatusChrome(pi, badge as { id: string; text: string }));
  }
});

await test("both surfaces share ordering and keep same ids independent", () => {
  const pi = createExtensionApi();
  const discovered: SurfaceContribution[] = [];
  pi.events.on(SURFACE_CONTRIBUTION_REGISTER, (value) => {
    const event = value as SurfaceContributionRegistrationEvent;
    discovered.push(event.contribution);
    event.accept?.();
  });
  for (const tone of ["default", "accent", "success", "warning", "error", "muted"] as const) {
    registerHeaderBadge(pi, { id: tone, text: tone, tone });
  }
  const replaced = registerHeaderBadge(pi, {
    id: "ready",
    text: "Ready",
    tone: "success",
    order: 3,
  });
  registerHeaderBadge(pi, { id: "ready", text: "Failed", tone: "error", order: 1 });
  const footer = registerSidebarFooter(pi, { id: "ready", text: "Foot", order: 4 });
  registerSidebarFooter(pi, { id: "ready", text: "Side", tone: "muted" });
  pi.events.emit(SURFACE_CONTRIBUTION_DISCOVER, undefined);
  const byKey = new Map<string, SurfaceContribution>();
  for (const contribution of discovered) {
    byKey.set(`${contribution.surface}\0${contribution.id}`, contribution);
  }
  assert.equal(byKey.get("conversation-header\0ready")?.text, "Failed");
  assert.equal(byKey.get("conversation-header\0ready")?.tone, "error");
  assert.equal(byKey.get("conversation-header\0ready")?.order, 1);
  assert.equal(byKey.get("sidebar-footer\0ready")?.text, "Side");
  assert.equal(byKey.get("sidebar-footer\0ready")?.tone, "muted");
  assert.equal(byKey.get("sidebar-footer\0ready")?.order, 0);
  assert.equal(byKey.size, 8);
  assert.equal(replaced.available, true);
  assert.equal(footer.available, true);
});

await test("convenience APIs assign a surface without taking one from the author", () => {
  const pi = createExtensionApi();
  const discovered: SurfaceContribution[] = [];
  pi.events.on(SURFACE_CONTRIBUTION_REGISTER, (value) => {
    const event = value as SurfaceContributionRegistrationEvent;
    discovered.push(event.contribution);
  });
  registerComposerBefore(pi, { id: "garden", text: "Before", tone: "accent", order: 2 });
  registerComposerAfter(pi, { id: "garden", text: "After" });
  registerSidebarSection(pi, { id: "garden", text: "Lane", tone: "success", order: 1 });
  registerSidebarFooter(pi, { id: "garden", text: "Root", tone: "muted", order: 3 });
  registerStatusChrome(pi, { id: "garden", text: "Live", tone: "warning", order: -1 });
  assert.deepEqual(
    discovered.map((contribution) => ({
      id: contribution.id,
      surface: contribution.surface,
      text: contribution.text,
      tone: contribution.tone,
      order: contribution.order,
    })),
    [
      {
        id: "garden",
        surface: "composer-before",
        text: "Before",
        tone: "accent",
        order: 2,
      },
      { id: "garden", surface: "composer-after", text: "After", tone: "default", order: 0 },
      {
        id: "garden",
        surface: "sidebar-section",
        text: "Lane",
        tone: "success",
        order: 1,
      },
      { id: "garden", surface: "sidebar-footer", text: "Root", tone: "muted", order: 3 },
      {
        id: "garden",
        surface: "status-chrome",
        text: "Live",
        tone: "warning",
        order: -1,
      },
    ],
  );
});

await test("the desktop boundary normalizes omitted fields and rejects unknown contributions", () => {
  assert.deepEqual(
    normalizeSurfaceContribution({
      id: "garden",
      surface: "sidebar-footer",
      text: "Garden",
    }),
    {
      id: "garden",
      surface: "sidebar-footer",
      text: "Garden",
      tone: "default",
      order: 0,
    },
  );
  assert.deepEqual(
    normalizeSurfaceContribution({
      id: "garden",
      surface: "conversation-header",
      text: "Garden",
      tone: "success",
      order: -2,
    }),
    {
      id: "garden",
      surface: "conversation-header",
      text: "Garden",
      tone: "success",
      order: -2,
    },
  );
  for (const value of [
    { id: "Garden", surface: "conversation-header", text: "Garden" },
    { id: "garden", surface: "conversation-header", text: "" },
    { id: "garden", surface: "conversation-header", text: "line\nbreak" },
    { id: "garden", surface: "conversation-header", text: "x".repeat(33) },
    { id: "garden", surface: "status-bar", text: "Garden" },
    { id: "garden", surface: "conversation-header", text: "Garden", tone: "purple" },
    { id: "garden", surface: "conversation-header", text: "Garden", order: 1.5 },
    { id: "garden", surface: "conversation-header", text: "Garden", color: "#ff0000" },
    { id: "garden", surface: "conversation-header", text: "Garden", actionId: "Nope" },
    { id: "garden", text: "Garden" },
    null,
  ]) {
    assert.equal(normalizeSurfaceContribution(value), undefined);
  }
  assert.deepEqual(
    normalizeSurfaceContribution({
      id: "garden",
      surface: "composer-before",
      text: "Mark",
      actionId: "mark-plot",
    }),
    {
      id: "garden",
      surface: "composer-before",
      text: "Mark",
      tone: "default",
      order: 0,
      actionId: "mark-plot",
    },
  );
});

await test("registerAction replays one handler and drops it on shutdown", () => {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const shutdown: (() => void)[] = [];
  const pi: DesktopExtensionAPI = {
    events: {
      emit(channel, value) {
        for (const listener of listeners.get(channel) ?? []) listener(value);
      },
      on(channel, listener) {
        const handlers = listeners.get(channel) ?? new Set();
        handlers.add(listener);
        listeners.set(channel, handlers);
        return () => {
          handlers.delete(listener);
        };
      },
    },
    on(_event, listener) {
      shutdown.push(listener);
    },
  };
  let calls = 0;
  const registration = registerAction(pi, {
    id: "mark-plot",
    title: "Mark garden plot",
    description: "Mark the current plot",
    source: "file:///extension/index.ts",
    shortcut: "Ctrl+Shift+M",
    handler: () => {
      calls += 1;
    },
  });
  const registered: Array<{ id: string; shortcut?: string }> = [];
  pi.events.on(EXTENSION_ACTION_REGISTER, (value) => {
    const event = value as {
      action: { id: string; shortcut?: string };
      accept?: () => void;
    };
    registered.push({ id: event.action.id, shortcut: event.action.shortcut });
    event.accept?.();
  });
  const removed: string[] = [];
  pi.events.on(EXTENSION_ACTION_UNREGISTER, (value) => {
    removed.push((value as { id: string }).id);
  });
  assert.equal(normalizeShortcut("Ctrl+Shift+M"), "ctrl+shift+m");
  assert.equal(registration.available, false);
  pi.events.emit(EXTENSION_ACTION_DISCOVER, undefined);
  pi.events.emit(EXTENSION_ACTION_DISCOVER, undefined);
  assert.equal(registration.available, true);
  assert.deepEqual(registered, [
    { id: "mark-plot", shortcut: "ctrl+shift+m" },
    { id: "mark-plot", shortcut: "ctrl+shift+m" },
  ]);
  shutdown.forEach((listener) => listener());
  pi.events.emit(EXTENSION_ACTION_DISCOVER, undefined);
  assert.equal(registration.available, false);
  assert.deepEqual(removed, ["mark-plot"]);
  assert.equal(calls, 0);
  assert.equal(registered.length, 2);
});

await test("rich surfaces replay one declaration and tool renderers name one tool", () => {
  const pi = createExtensionApi();
  let factories = 0;
  const declaration = {
    id: "garden-header",
    surface: "app-header" as const,
    source: "file:///extension/index.ts",
    frontend: new URL("file:///extension/dist/header.js"),
    backend() {
      factories += 1;
      return { id: "header-backend", setup() {} };
    },
  };
  const registration = registerRichSurface(pi, declaration);
  const seen: unknown[] = [];
  pi.events.on(RICH_SURFACE_REGISTER, (value) => {
    const event = value as RichSurfaceRegistrationEvent;
    seen.push(event.declaration);
    event.accept?.();
  });
  pi.events.emit(RICH_SURFACE_DISCOVER, undefined);
  pi.events.emit(RICH_SURFACE_DISCOVER, undefined);
  assert.equal(registration.available, true);
  assert.deepEqual(seen, [declaration, declaration]);
  assert.equal(factories, 0);
  const removed: unknown[] = [];
  pi.events.on(RICH_SURFACE_UNREGISTER, (value) => removed.push(value));
  registration.dispose();
  assert.deepEqual(removed, [declaration]);

  const tool = registerDesktopToolRenderer(pi, {
    id: "probe",
    toolName: "garden_probe",
    source: declaration.source,
    frontend: declaration.frontend,
    backend: declaration.backend,
  });
  const toolDeclaration = seen.at(-1) as { surface?: string; toolName?: string } | undefined;
  assert.equal(tool.available, true);
  assert.equal(toolDeclaration?.surface, "tool");
  assert.equal(toolDeclaration?.toolName, "garden_probe");
  assert.throws(() =>
    registerRichSurface(pi, {
      ...declaration,
      id: "sidebar-tool",
      surface: "sidebar",
      toolName: "nope",
    }),
  );
  assert.throws(() =>
    registerDesktopToolRenderer(pi, {
      id: "missing",
      toolName: "",
      source: declaration.source,
      frontend: declaration.frontend,
      backend: declaration.backend,
    }),
  );
  pi.shutdown();
});

await test("additive order and singleton winners ignore load order", () => {
  const alpha = { order: 0, extensionId: "b", id: "alpha" };
  const zeta = { order: 0, extensionId: "b", id: "zeta" };
  const middle = { order: 1, extensionId: "a", id: "middle" };
  assert.deepEqual(
    [zeta, middle, alpha].sort(compareRichSurfacePlacement).map((item) => item.id),
    ["alpha", "zeta", "middle"],
  );
  const owners = [
    { extensionId: "ext-b", id: "header" },
    { extensionId: "ext-a", id: "other" },
  ];
  assert.deepEqual(
    [...owners].reverse().sort(compareSingletonOwners),
    [...owners].sort(compareSingletonOwners),
  );
  assert.equal([...owners].sort(compareSingletonOwners)[0]?.extensionId, "ext-a");
});

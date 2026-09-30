import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_VIEW_DISCOVER,
  DESKTOP_VIEW_REGISTER,
  DESKTOP_VIEW_UNREGISTER,
  HEADER_BADGE_DISCOVER,
  HEADER_BADGE_REGISTER,
  HEADER_BADGE_UNREGISTER,
  registerDesktopView,
  registerHeaderBadge,
  type DesktopExtensionAPI,
  type DesktopViewRegistrationEvent,
  type HeaderBadgeRegistrationEvent,
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

await test("header badge discovery replays one declaration and shutdown removes it", () => {
  const pi = createExtensionApi();
  const registration = registerHeaderBadge(pi, { id: "garden", text: "  Garden  " });
  assert.equal(registration.available, false);
  const discovered: unknown[] = [];
  const removed: unknown[] = [];
  pi.events.on(HEADER_BADGE_REGISTER, (value) => {
    const event = value as HeaderBadgeRegistrationEvent;
    discovered.push(event.badge);
    event.accept?.();
  });
  pi.events.on(HEADER_BADGE_UNREGISTER, (value) => {
    removed.push(value);
  });
  pi.events.emit(HEADER_BADGE_DISCOVER, undefined);
  pi.events.emit(HEADER_BADGE_DISCOVER, undefined);
  assert.equal(registration.available, true);
  assert.deepEqual(discovered, [
    { id: "garden", text: "Garden" },
    { id: "garden", text: "Garden" },
  ]);
  assert.equal(discovered[0], discovered[1]);
  pi.shutdown();
  pi.events.emit(HEADER_BADGE_DISCOVER, undefined);
  assert.equal(registration.available, false);
  assert.deepEqual(removed, [{ id: "garden", text: "Garden" }]);
  assert.equal(discovered.length, 2);
});

await test("header badge registration rejects identifiers and text the host cannot render", () => {
  const pi = createExtensionApi();
  for (const badge of [
    { id: "Garden", text: "Garden" },
    { id: "1garden", text: "Garden" },
    { id: "garden", text: "" },
    { id: "garden", text: "   " },
    { id: "garden", text: "line\nbreak" },
    { id: "garden", text: "x".repeat(33) },
  ]) {
    assert.throws(() => registerHeaderBadge(pi, badge));
  }
});

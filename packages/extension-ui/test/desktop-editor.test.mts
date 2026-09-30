import assert from "node:assert/strict";
import test from "node:test";
import { RICH_SURFACES } from "../dist/rich-surfaces.js";
import {
  DESKTOP_EDITOR_DISCOVER,
  DESKTOP_EDITOR_REGISTER,
  registerDesktopEditor,
  type DesktopEditorDeclaration,
  type DesktopExtensionAPI,
} from "../dist/index.js";

await test("registerDesktopEditor replays one declaration and is not a rich surface", () => {
  assert.equal(RICH_SURFACES.includes("editor" as never), false);
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const shutdown: (() => void)[] = [];
  const pi = {
    events: {
      emit(type: string, value: unknown) {
        for (const listener of listeners.get(type) ?? []) listener(value);
      },
      on(type: string, listener: (value: unknown) => void) {
        const group = listeners.get(type) ?? new Set();
        group.add(listener);
        listeners.set(type, group);
        return () => group.delete(listener);
      },
    },
    on(type: string, listener: () => void) {
      if (type === "session_shutdown") shutdown.push(listener);
      return () => undefined;
    },
  } as unknown as DesktopExtensionAPI;
  const seen: DesktopEditorDeclaration[] = [];
  pi.events.on(DESKTOP_EDITOR_REGISTER, (value: unknown) => {
    const event = value as { declaration: DesktopEditorDeclaration; accept?: () => void };
    seen.push(event.declaration);
    event.accept?.();
  });
  const registration = registerDesktopEditor(pi, {
    id: "prompt",
    source: "file:///extension/index.ts",
    frontend: "file:///extension/dist/editor.js",
    title: "Prompt",
  });
  assert.equal(registration.available, true);
  pi.events.emit(DESKTOP_EDITOR_DISCOVER, {});
  assert.equal(seen.length, 2);
  assert.equal(seen[1]?.id, "prompt");
  registration.dispose();
  pi.events.emit(DESKTOP_EDITOR_DISCOVER, {});
  assert.equal(seen.length, 2);
});

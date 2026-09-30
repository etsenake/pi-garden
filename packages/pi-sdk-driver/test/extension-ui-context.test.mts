import test from "node:test";
import assert from "node:assert/strict";
import type { HostUiWorkingIndicator } from "@pi-garden/session-driver";
import type { PiHostEditor } from "../dist/session-supervisor.js";
import { SessionSupervisor } from "../dist/session-supervisor.js";
import {
  applyHostUiRequestToExtensionUiState,
  createEmptyExtensionUiState,
  replayRequestsForExtensionUiState,
  resetExtensionUiState,
  type ExtensionUiState,
} from "../dist/extension-ui-state.js";

/**
 * Drives the real `ctx.ui` object Pi extensions receive, asserting Pi's
 * `ExtensionUIContext` semantics: returned values, cancellation, AbortSignal,
 * timeout, defaults, reset, and replay. Dialog answers go through
 * `respondToHostUiRequest` exactly as the desktop main process does.
 */

type Emitted = {
  type: string;
  request?: { kind: string; requestId: string } & Record<string, unknown>;
};

function makeHarness(
  options: {
    hostEditor?: PiHostEditor;
    hostTheme?: {
      refresh(): Promise<void>;
      listThemes(workspacePath: string): readonly { name: string; path?: string }[];
      activeThemeName(workspacePath: string): string;
      setTheme(
        workspacePath: string,
        name: string,
      ): { readonly success: boolean; readonly error?: string };
    };
  } = {},
) {
  const emitted: Emitted[] = [];
  const extensionUiState: ExtensionUiState = createEmptyExtensionUiState();
  const record = {
    ref: { workspaceId: "ws-1", sessionId: "sess-1" },
    workspace: { workspaceId: "ws-1", path: "/tmp/ws-1", displayName: "ws-1" },
    title: "ui probe",
    runtime: undefined,
    session: undefined,
    sessionFile: undefined,
    status: "idle",
    updatedAt: new Date().toISOString(),
    archivedAt: undefined,
    preview: undefined,
    config: undefined,
    runningRunId: undefined,
    queuedMessages: [],
    closed: false,
    listeners: new Set([
      (event: Emitted) => {
        emitted.push(event);
      },
    ]),
    eventQueue: Promise.resolve(),
    unsubscribeAgent: undefined,
    pendingHostUiRequests: new Map(),
    extensionUiState,
    bindingExtensions: false,
    sessionCommands: [],
    leasePath: undefined,
    transcriptDiskMtimeMs: undefined,
    terminalUiObservations: [] as Emitted[],
  };
  const supervisor = new SessionSupervisor({
    catalogStorage: {
      sessions: { upsertSession: async () => undefined },
      setSessionFile: async () => undefined,
    } as never,
    ...(options.hostEditor ? { hostEditor: options.hostEditor } : {}),
    ...(options.hostTheme ? { hostTheme: options.hostTheme } : {}),
  }) as unknown as {
    createExtensionUiContext: (
      record: unknown,
    ) => import("@earendil-works/pi-coding-agent").ExtensionUIContext;
    ensureRecord: (ref: unknown) => Promise<unknown>;
    respondToHostUiRequest: (ref: unknown, response: Record<string, unknown>) => Promise<void>;
    subscribe: (ref: unknown, listener: (event: Emitted) => void) => () => void;
    records: Map<string, unknown>;
  };
  supervisor.records.set("ws-1::sess-1", record);
  supervisor.records.set("ws-1:sess-1", record);
  supervisor.ensureRecord = async () => record;
  const ui = supervisor.createExtensionUiContext(record);
  const requests = () => emitted.flatMap((event) => (event.request ? [event.request] : []));
  const lastRequest = () => requests().at(-1);
  const answer = async (response: Record<string, unknown>) => {
    await record.eventQueue;
    const request = lastRequest();
    assert.ok(request, "expected a pending dialog request");
    await supervisor.respondToHostUiRequest(record.ref, {
      requestId: request.requestId,
      ...response,
    });
  };
  return { ui, record, emitted, requests, lastRequest, answer, supervisor };
}

await test("select/confirm/input/editor return the host's answer with Pi's types", async () => {
  const h = makeHarness();

  const select = h.ui.select("Pick", ["a", "b"]);
  await h.answer({ value: "b" });
  assert.equal(await select, "b");

  const confirm = h.ui.confirm("Sure?", "Really");
  await h.answer({ confirmed: true });
  assert.equal(await confirm, true);

  const input = h.ui.input("Name", "placeholder");
  await h.answer({ value: "josh" });
  assert.equal(await input, "josh");

  const editor = h.ui.editor("Edit", "prefill");
  await h.answer({ value: "edited" });
  assert.equal(await editor, "edited");

  assert.deepEqual(
    h.requests().map((request) => request.kind),
    ["select", "confirm", "input", "editor"],
  );
  assert.equal(h.record.pendingHostUiRequests.size, 0);
});

await test("cancelling resolves to Pi's cancel values", async () => {
  const h = makeHarness();

  const select = h.ui.select("Pick", ["a"]);
  await h.answer({ cancelled: true });
  assert.equal(await select, undefined);

  const confirm = h.ui.confirm("Sure?", "Really");
  await h.answer({ cancelled: true });
  assert.equal(await confirm, false);

  const input = h.ui.input("Name");
  await h.answer({ cancelled: true });
  assert.equal(await input, undefined);

  const editor = h.ui.editor("Edit");
  await h.answer({ cancelled: true });
  assert.equal(await editor, undefined);
});

await test("AbortSignal settles the dialog with the default and tells the host to close it", async () => {
  const h = makeHarness();
  const controller = new AbortController();
  const confirm = h.ui.confirm("Sure?", "Really", { signal: controller.signal });
  await h.record.eventQueue;
  const opened = h.lastRequest();
  assert.equal(opened?.kind, "confirm");
  assert.equal(h.record.pendingHostUiRequests.size, 1);

  controller.abort();
  assert.equal(await confirm, false);
  await h.record.eventQueue;
  assert.equal(h.record.pendingHostUiRequests.size, 0);
  const closed = h.lastRequest();
  assert.equal(closed?.kind, "dialogClosed");
  assert.equal(closed?.requestId, opened?.requestId);

  // A late answer is ignored rather than throwing.
  await h.answer({ confirmed: true });
});

await test("an already-aborted signal never opens a dialog", async () => {
  const h = makeHarness();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await h.ui.select("Pick", ["a"], { signal: controller.signal }), undefined);
  await h.record.eventQueue;
  assert.equal(h.requests().length, 0);
});

await test("timeout settles the dialog with the default and closes it", async () => {
  const h = makeHarness();
  const input = h.ui.input("Name", undefined, { timeout: 20 });
  await h.record.eventQueue;
  const opened = h.lastRequest();
  assert.equal(opened?.kind, "input");
  assert.equal(opened?.timeoutMs, 20);

  assert.equal(await input, undefined);
  await h.record.eventQueue;
  assert.equal(h.record.pendingHostUiRequests.size, 0);
  assert.equal(h.lastRequest()?.kind, "dialogClosed");
});

await test("working, hidden-thinking and tools state follow Pi's defaults and setters", async () => {
  const h = makeHarness();
  const state = h.record.extensionUiState;
  // Read through a function so node:assert's type assertions don't narrow the field.
  const indicator = (): HostUiWorkingIndicator | undefined => state.workingIndicator;
  assert.equal(state.workingMessage, undefined);
  assert.equal(state.workingVisible, true);
  assert.equal(indicator(), undefined);
  assert.equal(state.hiddenThinkingLabel, undefined);
  assert.equal(h.ui.getToolsExpanded(), false);

  h.ui.setWorkingMessage("Deploying");
  h.ui.setWorkingVisible(false);
  h.ui.setWorkingIndicator({ frames: ["-", "\\", "|", "/"], intervalMs: 120 });
  h.ui.setHiddenThinkingLabel("Pondering");
  h.ui.setToolsExpanded(true);
  await h.record.eventQueue;

  assert.equal(state.workingMessage, "Deploying");
  assert.equal(state.workingVisible, false);
  assert.deepEqual(indicator(), { frames: ["-", "\\", "|", "/"], intervalMs: 120 });
  assert.equal(state.hiddenThinkingLabel, "Pondering");
  assert.equal(h.ui.getToolsExpanded(), true);

  // Static indicator, empty frames (hidden), interval-only (default frames).
  h.ui.setWorkingIndicator({ frames: ["●"] });
  await h.record.eventQueue;
  assert.deepEqual(indicator(), { frames: ["●"] });
  h.ui.setWorkingIndicator({ frames: [] });
  await h.record.eventQueue;
  assert.deepEqual(indicator(), { frames: [] });
  h.ui.setWorkingIndicator({ intervalMs: 50 });
  await h.record.eventQueue;
  assert.equal(indicator()?.frames.length, 10);
  assert.equal(indicator()?.intervalMs, 50);
  // Non-positive intervals fall back to the default interval, as in Pi.
  h.ui.setWorkingIndicator({ frames: ["a", "b"], intervalMs: 0 });
  await h.record.eventQueue;
  assert.deepEqual(indicator(), { frames: ["a", "b"] });

  // Clearing restores defaults.
  h.ui.setWorkingMessage();
  h.ui.setWorkingVisible(true);
  h.ui.setWorkingIndicator();
  h.ui.setHiddenThinkingLabel();
  h.ui.setToolsExpanded(false);
  await h.record.eventQueue;
  assert.equal(state.workingMessage, undefined);
  assert.equal(state.workingVisible, true);
  assert.equal(indicator(), undefined);
  assert.equal(state.hiddenThinkingLabel, undefined);
  assert.equal(h.ui.getToolsExpanded(), false);
});

await test("editor members operate on the host draft synchronously", async () => {
  let hostText = "host draft";
  const h = makeHarness({
    hostEditor: {
      getText: () => hostText,
      setText: (_ref, text) => {
        hostText = text;
      },
      paste: (_ref, text) => {
        hostText += text;
      },
    },
  });
  assert.equal(h.ui.getEditorText(), "host draft");

  // Set-then-read in one handler sees the write before any event is delivered.
  h.ui.setEditorText("replaced");
  assert.equal(h.ui.getEditorText(), "replaced");
  h.ui.pasteToEditor(" +pasted");
  assert.equal(h.ui.getEditorText(), "replaced +pasted");
  await h.record.eventQueue;
  assert.deepEqual(
    h.requests().map((request) => [request.kind, request.text]),
    [
      ["editorText", "replaced"],
      ["editorPaste", " +pasted"],
    ],
  );
  // The mirrored state follows for replay to late subscribers.
  assert.equal(h.record.extensionUiState.editorText, "replaced +pasted");
});

await test("without a host editor the driver serves the text extensions set", async () => {
  const h = makeHarness();
  assert.equal(h.ui.getEditorText(), "");
  h.ui.setEditorText("only mirror");
  await h.record.eventQueue;
  assert.equal(h.ui.getEditorText(), "only mirror");
});

await test("setWidget accepts string arrays only and clears on undefined", async () => {
  const h = makeHarness();
  h.ui.setWidget("w", ["line 1", "line 2"], { placement: "belowEditor" });
  await h.record.eventQueue;
  assert.deepEqual(h.record.extensionUiState.widgets.get("w"), {
    key: "w",
    lines: ["line 1", "line 2"],
    placement: "belowComposer",
  });
  h.ui.setWidget("w", undefined);
  await h.record.eventQueue;
  assert.equal(h.record.extensionUiState.widgets.has("w"), false);
});

await test("reset restores every default and replay rebuilds only non-default state", () => {
  const state = createEmptyExtensionUiState();
  const apply = (request: Record<string, unknown>) =>
    applyHostUiRequestToExtensionUiState(state, request as never);
  apply({ kind: "status", requestId: "1", key: "s", text: "busy" });
  apply({ kind: "widget", requestId: "2", key: "w", lines: ["x"], placement: "aboveComposer" });
  apply({ kind: "title", requestId: "3", title: "T" });
  apply({ kind: "editorText", requestId: "4", text: "draft" });
  apply({ kind: "editorPaste", requestId: "5", text: "!" });
  apply({ kind: "workingMessage", requestId: "6", message: "Deploying" });
  apply({ kind: "workingVisible", requestId: "7", visible: false });
  apply({ kind: "workingIndicator", requestId: "8", indicator: { frames: ["●"] } });
  apply({ kind: "hiddenThinkingLabel", requestId: "9", label: "Pondering" });
  apply({ kind: "toolsExpanded", requestId: "10", expanded: true });

  assert.equal(state.editorText, "draft!");
  const replay = replayRequestsForExtensionUiState(state).map((request) => request.kind);
  assert.deepEqual(replay, [
    "status",
    "widget",
    "title",
    "editorText",
    "workingMessage",
    "workingVisible",
    "workingIndicator",
    "hiddenThinkingLabel",
    "toolsExpanded",
  ]);

  resetExtensionUiState(state);
  assert.deepEqual(state, createEmptyExtensionUiState());
  assert.deepEqual(replayRequestsForExtensionUiState(state), []);
});

await test("theme members read and switch the desktop catalog", async () => {
  let active = "default";
  const catalog = [{ name: "harbor", path: "/themes/harbor.json" }, { name: "default" }];
  const h = makeHarness({
    hostTheme: {
      refresh: async () => undefined,
      listThemes: () => catalog,
      activeThemeName: () => active,
      setTheme: (_workspacePath, name) => {
        if (!catalog.some((theme) => theme.name === name)) {
          return { success: false, error: `Theme not found: ${name}` };
        }
        active = name;
        return { success: true };
      },
    },
  });

  // Pi's runner hands extensions a spread copy of the UI context, so `theme`
  // must stay live after being read once.
  const spread = { ...h.ui };
  assert.equal(spread.theme.name, "default");
  assert.match(spread.theme.fg("accent", "painted"), /\u001b\[38;5;4mpainted/);
  active = "harbor";
  assert.equal(spread.theme.name, "harbor");
  assert.equal(h.ui.theme.name, "harbor");
  assert.deepEqual(
    h.ui.getAllThemes().map((theme) => theme.name),
    ["default", "harbor"],
  );
  assert.equal(h.ui.getAllThemes().find((theme) => theme.name === "default")?.path, undefined);
  assert.equal(h.ui.getTheme("missing"), undefined);
  assert.equal(h.ui.getTheme("harbor")?.name, "harbor");

  assert.deepEqual(h.ui.setTheme("default"), { success: true });
  assert.equal(h.ui.theme.name, "default");
  const missing = h.ui.setTheme("invented-palette");
  assert.equal(missing.success, false);
  assert.equal(missing.error, "Theme not found: invented-palette");
  assert.equal(h.ui.theme.name, "default");
  const unrepresentable = h.ui.setTheme({});
  assert.equal(unrepresentable.success, false);
  assert.match(unrepresentable.error ?? "", /cannot be represented/);
  assert.equal(h.ui.theme.name, "default");
});

await test("terminal-only ctx.ui members report an observation instead of doing terminal work", async () => {
  const h = makeHarness();
  const component = () => ({ render: () => [], invalidate: () => {} });

  const off = h.ui.onTerminalInput(() => undefined);
  assert.equal(typeof off, "function");
  h.ui.setWidget("panel", component);
  h.ui.setHeader(component);
  h.ui.setFooter(component);
  h.ui.setEditorComponent(component as never);
  await assert.rejects(h.ui.custom(component as never), /custom/);
  await h.record.eventQueue;

  const observed = h.emitted
    .filter((event) => event.type === "extensionUiCapabilityObserved")
    .map(
      (event) =>
        (event as unknown as { observation: { capability: string; extensionPath?: string } })
          .observation,
    );
  assert.deepEqual(
    observed.map((observation) => observation.capability),
    [
      "onTerminalInput",
      "setWidget:component",
      "setHeader",
      "setFooter",
      "setEditorComponent",
      "custom",
    ],
  );
  // No extension is loaded in this harness, so nothing is guessed.
  assert.ok(observed.every((observation) => observation.extensionPath === undefined));
  // The text form of setWidget stays a served host request, not an observation.
  h.ui.setWidget("lines", ["a", "b"]);
  await h.record.eventQueue;
  assert.equal(h.lastRequest()?.kind, "widget");

  // A subscriber that arrives after session_start still learns what was observed.
  const replayed: Emitted[] = [];
  h.supervisor.subscribe(h.record.ref, (event) => replayed.push(event));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    replayed
      .filter((event) => event.type === "extensionUiCapabilityObserved")
      .map(
        (event) =>
          (event as unknown as { observation: { capability: string } }).observation.capability,
      ),
    [
      "onTerminalInput",
      "setWidget:component",
      "setHeader",
      "setFooter",
      "setEditorComponent",
      "custom",
    ],
  );
});

await test("a terminal-only call made from a loaded extension file is attributed to that extension", async () => {
  const h = makeHarness();
  const entry = new URL(import.meta.url).pathname;
  (h.record as { session?: unknown }).session = {
    resourceLoader: {
      getExtensions: () => ({
        extensions: [{ resolvedPath: entry, sourceInfo: { baseDir: undefined } }],
        errors: [],
      }),
    },
  };
  // This test file stands in for the extension entry: its frame is on the stack.
  h.ui.setFooter(() => ({ render: () => [], invalidate: () => {} }));
  await h.record.eventQueue;
  const event = h.emitted.find((entry) => entry.type === "extensionUiCapabilityObserved") as
    { observation: { capability: string; extensionPath?: string } } | undefined;
  assert.deepEqual(event?.observation, { capability: "setFooter", extensionPath: entry });
});

import test from "node:test";
import assert from "node:assert/strict";
import type { HostUiWorkingIndicator } from "@pi-garden/session-driver";
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

function makeHarness(options: { hostEditorText?: () => string | undefined } = {}) {
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
  };
  const supervisor = new SessionSupervisor({
    catalogStorage: {
      sessions: { upsertSession: async () => undefined },
      setSessionFile: async () => undefined,
    } as never,
    ...(options.hostEditorText ? { hostEditorText: options.hostEditorText } : {}),
  }) as unknown as {
    createExtensionUiContext: (
      record: unknown,
    ) => import("@earendil-works/pi-coding-agent").ExtensionUIContext;
    ensureRecord: (ref: unknown) => Promise<unknown>;
    respondToHostUiRequest: (ref: unknown, response: Record<string, unknown>) => Promise<void>;
    records: Map<string, unknown>;
  };
  supervisor.records.set("ws-1::sess-1", record);
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
  return { ui, record, emitted, requests, lastRequest, answer };
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

await test("getEditorText reads the host draft, pasteToEditor appends, setEditorText replaces", async () => {
  let hostText: string | undefined = "host draft";
  const h = makeHarness({ hostEditorText: () => hostText });
  assert.equal(h.ui.getEditorText(), "host draft");

  h.ui.pasteToEditor(" + pasted");
  await h.record.eventQueue;
  assert.equal(h.lastRequest()?.kind, "editorPaste");
  assert.equal(h.lastRequest()?.text, " + pasted");

  h.ui.setEditorText("replaced");
  await h.record.eventQueue;
  assert.equal(h.lastRequest()?.kind, "editorText");

  hostText = undefined;
  // Without a host draft the driver falls back to what extensions set.
  assert.equal(h.record.extensionUiState.editorText, "replaced");
  assert.equal(h.ui.getEditorText(), "replaced");
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

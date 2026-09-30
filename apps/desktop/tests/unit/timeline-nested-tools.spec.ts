import { expect, test } from "@playwright/test";
import { sessionKey, type SessionDriverEvent } from "@pi-garden/session-driver";
import type { TranscriptMessage } from "../../contracts/timeline-types";
import {
  applyTimelineEvent,
  displayToolName,
} from "../../electron/conversation/app-store-timeline";

const sessionRef = { workspaceId: "workspace", sessionId: "session" };
const key = sessionKey(sessionRef);
const timestamp = "2026-09-30T12:00:00.000Z";

function fixture() {
  const transcript = new Map<string, readonly TranscriptMessage[]>();
  const state: Parameters<typeof applyTimelineEvent>[2] = {
    activeAssistantMessageBySession: new Map(),
    pendingAssistantMessageBySession: new Map(),
    activeWorkingActivityBySession: new Map(),
    runningSinceBySession: new Map(),
    runMetricsBySession: new Map(),
  };
  const send = (event: SessionDriverEvent) => applyTimelineEvent(transcript, event, state);
  return { transcript, send };
}

test("displayToolName formats mcp__server__tool as server/tool", () => {
  expect(displayToolName("mcp__filesystem__read_file")).toBe("filesystem/read_file");
  expect(displayToolName("bash")).toBe("bash");
  expect(displayToolName("mcp__broken")).toBe("mcp__broken");
});

test("nested tool events store parentToolCallId, nestingDepth, and MCP labels", () => {
  const h = fixture();
  h.send({
    type: "toolStarted",
    sessionRef,
    timestamp,
    toolName: "codemode",
    callId: "parent-1",
    input: { script: "await read('a')" },
  });
  h.send({
    type: "toolStarted",
    sessionRef,
    timestamp,
    toolName: "mcp__filesystem__read_file",
    callId: "child-1",
    parentToolCallId: "parent-1",
    input: { path: "a" },
  });
  h.send({
    type: "toolFinished",
    sessionRef,
    timestamp,
    callId: "child-1",
    success: true,
    parentToolCallId: "parent-1",
    output: { ok: true },
  });

  const tools = (h.transcript.get(key) ?? []).filter(
    (item): item is Extract<TranscriptMessage, { kind: "tool" }> => item.kind === "tool",
  );
  expect(tools).toHaveLength(2);
  expect(tools[0]?.callId).toBe("parent-1");
  expect(tools[0]?.parentToolCallId).toBeUndefined();
  expect(tools[0]?.nestingDepth).toBeUndefined();
  expect(tools[1]?.callId).toBe("child-1");
  expect(tools[1]?.parentToolCallId).toBe("parent-1");
  expect(tools[1]?.nestingDepth).toBe(1);
  expect(tools[1]?.label).toContain("filesystem/read_file");
});

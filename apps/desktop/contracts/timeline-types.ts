import type { SessionTranscriptMessage, SessionTranscriptRole } from "@pi-garden/session-driver";
import type { TurnChangeSummary } from "./review";

export type SessionRole = SessionTranscriptRole;
export type TimelineTone = "neutral" | "success" | "warning" | "error";
export type TimelineToolStatus = "running" | "success" | "error";
export type TimelineSummaryPresentation = "inline" | "divider";
/**
 * Activity rows that Pi extensions can shape: the live working row
 * (`setWorkingMessage` / `setWorkingIndicator`) and `ctx.ui.notify` rows.
 */
export type TimelineActivitySource = "working" | "notify";

export interface TimelineActivity {
  readonly kind: "activity";
  readonly id: string;
  readonly createdAt: string;
  readonly label: string;
  readonly detail?: string;
  readonly metadata?: string;
  readonly tone?: TimelineTone;
  readonly source?: TimelineActivitySource;
}

export interface TimelineToolCall {
  readonly kind: "tool";
  readonly id: string;
  readonly callId: string;
  readonly toolName: string;
  readonly status: TimelineToolStatus;
  readonly label: string;
  readonly detail?: string;
  readonly metadata?: string;
  readonly createdAt: string;
  readonly input?: unknown;
  readonly output?: unknown;
  /** False while arguments are still streaming. Absent means the host has not been told. */
  readonly argumentsComplete?: boolean;
  /** False before Pi starts the tool. Absent on rows created before this field existed. */
  readonly executionStarted?: boolean;
  /** Last streaming partial result, when Pi published one. */
  readonly partial?: unknown;
}

export interface TimelineSummary {
  readonly kind: "summary";
  readonly id: string;
  readonly createdAt: string;
  readonly label: string;
  readonly metadata?: string;
  readonly presentation: TimelineSummaryPresentation;
}

export type TranscriptMessage =
  SessionTranscriptMessage | TimelineActivity | TimelineToolCall | TimelineSummary;

/**
 * A derived, view-only marker inserted between turns to show how long the agent
 * worked on the preceding user prompt. Never persisted or produced by the store;
 * the timeline computes it from real message/tool timestamps at render time, so
 * it is kept out of {@link TranscriptMessage} to avoid leaking into store code.
 */
export interface TimelineTurnMarker {
  readonly kind: "turn-marker";
  readonly id: string;
  readonly durationMs: number;
}

/** A derived, view-only card listing the files one captured turn changed, placed after that turn. */
export interface TimelineTurnChanges {
  readonly kind: "turn-changes";
  readonly id: string;
  readonly turn: TurnChangeSummary;
}

export type DisplayTimelineItem = TranscriptMessage | TimelineTurnMarker | TimelineTurnChanges;

import type { SessionRef } from "@pi-garden/session-driver/types";

/** Closed set. The renderer maps these onto theme tokens and accepts nothing else. */
export const HEADER_BADGE_TONES = [
  "default",
  "accent",
  "success",
  "warning",
  "error",
  "muted",
] as const;

export type HeaderBadgeTone = (typeof HEADER_BADGE_TONES)[number];

/** Validated header badge. The renderer receives text and a tone, never extension code. */
export interface HeaderBadgePresentation {
  readonly id: string;
  readonly text: string;
  readonly tone: HeaderBadgeTone;
}

export interface HeaderBadgeCatalogChange {
  readonly target: SessionRef;
  readonly badges: readonly HeaderBadgePresentation[];
}

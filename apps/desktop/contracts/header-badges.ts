import type { SessionRef } from "@pi-garden/session-driver/types";

/** Validated header badge. The renderer receives text, never extension code. */
export interface HeaderBadgePresentation {
  readonly id: string;
  readonly text: string;
}

export interface HeaderBadgeCatalogChange {
  readonly target: SessionRef;
  readonly badges: readonly HeaderBadgePresentation[];
}

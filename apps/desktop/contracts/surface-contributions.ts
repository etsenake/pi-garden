import type { SurfaceContribution } from "@pi-garden/extension-ui";
import type { SessionRef } from "@pi-garden/session-driver/types";

/** Validated host contribution. The renderer receives this data and never extension code. */
export type SurfaceContributionPresentation = SurfaceContribution;

export interface SurfaceContributionCatalogChange {
  readonly target: SessionRef;
  readonly contributions: readonly SurfaceContributionPresentation[];
}

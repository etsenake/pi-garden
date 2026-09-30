import type { SessionRef } from "@pi-garden/session-driver/types";

/** Kept aligned with `@pi-garden/extension-ui` `RICH_SURFACES`. */
export const DESKTOP_RICH_SURFACES = [
  "app-header",
  "app-footer",
  "sidebar",
  "thread-header",
  "composer-before",
  "composer-after",
  "overlay",
  "settings",
  "workbench",
  "tool",
] as const;

export type DesktopRichSurface = (typeof DESKTOP_RICH_SURFACES)[number];

export function isDesktopRichSurface(value: unknown): value is DesktopRichSurface {
  return typeof value === "string" && (DESKTOP_RICH_SURFACES as readonly string[]).includes(value);
}

export interface RichSurfaceConflictPeer {
  readonly extensionId: string;
  readonly id: string;
  readonly title: string;
}

export interface DesktopExtensionViewInfo {
  readonly id: string;
  readonly extensionId: string;
  readonly title: string;
  readonly generation: string;
  readonly state: "ready" | "error" | "conflict";
  /** Absent on older catalogs. Those views are workbench tabs. */
  readonly surface?: DesktopRichSurface;
  readonly order?: number;
  /** Set when `surface` is `tool`. */
  readonly toolName?: string;
  readonly error?: string;
  /** Other owners that lost a singleton or tool-renderer conflict. */
  readonly conflict?: readonly RichSurfaceConflictPeer[];
}

export interface OpenExtensionViewInput {
  readonly target: SessionRef;
  readonly extensionId: string;
  readonly viewId: string;
  /** Omitted requests the workbench view, matching `registerDesktopView`. */
  readonly surface?: DesktopRichSurface;
}

export interface ExtensionOverlayChange {
  readonly phase: "open" | "close";
  readonly requestId: string;
  readonly target: SessionRef;
  readonly extensionId: string;
  readonly viewId: string;
  readonly generation: string;
}

export interface ExtensionViewConnection {
  readonly connectionId: string;
  readonly frameUrl: string;
}

export interface ExtensionViewMessage {
  readonly connectionId: string;
  readonly message: unknown;
}

export interface ExtensionViewCatalogChange {
  readonly target: SessionRef;
  readonly views: readonly DesktopExtensionViewInfo[];
  readonly editors?: readonly import("./desktop-editor").DesktopEditorInfo[];
}

export interface ExtensionViewOpenFile {
  readonly target: SessionRef;
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

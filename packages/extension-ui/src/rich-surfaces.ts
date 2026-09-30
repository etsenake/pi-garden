import type { Facet } from "@earendil-works/chord";
import type { DesktopExtensionAPI, DesktopViewRegistration } from "./index.js";

export const RICH_SURFACE_REGISTER = "pi-garden:rich-surface:register";
export const RICH_SURFACE_DISCOVER = "pi-garden:rich-surface:discover";
export const RICH_SURFACE_UNREGISTER = "pi-garden:rich-surface:unregister";

/**
 * Named rich placements. Coordinates are not part of the author contract.
 * `tool` is the timeline presentation for one Pi tool, not a chrome slot.
 */
export const RICH_SURFACES = [
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

export type RichSurfaceKind = (typeof RICH_SURFACES)[number];

/** One mounted owner. Competing registrations are a conflict, not a silent replacement. */
export const SINGLETON_RICH_SURFACES = ["app-header", "app-footer"] as const;

export type SingletonRichSurface = (typeof SINGLETON_RICH_SURFACES)[number];

/** Several contributions share the slot. Order, then extension, then id. */
export const ADDITIVE_RICH_SURFACES = [
  "sidebar",
  "thread-header",
  "composer-before",
  "composer-after",
  "settings",
  "workbench",
] as const;

export const RICH_SURFACE_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
export const DESKTOP_TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
export const RICH_SURFACE_ORDER_LIMIT = 1_000_000;

export interface RichSurfaceDeclaration {
  readonly id: string;
  readonly surface: RichSurfaceKind;
  readonly source: string;
  readonly frontend: string | URL;
  readonly backend: () => Facet;
  /** Additive surfaces only. Omitted order is 0. Ignored for singleton placement. */
  readonly order?: number;
  /** Workbench requires a title. Other surfaces use it as host-owned display metadata. */
  readonly title?: string;
  /** Required when `surface` is `tool`. The Pi tool name this renderer owns. */
  readonly toolName?: string;
}

export interface RichSurfaceRegistrationEvent {
  readonly declaration: RichSurfaceDeclaration;
  /** Acknowledges discovery only; asset validation and activation happen later. */
  readonly accept?: () => void;
}

export interface DesktopToolRendererDeclaration {
  readonly id: string;
  readonly toolName: string;
  readonly source: string;
  readonly frontend: string | URL;
  readonly backend: () => Facet;
  readonly title?: string;
}

export function isRichSurfaceKind(value: unknown): value is RichSurfaceKind {
  return typeof value === "string" && (RICH_SURFACES as readonly string[]).includes(value);
}

export function isSingletonRichSurface(value: unknown): value is SingletonRichSurface {
  return (
    typeof value === "string" && (SINGLETON_RICH_SURFACES as readonly string[]).includes(value)
  );
}

export function validateRichSurfaceDeclaration(declaration: RichSurfaceDeclaration): void {
  if (!RICH_SURFACE_ID_PATTERN.test(declaration.id)) {
    throw new TypeError("Rich surface ID must be a lowercase identifier of at most 64 characters");
  }
  if (!isRichSurfaceKind(declaration.surface)) {
    throw new TypeError("Rich surface placement is not supported");
  }
  if (typeof declaration.source !== "string" || !declaration.source.trim()) {
    throw new TypeError("Rich surface source must be the extension entry URL");
  }
  if (typeof declaration.frontend !== "string" && !(declaration.frontend instanceof URL)) {
    throw new TypeError("Rich surface frontend must be a file URL");
  }
  if (typeof declaration.backend !== "function") {
    throw new TypeError("Rich surface must declare a backend facet factory");
  }
  if (declaration.surface === "workbench") {
    if (!declaration.title?.trim() || declaration.title.length > 120) {
      throw new TypeError("Workbench view title must contain 1 to 120 characters");
    }
  } else if (
    declaration.title !== undefined &&
    (!declaration.title.trim() || declaration.title.length > 120)
  ) {
    throw new TypeError("Rich surface title must contain 1 to 120 characters");
  }
  if (declaration.order !== undefined) {
    if (
      typeof declaration.order !== "number" ||
      !Number.isSafeInteger(declaration.order) ||
      Math.abs(declaration.order) > RICH_SURFACE_ORDER_LIMIT
    ) {
      throw new TypeError("Rich surface order must be an integer from -1000000 to 1000000");
    }
  }
  if (declaration.surface === "tool") {
    if (!declaration.toolName || !DESKTOP_TOOL_NAME_PATTERN.test(declaration.toolName)) {
      throw new TypeError("Desktop tool renderer must name the Pi tool it presents");
    }
  } else if (declaration.toolName !== undefined) {
    throw new TypeError("Only a tool renderer declaration can name a Pi tool");
  }
}

/**
 * Additive placement. Lower order first. Equal orders use extension id, then surface id.
 * Singleton winners use extension id then surface id and ignore order.
 */
export function compareRichSurfacePlacement(
  left: { readonly order?: number; readonly extensionId: string; readonly id: string },
  right: { readonly order?: number; readonly extensionId: string; readonly id: string },
): number {
  const order = (left.order ?? 0) - (right.order ?? 0);
  if (order !== 0) return order < 0 ? -1 : 1;
  const extension = left.extensionId.localeCompare(right.extensionId);
  if (extension !== 0) return extension;
  return left.id.localeCompare(right.id);
}

export function compareSingletonOwners(
  left: { readonly extensionId: string; readonly id: string },
  right: { readonly extensionId: string; readonly id: string },
): number {
  const extension = left.extensionId.localeCompare(right.extensionId);
  if (extension !== 0) return extension;
  return left.id.localeCompare(right.id);
}

/** Registers and replays one rich surface without running its backend factory. */
export function registerRichSurface(
  pi: DesktopExtensionAPI,
  declaration: RichSurfaceDeclaration,
): DesktopViewRegistration {
  validateRichSurfaceDeclaration(declaration);
  let available = false;
  let disposed = false;
  const publish = () => {
    if (disposed) return;
    pi.events.emit(RICH_SURFACE_REGISTER, {
      declaration,
      accept: () => {
        if (!disposed) available = true;
      },
    } satisfies RichSurfaceRegistrationEvent);
  };
  const stopDiscovery = pi.events.on(RICH_SURFACE_DISCOVER, publish);
  const registration: DesktopViewRegistration = {
    get available() {
      return available;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      available = false;
      stopDiscovery();
      pi.events.emit(RICH_SURFACE_UNREGISTER, declaration);
    },
  };
  pi.on("session_shutdown", () => registration.dispose());
  publish();
  return registration;
}

/** Associates one desktop renderer with one Pi tool. Execution stays in the extension backend. */
export function registerDesktopToolRenderer(
  pi: DesktopExtensionAPI,
  declaration: DesktopToolRendererDeclaration,
): DesktopViewRegistration {
  return registerRichSurface(pi, {
    id: declaration.id,
    surface: "tool",
    source: declaration.source,
    frontend: declaration.frontend,
    backend: declaration.backend,
    toolName: declaration.toolName,
    ...(declaration.title ? { title: declaration.title } : {}),
  });
}

import type { DesktopExtensionAPI } from "./index.js";

/**
 * Host-rendered surface contributions.
 * Extensions supply data. Pi Garden owns rendering, styling, and lifecycle.
 */

export const SURFACE_CONTRIBUTION_REGISTER = "pi-garden:surface-contribution:register";
export const SURFACE_CONTRIBUTION_DISCOVER = "pi-garden:surface-contribution:discover";
export const SURFACE_CONTRIBUTION_UNREGISTER = "pi-garden:surface-contribution:unregister";

/** Closed set. Do not add a surface until a real host renderer exists. */
export const SURFACE_CONTRIBUTION_SURFACES = [
  "conversation-header",
  "sidebar-footer",
  "sidebar-section",
  "composer-before",
  "composer-after",
  "status-chrome",
] as const;

export type SurfaceContributionSurface = (typeof SURFACE_CONTRIBUTION_SURFACES)[number];

/** Lowercase identifier, at most 64 characters. Shared by authors and the host. */
export const SURFACE_CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export const SURFACE_CONTRIBUTION_TEXT_MAX = 32;

/** Semantic tones the host maps onto the active theme. Not colors or class names. */
export const SURFACE_CONTRIBUTION_TONES = [
  "default",
  "accent",
  "success",
  "warning",
  "error",
  "muted",
] as const;

export type SurfaceContributionTone = (typeof SURFACE_CONTRIBUTION_TONES)[number];

/** Author input. Convenience APIs assign the surface. */
export interface HostContributionInput {
  readonly id: string;
  readonly text: string;
  /** Omitted tone is presented as `default`. */
  readonly tone?: SurfaceContributionTone;
  /** Omitted order is presented as `0`. Lower values render first. */
  readonly order?: number;
}

/** Canonical contribution. Tone and order are always present after normalization. */
export interface SurfaceContribution {
  readonly id: string;
  readonly surface: SurfaceContributionSurface;
  readonly text: string;
  readonly tone: SurfaceContributionTone;
  readonly order: number;
}

export interface SurfaceContributionRegistrationEvent {
  readonly contribution: SurfaceContribution;
  /** Acknowledges discovery only. */
  readonly accept?: () => void;
}

export interface SurfaceContributionRegistration {
  /** Whether a desktop host acknowledged this contribution; false in terminal Pi. */
  readonly available: boolean;
  dispose(): void;
}

export type HeaderBadgeDeclaration = HostContributionInput;
export type HeaderBadgeTone = SurfaceContributionTone;
export type HeaderBadgeRegistration = SurfaceContributionRegistration;
export type SidebarFooterDeclaration = HostContributionInput;
export type SidebarSectionDeclaration = HostContributionInput;

const SURFACE_LABEL: Record<SurfaceContributionSurface, string> = {
  "conversation-header": "Header badge",
  "sidebar-footer": "Sidebar footer",
  "sidebar-section": "Sidebar section",
  "composer-before": "Composer before",
  "composer-after": "Composer after",
  "status-chrome": "Status",
};

export function isSurfaceContributionSurface(value: unknown): value is SurfaceContributionSurface {
  return (
    typeof value === "string" &&
    (SURFACE_CONTRIBUTION_SURFACES as readonly string[]).includes(value)
  );
}

export function isSurfaceContributionTone(value: unknown): value is SurfaceContributionTone {
  return (
    typeof value === "string" && (SURFACE_CONTRIBUTION_TONES as readonly string[]).includes(value)
  );
}

export function surfaceContributionKey(
  contribution: Pick<SurfaceContribution, "surface" | "id">,
): string {
  return `${contribution.surface}\0${contribution.id}`;
}

/**
 * Lower order first. Equal orders use the stable id. Surfaces stay independent,
 * Surfaces are ordered by name only so a mixed snapshot is stable.
 */
export function compareSurfaceContributions(
  left: Pick<SurfaceContribution, "surface" | "order" | "id">,
  right: Pick<SurfaceContribution, "surface" | "order" | "id">,
): number {
  if (left.surface !== right.surface) return left.surface < right.surface ? -1 : 1;
  if (left.order !== right.order) return left.order < right.order ? -1 : 1;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}

/**
 * Validates an untrusted contribution and fills omitted tone and order.
 * Unknown fields, unknown surfaces, and invalid order values are rejected.
 */
export function normalizeSurfaceContribution(value: unknown): SurfaceContribution | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  for (const key of Object.keys(value)) {
    if (key !== "id" && key !== "surface" && key !== "text" && key !== "tone" && key !== "order") {
      return undefined;
    }
  }
  if (!("id" in value) || !("surface" in value) || !("text" in value)) return undefined;
  const record = value as {
    readonly id: unknown;
    readonly surface: unknown;
    readonly text: unknown;
    readonly tone?: unknown;
    readonly order?: unknown;
  };
  if (typeof record.id !== "string" || !SURFACE_CONTRIBUTION_ID_PATTERN.test(record.id)) {
    return undefined;
  }
  if (!isSurfaceContributionSurface(record.surface)) return undefined;
  if (typeof record.text !== "string" || !isContributionText(record.text)) return undefined;
  if ("tone" in value && !isSurfaceContributionTone(record.tone)) return undefined;
  if ("order" in value && !isContributionOrder(record.order)) return undefined;
  return {
    id: record.id,
    surface: record.surface,
    text: record.text,
    tone: isSurfaceContributionTone(record.tone) ? record.tone : "default",
    order: isContributionOrder(record.order) ? normalizeOrder(record.order) : 0,
  };
}

/**
 * Returns the same object when it is already in canonical form.
 * Callers that unregister by object identity must keep this reference.
 */
export function canonicalSurfaceContribution(value: unknown): SurfaceContribution | undefined {
  const normalized = normalizeSurfaceContribution(value);
  if (!normalized || typeof value !== "object" || value === null) return undefined;
  const record = value as {
    readonly id?: unknown;
    readonly surface?: unknown;
    readonly text?: unknown;
    readonly tone?: unknown;
    readonly order?: unknown;
  };
  if (
    record.id !== normalized.id ||
    record.surface !== normalized.surface ||
    record.text !== normalized.text ||
    record.tone !== normalized.tone ||
    record.order !== normalized.order
  ) {
    return undefined;
  }
  return value as SurfaceContribution;
}

/**
 * Registers one host-rendered conversation-header badge.
 * Discovery replays the same contribution; session shutdown unregisters it.
 */
export function registerHeaderBadge(
  pi: DesktopExtensionAPI,
  badge: HeaderBadgeDeclaration,
): HeaderBadgeRegistration {
  return registerSurfaceContribution(pi, "conversation-header", badge);
}

/**
 * Registers one host-rendered sidebar-footer contribution.
 * Discovery replays the same contribution; session shutdown unregisters it.
 */
export function registerSidebarFooter(
  pi: DesktopExtensionAPI,
  contribution: SidebarFooterDeclaration,
): SurfaceContributionRegistration {
  return registerSurfaceContribution(pi, "sidebar-footer", contribution);
}

/**
 * Registers one host-rendered section in the primary sidebar body.
 * Discovery replays the same contribution; session shutdown unregisters it.
 */
export function registerSidebarSection(
  pi: DesktopExtensionAPI,
  contribution: SidebarSectionDeclaration,
): SurfaceContributionRegistration {
  return registerSurfaceContribution(pi, "sidebar-section", contribution);
}

/** Registers one host-rendered label immediately before the composer. */
export function registerComposerBefore(
  pi: DesktopExtensionAPI,
  contribution: HostContributionInput,
): SurfaceContributionRegistration {
  return registerSurfaceContribution(pi, "composer-before", contribution);
}

/** Registers one host-rendered label immediately after the composer. */
export function registerComposerAfter(
  pi: DesktopExtensionAPI,
  contribution: HostContributionInput,
): SurfaceContributionRegistration {
  return registerSurfaceContribution(pi, "composer-after", contribution);
}

/** Registers one host-rendered label in the window status chrome. */
export function registerStatusChrome(
  pi: DesktopExtensionAPI,
  contribution: HostContributionInput,
): SurfaceContributionRegistration {
  return registerSurfaceContribution(pi, "status-chrome", contribution);
}

function registerSurfaceContribution(
  pi: DesktopExtensionAPI,
  surface: SurfaceContributionSurface,
  input: HostContributionInput,
): SurfaceContributionRegistration {
  const label = SURFACE_LABEL[surface];
  for (const key of Object.keys(input)) {
    if (key !== "id" && key !== "text" && key !== "tone" && key !== "order") {
      throw new TypeError(`${label} only accepts id, text, and optional tone and order`);
    }
  }
  const text = input.text.trim();
  if (!SURFACE_CONTRIBUTION_ID_PATTERN.test(input.id)) {
    throw new TypeError(`${label} ID must be a lowercase identifier of at most 64 characters`);
  }
  if (!isContributionText(text)) {
    throw new TypeError(
      `${label} text must contain 1 to ${SURFACE_CONTRIBUTION_TEXT_MAX} visible characters`,
    );
  }
  if (input.tone !== undefined && !isSurfaceContributionTone(input.tone)) {
    throw new TypeError(`${label} tone must be default, accent, success, warning, error, or muted`);
  }
  if (input.order !== undefined && !isContributionOrder(input.order)) {
    throw new TypeError(`${label} order must be a safe integer`);
  }
  const contribution: SurfaceContribution = {
    id: input.id,
    surface,
    text,
    tone: input.tone ?? "default",
    order: normalizeOrder(input.order),
  };
  let available = false;
  let disposed = false;
  const publish = () => {
    if (disposed) return;
    pi.events.emit(SURFACE_CONTRIBUTION_REGISTER, {
      contribution,
      accept: () => {
        if (!disposed) available = true;
      },
    } satisfies SurfaceContributionRegistrationEvent);
  };
  const stopDiscovery = pi.events.on(SURFACE_CONTRIBUTION_DISCOVER, publish);
  const registration: SurfaceContributionRegistration = {
    get available() {
      return available;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      available = false;
      stopDiscovery();
      pi.events.emit(SURFACE_CONTRIBUTION_UNREGISTER, contribution);
    },
  };
  pi.on("session_shutdown", () => registration.dispose());
  publish();
  return registration;
}

function isContributionText(text: string): boolean {
  return (
    text.length >= 1 &&
    text.length <= SURFACE_CONTRIBUTION_TEXT_MAX &&
    text === text.trim() &&
    !/[\u0000-\u001F\u007F]/.test(text)
  );
}

function isContributionOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function normalizeOrder(order: number | undefined): number {
  if (order === undefined || order === 0) return 0;
  return order;
}

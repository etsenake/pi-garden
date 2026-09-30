import type { Facet } from "@earendil-works/chord";

export const DESKTOP_VIEW_REGISTER = "pi-garden:desktop-view:register";
export const DESKTOP_VIEW_DISCOVER = "pi-garden:desktop-view:discover";
export const DESKTOP_VIEW_UNREGISTER = "pi-garden:desktop-view:unregister";

/** Trusted, in-process declaration. Never serialize a backend factory to a browser. */
export interface DesktopViewDeclaration {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly frontend: string | URL;
  readonly backend: () => Facet;
}

export interface DesktopViewRegistrationEvent {
  readonly declaration: DesktopViewDeclaration;
  /** Acknowledges discovery only; asset validation and activation happen later. */
  readonly accept?: () => void;
}

/** Structural subset of the public Pi extension API; no runtime Pi import. */
export interface DesktopExtensionAPI {
  readonly events: {
    emit(channel: string, data: unknown): void;
    on(channel: string, handler: (data: unknown) => void): () => void;
  };
  on(event: "session_shutdown", handler: () => void): void;
}

export interface DesktopViewRegistration {
  /** Whether a desktop host acknowledged this declaration; false in terminal Pi. */
  readonly available: boolean;
  dispose(): void;
}

export const HEADER_BADGE_REGISTER = "pi-garden:header-badge:register";
export const HEADER_BADGE_DISCOVER = "pi-garden:header-badge:discover";
export const HEADER_BADGE_UNREGISTER = "pi-garden:header-badge:unregister";

/** Lowercase identifier, at most 64 characters. Shared by authors and the host. */
export const HEADER_BADGE_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export const HEADER_BADGE_TEXT_MAX = 32;

/** Host-rendered label. The extension supplies no markup or code. */
export interface HeaderBadgeDeclaration {
  readonly id: string;
  readonly text: string;
}

export interface HeaderBadgeRegistrationEvent {
  readonly badge: HeaderBadgeDeclaration;
  /** Acknowledges discovery only. */
  readonly accept?: () => void;
}

export interface HeaderBadgeRegistration {
  /** Whether a desktop host acknowledged this badge; false in terminal Pi. */
  readonly available: boolean;
  dispose(): void;
}

export function isHeaderBadgeDeclaration(value: unknown): value is HeaderBadgeDeclaration {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("text" in value)) return false;
  const { id, text } = value;
  return typeof id === "string" && typeof text === "string" && isHeaderBadgeContent(id, text);
}

function isHeaderBadgeContent(id: string, text: string): boolean {
  return HEADER_BADGE_ID_PATTERN.test(id) && isHeaderBadgeText(text);
}

function isHeaderBadgeText(text: string): boolean {
  return (
    text.length >= 1 &&
    text.length <= HEADER_BADGE_TEXT_MAX &&
    text === text.trim() &&
    !/[\u0000-\u001F\u007F]/.test(text)
  );
}

/**
 * Registers one host-rendered conversation-header badge.
 * Discovery replays the same declaration; session shutdown unregisters it.
 */
export function registerHeaderBadge(
  pi: DesktopExtensionAPI,
  badge: HeaderBadgeDeclaration,
): HeaderBadgeRegistration {
  const text = badge.text.trim();
  if (!HEADER_BADGE_ID_PATTERN.test(badge.id)) {
    throw new TypeError("Header badge ID must be a lowercase identifier of at most 64 characters");
  }
  if (!isHeaderBadgeText(text)) {
    throw new TypeError(
      `Header badge text must contain 1 to ${HEADER_BADGE_TEXT_MAX} visible characters`,
    );
  }
  const declaration: HeaderBadgeDeclaration = { id: badge.id, text };
  let available = false;
  let disposed = false;
  const publish = () => {
    if (disposed) return;
    pi.events.emit(HEADER_BADGE_REGISTER, {
      badge: declaration,
      accept: () => {
        if (!disposed) available = true;
      },
    } satisfies HeaderBadgeRegistrationEvent);
  };
  const stopDiscovery = pi.events.on(HEADER_BADGE_DISCOVER, publish);
  const registration: HeaderBadgeRegistration = {
    get available() {
      return available;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      available = false;
      stopDiscovery();
      pi.events.emit(HEADER_BADGE_UNREGISTER, declaration);
    },
  };
  pi.on("session_shutdown", () => registration.dispose());
  publish();
  return registration;
}

/** Registers and replays the same declaration without re-running its backend factory. */
export function registerDesktopView(
  pi: DesktopExtensionAPI,
  declaration: DesktopViewDeclaration,
): DesktopViewRegistration {
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(declaration.id)) {
    throw new TypeError("Desktop view ID must be a lowercase identifier of at most 64 characters");
  }
  if (!declaration.title.trim() || declaration.title.length > 120) {
    throw new TypeError("Desktop view title must contain 1 to 120 characters");
  }
  let available = false;
  let disposed = false;
  const publish = () => {
    if (disposed) return;
    pi.events.emit(DESKTOP_VIEW_REGISTER, {
      declaration,
      accept: () => {
        if (!disposed) available = true;
      },
    } satisfies DesktopViewRegistrationEvent);
  };
  const stopDiscovery = pi.events.on(DESKTOP_VIEW_DISCOVER, publish);
  const registration: DesktopViewRegistration = {
    get available() {
      return available;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      available = false;
      stopDiscovery();
      pi.events.emit(DESKTOP_VIEW_UNREGISTER, declaration);
    },
  };
  pi.on("session_shutdown", () => registration.dispose());
  publish();
  return registration;
}

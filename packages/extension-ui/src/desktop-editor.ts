import type { Facet } from "@earendil-works/chord";
import type { DesktopExtensionAPI, DesktopViewRegistration } from "./index.js";

export const DESKTOP_EDITOR_REGISTER = "pi-garden:desktop-editor:register";
export const DESKTOP_EDITOR_DISCOVER = "pi-garden:desktop-editor:discover";
export const DESKTOP_EDITOR_UNREGISTER = "pi-garden:desktop-editor:unregister";

export const DESKTOP_EDITOR_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

/**
 * One browser editor for the prompt region.
 * This is not a rich-surface placement and it does not replace the composer.
 */
export interface DesktopEditorDeclaration {
  readonly id: string;
  readonly source: string;
  readonly frontend: string | URL;
  /** Trusted Chord backend. Omitted editors still mount with no services. */
  readonly backend?: () => Facet;
  /** Host-owned conflict and fallback text. Omitted titles use the id. */
  readonly title?: string;
}

export interface DesktopEditorRegistrationEvent {
  readonly declaration: DesktopEditorDeclaration;
  /** Acknowledges discovery only; asset validation and activation happen later. */
  readonly accept?: () => void;
}

export function validateDesktopEditorDeclaration(declaration: DesktopEditorDeclaration): void {
  if (!DESKTOP_EDITOR_ID_PATTERN.test(declaration.id)) {
    throw new TypeError(
      "Desktop editor ID must be a lowercase identifier of at most 64 characters",
    );
  }
  if (typeof declaration.source !== "string" || !declaration.source.trim()) {
    throw new TypeError("Desktop editor source must be the extension entry URL");
  }
  if (typeof declaration.frontend !== "string" && !(declaration.frontend instanceof URL)) {
    throw new TypeError("Desktop editor frontend must be a file URL");
  }
  if (declaration.backend !== undefined && typeof declaration.backend !== "function") {
    throw new TypeError("Desktop editor backend must be a facet factory");
  }
  if (
    declaration.title !== undefined &&
    (typeof declaration.title !== "string" ||
      !declaration.title.trim() ||
      declaration.title.length > 120)
  ) {
    throw new TypeError("Desktop editor title must contain 1 to 120 characters");
  }
}

/** Registers and replays one desktop editor without running its backend factory. */
export function registerDesktopEditor(
  pi: DesktopExtensionAPI,
  declaration: DesktopEditorDeclaration,
): DesktopViewRegistration {
  validateDesktopEditorDeclaration(declaration);
  let available = false;
  let disposed = false;
  const publish = () => {
    if (disposed) return;
    pi.events.emit(DESKTOP_EDITOR_REGISTER, {
      declaration,
      accept: () => {
        if (!disposed) available = true;
      },
    } satisfies DesktopEditorRegistrationEvent);
  };
  const stopDiscovery = pi.events.on(DESKTOP_EDITOR_DISCOVER, publish);
  const registration: DesktopViewRegistration = {
    get available() {
      return available;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      available = false;
      stopDiscovery();
      pi.events.emit(DESKTOP_EDITOR_UNREGISTER, declaration);
    },
  };
  pi.on("session_shutdown", () => registration.dispose());
  publish();
  return registration;
}

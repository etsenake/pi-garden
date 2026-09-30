import type { DesktopExtensionAPI } from "./index.js";

/**
 * Presentation-neutral extension actions.
 * The handler stays in the Pi extension process. The renderer only receives
 * the browser-safe record and invokes it by id through the host.
 */

export const EXTENSION_ACTION_REGISTER = "pi-garden:extension-action:register";
export const EXTENSION_ACTION_DISCOVER = "pi-garden:extension-action:discover";
export const EXTENSION_ACTION_UNREGISTER = "pi-garden:extension-action:unregister";

/** Same shape as a surface contribution id. */
export const EXTENSION_ACTION_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export const EXTENSION_ACTION_TITLE_MAX = 80;
export const EXTENSION_ACTION_DESCRIPTION_MAX = 160;

export const STALE_EXTENSION_ACTION_MESSAGE = "Extension action is no longer available.";

const SHORTCUT_MODIFIERS = ["ctrl", "alt", "shift", "super"] as const;

export type ExtensionActionKind = "action" | "command" | "shortcut";

/** What an extension can do. No callbacks leave this process. */
export interface ExtensionActionContext {
  readonly ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setStatus(key: string, text?: string): void;
  };
}

export type ExtensionActionHandler = (ctx: ExtensionActionContext) => void | Promise<void>;

export interface ExtensionActionInput {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Module URL or path of the owning extension. Use `import.meta.url`. */
  readonly source: string;
  /** Pi key id, such as `ctrl+shift+m`. Omitted when the action has no shortcut. */
  readonly shortcut?: string;
  readonly handler: ExtensionActionHandler;
}

/**
 * Browser-safe action. Shortcut is the requested binding, before desktop
 * conflict resolution. Handlers are never included.
 */
export interface ExtensionActionRecord {
  readonly id: string;
  readonly kind: ExtensionActionKind;
  readonly title: string;
  readonly description?: string;
  readonly extensionPath: string;
  readonly shortcut?: string;
  readonly commandName?: string;
  readonly hasArgumentCompletions?: boolean;
}

export interface ExtensionActionRegistrationEvent {
  readonly action: ExtensionActionRecord;
  readonly handler: ExtensionActionHandler;
  readonly accept?: () => void;
}

export interface ExtensionActionRegistration {
  readonly available: boolean;
  dispose(): void;
}

export function isExtensionActionId(value: unknown): value is string {
  return typeof value === "string" && EXTENSION_ACTION_ID_PATTERN.test(value);
}

/**
 * Canonical Pi key id: modifiers in ctrl, alt, shift, super order, then the key.
 * `cmd` and `meta` are `super`. Returns undefined when the id is not a shortcut.
 */
export function normalizeShortcut(shortcut: string): string | undefined {
  const parts = shortcut
    .trim()
    .toLowerCase()
    .split("+")
    .filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;
  const key = parts[parts.length - 1];
  if (!key || isModifierName(key)) return undefined;
  if (!isShortcutKey(key)) return undefined;
  const modifiers = new Set<(typeof SHORTCUT_MODIFIERS)[number]>();
  for (const part of parts.slice(0, -1)) {
    const modifier = modifierName(part);
    if (!modifier) return undefined;
    modifiers.add(modifier);
  }
  return [...SHORTCUT_MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

export function commandActionId(commandName: string): string {
  return `command:${commandName}`;
}

export function shortcutActionId(extensionPath: string, shortcut: string): string {
  return `shortcut:${encodeURIComponent(extensionPath)}:${shortcut}`;
}

/**
 * Registers one action owned by this Pi extension.
 * A shortcut declared here is the same action, not a second handler.
 * Discovery replays the registration. Session shutdown removes it.
 */
export function registerAction(
  pi: DesktopExtensionAPI,
  input: ExtensionActionInput,
): ExtensionActionRegistration {
  for (const key of Object.keys(input)) {
    if (
      key !== "id" &&
      key !== "title" &&
      key !== "description" &&
      key !== "source" &&
      key !== "shortcut" &&
      key !== "handler"
    ) {
      throw new TypeError(
        "Action only accepts id, title, source, handler, and optional description and shortcut",
      );
    }
  }
  if (!isExtensionActionId(input.id)) {
    throw new TypeError("Action ID must be a lowercase identifier of at most 64 characters");
  }
  const title = input.title.trim();
  if (!isBoundedText(title, EXTENSION_ACTION_TITLE_MAX)) {
    throw new TypeError(
      `Action title must contain 1 to ${EXTENSION_ACTION_TITLE_MAX} visible characters`,
    );
  }
  const description = input.description?.trim();
  if (
    input.description !== undefined &&
    !isBoundedText(description ?? "", EXTENSION_ACTION_DESCRIPTION_MAX)
  ) {
    throw new TypeError(
      `Action description must contain 1 to ${EXTENSION_ACTION_DESCRIPTION_MAX} visible characters`,
    );
  }
  if (typeof input.source !== "string" || input.source.trim().length === 0) {
    throw new TypeError("Action source must be the owning extension module URL");
  }
  if (typeof input.handler !== "function") {
    throw new TypeError("Action handler must be a function");
  }
  const shortcut = input.shortcut === undefined ? undefined : normalizeShortcut(input.shortcut);
  if (input.shortcut !== undefined && !shortcut) {
    throw new TypeError("Action shortcut must be a Pi key id such as ctrl+shift+m");
  }
  const action: ExtensionActionRecord = {
    id: input.id,
    kind: "action",
    title,
    ...(description ? { description } : {}),
    extensionPath: input.source.trim(),
    ...(shortcut ? { shortcut } : {}),
  };
  let available = false;
  let disposed = false;
  const publish = () => {
    if (disposed) return;
    pi.events.emit(EXTENSION_ACTION_REGISTER, {
      action,
      handler: input.handler,
      accept: () => {
        if (!disposed) available = true;
      },
    } satisfies ExtensionActionRegistrationEvent);
  };
  const stopDiscovery = pi.events.on(EXTENSION_ACTION_DISCOVER, publish);
  const registration: ExtensionActionRegistration = {
    get available() {
      return available;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      available = false;
      stopDiscovery();
      pi.events.emit(EXTENSION_ACTION_UNREGISTER, action);
    },
  };
  pi.on("session_shutdown", () => registration.dispose());
  publish();
  return registration;
}

function isModifierName(value: string): boolean {
  return modifierName(value) !== undefined;
}

function modifierName(value: string): (typeof SHORTCUT_MODIFIERS)[number] | undefined {
  if (value === "cmd" || value === "meta") return "super";
  return (SHORTCUT_MODIFIERS as readonly string[]).includes(value)
    ? (value as (typeof SHORTCUT_MODIFIERS)[number])
    : undefined;
}

function isShortcutKey(key: string): boolean {
  return key.length > 0 && key.length <= 32 && !/[\s\u0000-\u001F\u007F]/.test(key);
}

function isBoundedText(text: string, max: number): boolean {
  return text.length >= 1 && text.length <= max && !/[\u0000-\u001F\u007F]/.test(text);
}

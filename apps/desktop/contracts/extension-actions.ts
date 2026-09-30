import type { ExtensionActionKind, ExtensionActionRecord } from "@pi-garden/extension-ui";
import type { SessionRef } from "@pi-garden/session-driver/types";

const SHORTCUT_MODIFIERS = ["ctrl", "alt", "shift", "super"] as const;

/**
 * Same canonical form as the extension-ui shortcut normalizer.
 * The renderer cannot runtime-import that package, so keyboard matching
 * repeats the rule here: modifiers in ctrl, alt, shift, super order.
 */
function normalizeShortcut(shortcut: string): string | undefined {
  const parts = shortcut
    .trim()
    .toLowerCase()
    .split("+")
    .filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;
  const key = parts[parts.length - 1];
  if (!key || modifierName(key)) return undefined;
  if (key.length === 0 || key.length > 32 || /[\s\u0000-\u001F\u007F]/.test(key)) return undefined;
  const modifiers = new Set<(typeof SHORTCUT_MODIFIERS)[number]>();
  for (const part of parts.slice(0, -1)) {
    const modifier = modifierName(part);
    if (!modifier) return undefined;
    modifiers.add(modifier);
  }
  return [...SHORTCUT_MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

function modifierName(value: string): (typeof SHORTCUT_MODIFIERS)[number] | undefined {
  if (value === "cmd" || value === "meta") return "super";
  return (SHORTCUT_MODIFIERS as readonly string[]).includes(value)
    ? (value as (typeof SHORTCUT_MODIFIERS)[number])
    : undefined;
}

/** Action the renderer can show and invoke. The handler stays in the host. */
export interface ExtensionActionPresentation {
  readonly id: string;
  readonly kind: ExtensionActionKind;
  readonly title: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly extensionPath: string;
  readonly generation: string;
  readonly shortcut?: string;
  readonly commandName?: string;
  readonly hasArgumentCompletions?: boolean;
}

export type ExtensionActionConflictReason =
  "builtin-shortcut" | "extension-shortcut" | "duplicate-action";

/** A binding or id the host refused to let a later registration replace. */
export interface ExtensionActionConflict {
  readonly actionId: string;
  readonly extensionPath: string;
  readonly reason: ExtensionActionConflictReason;
  readonly shortcut?: string;
  readonly keptExtensionPath?: string;
  readonly message: string;
}

export interface ExtensionActionCatalog {
  readonly target: SessionRef;
  readonly generation: string;
  readonly actions: readonly ExtensionActionPresentation[];
  readonly conflicts: readonly ExtensionActionConflict[];
}

export interface ExtensionActionCatalogChange {
  readonly target: SessionRef;
  readonly catalog: ExtensionActionCatalog | null;
}

export interface ExtensionCommandCompletion {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface InvokeExtensionActionInput {
  readonly actionId: string;
  readonly generation: string;
  readonly args?: string;
}

export interface CompleteExtensionCommandInput {
  readonly generation: string;
  readonly commandName: string;
  readonly prefix: string;
}

/** Desktop chords an extension must not replace. Platform modifier is Command or Control. */
export function reservedDesktopShortcuts(platform: NodeJS.Platform): ReadonlySet<string> {
  const mod = platform === "darwin" ? "super" : "ctrl";
  const tabMod = platform === "darwin" ? "ctrl" : "alt";
  const reserved = new Set<string>();
  const add = (shortcut: string) => {
    const normalized = normalizeShortcut(shortcut);
    if (normalized) reserved.add(normalized);
  };
  for (const key of ["k", "p", ",", "b", "j", "r", "n", "f", "t", "w", "enter"]) {
    add(`${mod}+${key}`);
  }
  for (const key of ["n", "o", "r", "a"]) add(`${mod}+shift+${key}`);
  add(`${mod}+alt+b`);
  add("enter");
  add("shift+enter");
  add("ctrl+tab");
  for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    add(`${mod}+${digit}`);
    add(`${tabMod}+${digit}`);
  }
  return reserved;
}

/**
 * First extension path, then action id, wins.
 * A built-in chord is never bound. A later extension does not replace an earlier one.
 */
export function resolveExtensionActions(
  actions: readonly ExtensionActionRecord[],
  platform: NodeJS.Platform,
): {
  readonly actions: readonly Omit<ExtensionActionPresentation, "generation" | "enabled">[];
  readonly conflicts: readonly ExtensionActionConflict[];
} {
  const reserved = reservedDesktopShortcuts(platform);
  const ordered = [...actions].sort(compareActions);
  const conflicts: ExtensionActionConflict[] = [];
  const byId = new Map<string, ExtensionActionRecord>();
  for (const action of ordered) {
    const existing = byId.get(action.id);
    if (existing) {
      conflicts.push({
        actionId: action.id,
        extensionPath: action.extensionPath,
        reason: "duplicate-action",
        keptExtensionPath: existing.extensionPath,
        message: `Action '${action.id}' from ${action.extensionPath} duplicates ${existing.extensionPath} and was not registered.`,
      });
      continue;
    }
    byId.set(action.id, action);
  }
  const boundShortcuts = new Map<string, ExtensionActionRecord>();
  const resolved: Array<Omit<ExtensionActionPresentation, "generation" | "enabled">> = [];
  for (const action of byId.values()) {
    const shortcut = action.shortcut ? normalizeShortcut(action.shortcut) : undefined;
    if (!shortcut) {
      resolved.push(present(action, undefined));
      continue;
    }
    if (reserved.has(shortcut)) {
      conflicts.push({
        actionId: action.id,
        extensionPath: action.extensionPath,
        reason: "builtin-shortcut",
        shortcut,
        message: `Extension shortcut '${shortcut}' from ${action.extensionPath} conflicts with a built-in shortcut and was not bound.`,
      });
      resolved.push(present(action, undefined));
      continue;
    }
    const kept = boundShortcuts.get(shortcut);
    if (kept) {
      conflicts.push({
        actionId: action.id,
        extensionPath: action.extensionPath,
        reason: "extension-shortcut",
        shortcut,
        keptExtensionPath: kept.extensionPath,
        message: `Extension shortcut '${shortcut}' from ${action.extensionPath} conflicts with ${kept.extensionPath} and was not bound.`,
      });
      resolved.push(present(action, undefined));
      continue;
    }
    boundShortcuts.set(shortcut, action);
    resolved.push(present(action, shortcut));
  }
  resolved.sort(compareActions);
  return { actions: resolved, conflicts };
}

/** Modifier chord for a keyboard event, or undefined when the event cannot be a shortcut. */
export function keyIdFromKeyboardEvent(event: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): string | undefined {
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return undefined;
  const key = shortcutKeyFromEvent(event.key);
  if (!key) return undefined;
  const parts = [
    event.ctrlKey ? "ctrl" : undefined,
    event.altKey ? "alt" : undefined,
    event.shiftKey ? "shift" : undefined,
    event.metaKey ? "super" : undefined,
    key,
  ].filter((part): part is string => part !== undefined);
  return normalizeShortcut(parts.join("+"));
}

export function formatKeyId(platform: NodeJS.Platform, keyId: string): string {
  const normalized = normalizeShortcut(keyId) ?? keyId;
  const parts = normalized.split("+");
  const key = parts[parts.length - 1] ?? "";
  const modifiers = parts.slice(0, -1);
  const label = key.length === 1 ? key.toUpperCase() : key;
  if (platform === "darwin") {
    const symbols: Readonly<Record<string, string>> = {
      ctrl: "⌃",
      alt: "⌥",
      shift: "⇧",
      super: "⌘",
    };
    return `${modifiers.map((modifier) => symbols[modifier] ?? modifier).join("")}${label}`;
  }
  const names: Readonly<Record<string, string>> = {
    ctrl: "Ctrl",
    alt: "Alt",
    shift: "Shift",
    super: "Super",
  };
  return [...modifiers.map((modifier) => names[modifier] ?? modifier), label].join("+");
}

function present(
  action: ExtensionActionRecord,
  shortcut: string | undefined,
): Omit<ExtensionActionPresentation, "generation" | "enabled"> {
  return {
    id: action.id,
    kind: action.kind,
    title: action.title,
    ...(action.description ? { description: action.description } : {}),
    extensionPath: action.extensionPath,
    ...(shortcut ? { shortcut } : {}),
    ...(action.commandName ? { commandName: action.commandName } : {}),
    ...(action.hasArgumentCompletions ? { hasArgumentCompletions: true } : {}),
  };
}

function compareActions(
  left: Pick<ExtensionActionRecord, "extensionPath" | "id">,
  right: Pick<ExtensionActionRecord, "extensionPath" | "id">,
): number {
  const byPath = left.extensionPath.localeCompare(right.extensionPath);
  if (byPath !== 0) return byPath;
  return left.id.localeCompare(right.id);
}

function shortcutKeyFromEvent(key: string): string | undefined {
  if (key === " ") return "space";
  if (key === "Escape" || key === "Esc") return "escape";
  if (key === "Tab") return "tab";
  if (key === "Enter") return "enter";
  if (key.length === 1) return key.toLowerCase();
  return undefined;
}

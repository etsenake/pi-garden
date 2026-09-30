import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  commandActionId,
  normalizeShortcut,
  shortcutActionId,
  type ExtensionActionRecord,
} from "@pi-garden/extension-ui";

/** Bound so a slow provider cannot stall the composer. */
const COMMAND_COMPLETION_TIMEOUT_MS = 300;
const COMMAND_COMPLETION_LIMIT = 20;

export interface ExtensionCommandCompletion {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

interface LooseExtension {
  readonly path: string;
  readonly resolvedPath?: string;
  readonly hidden?: boolean;
  readonly shortcuts?: ReadonlyMap<
    string,
    {
      readonly description?: string;
      readonly handler: (ctx: object) => void | Promise<void>;
    }
  >;
}

interface LooseCommand {
  readonly invocationName?: string;
  readonly name: string;
  readonly description?: string;
  readonly sourceInfo?: { readonly path?: string };
  readonly getArgumentCompletions?: (prefix: string) => unknown;
  readonly handler: (args: string, ctx: object) => void | Promise<void>;
}

/**
 * Pi's registered commands and shortcuts for the loaded, visible extensions.
 * Hidden host factories are omitted. Handlers stay on the Pi extension objects.
 */
export function projectPiExtensionActions(session: AgentSession): readonly ExtensionActionRecord[] {
  const visible = visibleExtensions(session);
  const visiblePaths = new Set(visible.flatMap((extension) => extensionPaths(extension)));
  const actions: ExtensionActionRecord[] = [];
  for (const command of registeredCommands(session)) {
    const path = command.sourceInfo?.path;
    if (!path || !visiblePaths.has(path)) continue;
    const name = command.invocationName || command.name;
    const description = command.description?.trim();
    actions.push({
      id: commandActionId(name),
      kind: "command",
      title: description || name,
      ...(description ? { description } : {}),
      extensionPath: path,
      commandName: name,
      ...(typeof command.getArgumentCompletions === "function"
        ? { hasArgumentCompletions: true }
        : {}),
    });
  }
  for (const extension of visible) {
    const path = extension.resolvedPath || extension.path;
    for (const [key, shortcut] of extension.shortcuts ?? []) {
      const normalized = normalizeShortcut(key);
      const description = shortcut.description?.trim();
      actions.push({
        id: shortcutActionId(path, normalized ?? key),
        kind: "shortcut",
        title: description || `Shortcut ${normalized ?? key}`,
        ...(description ? { description } : {}),
        extensionPath: path,
        ...(normalized ? { shortcut: normalized } : {}),
      });
    }
  }
  return actions;
}

/** Runs a projected Pi command or shortcut. Returns false when this id is not one of them. */
export async function invokeProjectedPiAction(
  session: AgentSession,
  actionId: string,
  args: string | undefined,
): Promise<boolean> {
  const projected = projectPiExtensionActions(session).find((action) => action.id === actionId);
  if (!projected) return false;
  if (projected.kind === "command" && projected.commandName) {
    const command = registeredCommands(session).find(
      (candidate) => (candidate.invocationName || candidate.name) === projected.commandName,
    );
    if (!command) return false;
    await command.handler(args ?? "", session.extensionRunner.createCommandContext());
    return true;
  }
  if (projected.kind === "shortcut") {
    const shortcut = findShortcut(session, projected.id);
    if (!shortcut) return false;
    await shortcut.handler(session.extensionRunner.createContext());
    return true;
  }
  return false;
}

/**
 * Asks the registered Pi command for argument completions.
 * A missing provider, a thrown provider, or a provider that exceeds the timeout
 * yields an empty list.
 */
export async function completePiCommandArgument(
  session: AgentSession,
  commandName: string,
  prefix: string,
): Promise<readonly ExtensionCommandCompletion[]> {
  const command = registeredCommands(session).find(
    (candidate) => (candidate.invocationName || candidate.name) === commandName,
  );
  if (!command || typeof command.getArgumentCompletions !== "function") return [];
  const visible = new Set(
    visibleExtensions(session).flatMap((extension) => extensionPaths(extension)),
  );
  if (!command.sourceInfo?.path || !visible.has(command.sourceInfo.path)) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.resolve()
    .then(() => command.getArgumentCompletions?.(prefix))
    .then(sanitizeCompletions, () => [] as ExtensionCommandCompletion[]);
  try {
    return await new Promise<readonly ExtensionCommandCompletion[]>((resolve) => {
      timer = setTimeout(() => resolve([]), COMMAND_COMPLETION_TIMEOUT_MS);
      void pending.then(
        (items) => resolve(items),
        () => resolve([]),
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function visibleExtensions(session: AgentSession): readonly LooseExtension[] {
  const loader = session.resourceLoader as {
    getExtensions?: () => { readonly extensions?: readonly LooseExtension[] };
  };
  return (loader.getExtensions?.().extensions ?? []).filter((extension) => !extension.hidden);
}

function extensionPaths(extension: LooseExtension): readonly string[] {
  return [extension.path, extension.resolvedPath].filter((path): path is string => Boolean(path));
}

function registeredCommands(session: AgentSession): readonly LooseCommand[] {
  return (session.extensionRunner?.getRegisteredCommands() ?? []) as readonly LooseCommand[];
}

function findShortcut(
  session: AgentSession,
  actionId: string,
): { readonly handler: (ctx: object) => void | Promise<void> } | undefined {
  for (const extension of visibleExtensions(session)) {
    const path = extension.resolvedPath || extension.path;
    for (const [key, shortcut] of extension.shortcuts ?? []) {
      const normalized = normalizeShortcut(key);
      if (shortcutActionId(path, normalized ?? key) === actionId) return shortcut;
    }
  }
  return undefined;
}

function sanitizeCompletions(value: unknown): ExtensionCommandCompletion[] {
  if (!Array.isArray(value)) return [];
  const items: ExtensionCommandCompletion[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as {
      readonly value?: unknown;
      readonly label?: unknown;
      readonly description?: unknown;
    };
    if (typeof record.value !== "string" || record.value.length === 0) continue;
    if (typeof record.label !== "string" || record.label.length === 0) continue;
    items.push({
      value: record.value,
      label: record.label,
      ...(typeof record.description === "string" && record.description.length > 0
        ? { description: record.description }
        : {}),
    });
    if (items.length >= COMMAND_COMPLETION_LIMIT) break;
  }
  return items;
}

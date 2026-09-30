import { fileURLToPath } from "node:url";
import {
  STALE_EXTENSION_ACTION_MESSAGE,
  type ExtensionActionRecord,
} from "@pi-garden/extension-ui";
import { sessionKey, type SessionRef } from "@pi-garden/session-driver";
import {
  resolveExtensionActions,
  type ExtensionActionCatalog,
  type ExtensionCommandCompletion,
} from "../../contracts/extension-actions";

export interface ExtensionActionRegistryRuntimeInput {
  readonly target: SessionRef;
  readonly generation: string;
  readonly actions: readonly unknown[];
}

export interface ExtensionActionDelegate {
  invoke(
    target: SessionRef,
    generation: string,
    actionId: string,
    args: string | undefined,
  ): Promise<void>;
  complete(
    target: SessionRef,
    generation: string,
    commandName: string,
    prefix: string,
  ): Promise<readonly ExtensionCommandCompletion[]>;
}

interface SessionActions {
  readonly generation: string;
  readonly target: SessionRef;
  readonly catalog: ExtensionActionCatalog;
}

/**
 * Presents extension actions for one Pi runtime generation.
 * A replaced or invalidated generation cannot be invoked.
 */
export class ExtensionActionRegistry {
  private readonly sessions = new Map<string, SessionActions>();
  private readonly retired = new Map<string, Set<string>>();
  private readonly listeners = new Set<(target: SessionRef) => void>();
  private delegate: ExtensionActionDelegate | undefined;

  bind(delegate: ExtensionActionDelegate): void {
    this.delegate = delegate;
  }

  subscribe(listener: (target: SessionRef) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  catalog(target: SessionRef): ExtensionActionCatalog | undefined {
    const current = this.sessions.get(sessionKey(target));
    if (!current) return undefined;
    return {
      ...current.catalog,
      actions: current.catalog.actions.map((action) => ({ ...action })),
      conflicts: current.catalog.conflicts.map((conflict) => ({ ...conflict })),
    };
  }

  replaceRuntime(input: ExtensionActionRegistryRuntimeInput): void {
    const key = sessionKey(input.target);
    if (this.isRetired(key, input.generation)) return;
    const current = this.sessions.get(key);
    if (current && current.generation !== input.generation) {
      this.retire(key, current.generation);
    }
    const target = {
      workspaceId: input.target.workspaceId,
      sessionId: input.target.sessionId,
    };
    const resolved = resolveExtensionActions(
      presentableActions(input.actions).map((action) => ({
        ...action,
        extensionPath: comparableExtensionPath(action.extensionPath),
      })),
      process.platform,
    );
    this.sessions.set(key, {
      generation: input.generation,
      target,
      catalog: {
        target,
        generation: input.generation,
        actions: resolved.actions.map((action) => ({
          ...action,
          generation: input.generation,
          enabled: true,
        })),
        conflicts: resolved.conflicts,
      },
    });
    this.publish(target);
  }

  invalidateRuntime(target: SessionRef, generation: string): void {
    const key = sessionKey(target);
    this.retire(key, generation);
    const current = this.sessions.get(key);
    if (current?.generation !== generation) return;
    this.sessions.delete(key);
    this.publish(target);
  }

  async invoke(
    target: SessionRef,
    generation: string,
    actionId: string,
    args: string | undefined,
  ): Promise<void> {
    this.requireAction(target, generation, actionId);
    const delegate = this.delegate;
    if (!delegate) throw new Error(STALE_EXTENSION_ACTION_MESSAGE);
    await delegate.invoke(target, generation, actionId, args);
  }

  async complete(
    target: SessionRef,
    generation: string,
    commandName: string,
    prefix: string,
  ): Promise<readonly ExtensionCommandCompletion[]> {
    const current = this.sessions.get(sessionKey(target));
    if (!current || current.generation !== generation) return [];
    const command = current.catalog.actions.find(
      (action) => action.commandName === commandName && action.hasArgumentCompletions,
    );
    if (!command) return [];
    const delegate = this.delegate;
    if (!delegate) return [];
    return delegate.complete(target, generation, commandName, prefix);
  }

  private requireAction(target: SessionRef, generation: string, actionId: string): void {
    const key = sessionKey(target);
    const current = this.sessions.get(key);
    if (
      !current ||
      current.generation !== generation ||
      this.isRetired(key, generation) ||
      !current.catalog.actions.some((action) => action.id === actionId && action.enabled)
    ) {
      throw new Error(STALE_EXTENSION_ACTION_MESSAGE);
    }
  }

  private isRetired(key: string, generation: string): boolean {
    return this.retired.get(key)?.has(generation) ?? false;
  }

  private retire(key: string, generation: string): void {
    const generations = this.retired.get(key) ?? new Set<string>();
    generations.add(generation);
    this.retired.set(key, generations);
  }

  private publish(target: SessionRef): void {
    for (const listener of this.listeners) listener(target);
  }
}

function comparableExtensionPath(path: string): string {
  if (!path.startsWith("file:")) return path;
  try {
    return fileURLToPath(path);
  } catch {
    return path;
  }
}

function presentableActions(actions: readonly unknown[]): readonly ExtensionActionRecord[] {
  const records: ExtensionActionRecord[] = [];
  for (const value of actions) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as {
      readonly id?: unknown;
      readonly kind?: unknown;
      readonly title?: unknown;
      readonly description?: unknown;
      readonly extensionPath?: unknown;
      readonly shortcut?: unknown;
      readonly commandName?: unknown;
      readonly hasArgumentCompletions?: unknown;
    };
    if (typeof record.id !== "string" || record.id.length === 0) continue;
    if (record.kind !== "action" && record.kind !== "command" && record.kind !== "shortcut") {
      continue;
    }
    if (typeof record.title !== "string" || record.title.length === 0) continue;
    if (typeof record.extensionPath !== "string" || record.extensionPath.length === 0) continue;
    records.push({
      id: record.id,
      kind: record.kind,
      title: record.title,
      ...(typeof record.description === "string" && record.description.length > 0
        ? { description: record.description }
        : {}),
      extensionPath: record.extensionPath,
      ...(typeof record.shortcut === "string" && record.shortcut.length > 0
        ? { shortcut: record.shortcut }
        : {}),
      ...(typeof record.commandName === "string" && record.commandName.length > 0
        ? { commandName: record.commandName }
        : {}),
      ...(record.hasArgumentCompletions === true ? { hasArgumentCompletions: true } : {}),
    });
  }
  return records;
}

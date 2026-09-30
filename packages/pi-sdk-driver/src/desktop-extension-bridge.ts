import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createEventBus,
  type CreateAgentSessionServicesOptions,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  DESKTOP_VIEW_DISCOVER,
  DESKTOP_VIEW_REGISTER,
  DESKTOP_VIEW_UNREGISTER,
  EXTENSION_ACTION_DISCOVER,
  EXTENSION_ACTION_REGISTER,
  EXTENSION_ACTION_UNREGISTER,
  STALE_EXTENSION_ACTION_MESSAGE,
  SURFACE_CONTRIBUTION_DISCOVER,
  SURFACE_CONTRIBUTION_REGISTER,
  SURFACE_CONTRIBUTION_UNREGISTER,
  canonicalSurfaceContribution,
  compareSurfaceContributions,
  surfaceContributionKey,
  type DesktopViewDeclaration,
  type DesktopViewRegistrationEvent,
  type ExtensionActionHandler,
  type ExtensionActionRecord,
  type ExtensionActionRegistrationEvent,
  type SurfaceContribution,
  type SurfaceContributionRegistrationEvent,
} from "@pi-garden/extension-ui";
import type { SessionRef, WorkspaceRef } from "@pi-garden/session-driver";

type ResourceLoaderOptions = NonNullable<
  CreateAgentSessionServicesOptions["resourceLoaderOptions"]
>;

export interface PiDesktopExtensionRuntime {
  readonly target: SessionRef;
  readonly generation: string;
  readonly extensions: readonly { readonly resolvedPath: string }[];
  readonly declarations: readonly DesktopViewDeclaration[];
  /** Data-only host contributions from the extensions loaded in this runtime. */
  readonly contributions: readonly SurfaceContribution[];
  /**
   * Explicit actions plus Pi commands and shortcuts projected for this generation.
   * Handlers are not included.
   */
  readonly actions: readonly ExtensionActionRecord[];
}

export interface PiDesktopExtensionObserver {
  /** Invoked immediately; asynchronous UI work must not delay ordinary Pi lifecycle events. */
  onChanged(runtime: PiDesktopExtensionRuntime): void | Promise<void>;
  /** Revoke capabilities before awaiting cleanup; Pi does not wait for authored view code. */
  onInvalidated(runtime: {
    readonly target: SessionRef;
    readonly generation: string;
  }): void | Promise<void>;
}

export interface DesktopExtensionActionBridge {
  mergeResourceLoaderOptions(existing: ResourceLoaderOptions): ResourceLoaderOptions;
  /** The generation currently bound to this session, if the runtime is live. */
  generationFor(target: SessionRef): string | undefined;
  /**
   * Runs an explicit `registerAction` handler for the current generation.
   * Returns false when the id is not an explicit action. A stale generation throws.
   */
  invokeExplicit(
    target: SessionRef,
    generation: string,
    actionId: string,
    ctx: Parameters<ExtensionActionHandler>[0],
  ): Promise<boolean>;
}

/** A discovery adapter around stable Pi extension APIs; Chord hosts stay with the caller. */
export function createDesktopExtensionBridge(options: {
  readonly workspace: WorkspaceRef;
  readonly observer: PiDesktopExtensionObserver;
  /** Pi commands and shortcuts joined onto the explicit actions before publication. */
  projectActions?(
    target: SessionRef,
    explicit: readonly ExtensionActionRecord[],
  ): readonly ExtensionActionRecord[];
}): DesktopExtensionActionBridge {
  const eventBus = createEventBus();
  const declarations = new Set<DesktopViewDeclaration>();
  const contributions = new Map<string, SurfaceContribution>();
  const explicitActions = new Map<
    string,
    {
      readonly source: ExtensionActionRecord;
      readonly action: ExtensionActionRecord;
      readonly handler: ExtensionActionHandler;
    }
  >();
  let loadedExtensions: readonly { readonly resolvedPath: string }[] = [];
  let active: { readonly target: SessionRef; readonly generation: string } | undefined;
  let discovering = false;

  const notify = (operation: () => void | Promise<void>): void => {
    try {
      void Promise.resolve(operation()).catch((error: unknown) => {
        console.error("Desktop extension lifecycle failed", error);
      });
    } catch (error) {
      console.error("Desktop extension lifecycle failed", error);
    }
  };

  const publish = (): void => {
    const epoch = active;
    if (!epoch || discovering) return;
    const explicit = [...explicitActions.values()].map((entry) => entry.action);
    const snapshot: PiDesktopExtensionRuntime = {
      ...epoch,
      extensions: loadedExtensions.map((extension) => ({ ...extension })),
      declarations: [...declarations],
      contributions: [...contributions.values()].sort(compareSurfaceContributions),
      actions: options.projectActions?.(epoch.target, explicit) ?? explicit,
    };
    notify(() => options.observer.onChanged(snapshot));
  };

  eventBus.on(DESKTOP_VIEW_REGISTER, (value) => {
    if (!isRegistration(value)) return;
    declarations.add(value.declaration);
    value.accept?.();
    publish();
  });
  eventBus.on(DESKTOP_VIEW_UNREGISTER, (value) => {
    if (!declarations.delete(value as DesktopViewDeclaration)) return;
    publish();
  });
  eventBus.on(SURFACE_CONTRIBUTION_REGISTER, (value) => {
    if (!isContributionRegistration(value)) return;
    contributions.set(surfaceContributionKey(value.contribution), value.contribution);
    value.accept?.();
    publish();
  });
  eventBus.on(SURFACE_CONTRIBUTION_UNREGISTER, (value) => {
    const contribution = canonicalSurfaceContribution(value);
    if (!contribution) return;
    const key = surfaceContributionKey(contribution);
    if (contributions.get(key) !== contribution) return;
    contributions.delete(key);
    publish();
  });
  eventBus.on(EXTENSION_ACTION_REGISTER, (value) => {
    if (!isActionRegistration(value)) return;
    explicitActions.set(value.action.id, {
      source: value.action,
      action: {
        ...value.action,
        extensionPath: owningExtensionPath(value.action.extensionPath),
      },
      handler: value.handler,
    });
    value.accept?.();
    publish();
  });
  eventBus.on(EXTENSION_ACTION_UNREGISTER, (value) => {
    if (!isActionRecord(value)) return;
    const current = explicitActions.get(value.id);
    if (!current || current.source !== value) return;
    explicitActions.delete(value.id);
    publish();
  });

  const lifecycle: ExtensionFactory = (pi) => {
    pi.on("session_start", (_event, context) => {
      active = {
        target: {
          workspaceId: options.workspace.workspaceId,
          sessionId: context.sessionManager.getSessionId(),
        },
        generation: randomUUID(),
      };
      // Only live Pi extension instances answer; registration does not execute their factory again.
      declarations.clear();
      contributions.clear();
      explicitActions.clear();
      discovering = true;
      try {
        eventBus.emit(DESKTOP_VIEW_DISCOVER, {});
        eventBus.emit(SURFACE_CONTRIBUTION_DISCOVER, {});
        eventBus.emit(EXTENSION_ACTION_DISCOVER, {});
      } finally {
        discovering = false;
      }
      publish();
    });
    pi.on("session_shutdown", () => {
      const epoch = active;
      active = undefined;
      declarations.clear();
      contributions.clear();
      explicitActions.clear();
      if (!epoch) return;
      notify(() => options.observer.onInvalidated(epoch));
    });
  };

  return {
    generationFor(target) {
      if (!sameSession(active, target)) return undefined;
      return active.generation;
    },
    async invokeExplicit(target, generation, actionId, ctx) {
      if (!sameSession(active, target) || active.generation !== generation) {
        throw new Error(STALE_EXTENSION_ACTION_MESSAGE);
      }
      const entry = explicitActions.get(actionId);
      if (!entry) return false;
      await entry.handler(ctx);
      return true;
    },
    mergeResourceLoaderOptions(existing) {
      return {
        ...existing,
        eventBus,
        extensionFactories: [
          ...(existing.extensionFactories ?? []),
          { name: "pi-garden-desktop-views", hidden: true, factory: lifecycle },
        ],
        extensionsOverride(result) {
          const selected = existing.extensionsOverride?.(result) ?? result;
          loadedExtensions = selected.extensions.map(({ resolvedPath }) => ({ resolvedPath }));
          return selected;
        },
      };
    },
  };
}

function sameSession(
  active: { readonly target: SessionRef; readonly generation: string } | undefined,
  target: SessionRef,
): active is { readonly target: SessionRef; readonly generation: string } {
  return (
    active !== undefined &&
    active.target.workspaceId === target.workspaceId &&
    active.target.sessionId === target.sessionId
  );
}

function owningExtensionPath(source: string): string {
  if (!source.startsWith("file:")) return source;
  try {
    return fileURLToPath(source);
  } catch {
    return source;
  }
}

function isActionRecord(value: unknown): value is ExtensionActionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { readonly id?: unknown; readonly kind?: unknown };
  return record.kind === "action" && typeof record.id === "string";
}

function isActionRegistration(value: unknown): value is ExtensionActionRegistrationEvent {
  if (
    typeof value !== "object" ||
    value === null ||
    !("action" in value) ||
    !("handler" in value)
  ) {
    return false;
  }
  if (typeof value.handler !== "function" || !isActionRecord(value.action)) return false;
  return !("accept" in value) || value.accept === undefined || typeof value.accept === "function";
}

function isContributionRegistration(value: unknown): value is SurfaceContributionRegistrationEvent {
  if (typeof value !== "object" || value === null || !("contribution" in value)) return false;
  if (!canonicalSurfaceContribution(value.contribution)) return false;
  return !("accept" in value) || value.accept === undefined || typeof value.accept === "function";
}

function isRegistration(value: unknown): value is DesktopViewRegistrationEvent {
  if (typeof value !== "object" || value === null || !("declaration" in value)) return false;
  const declaration = value.declaration;
  return (
    typeof declaration === "object" &&
    declaration !== null &&
    "id" in declaration &&
    typeof declaration.id === "string" &&
    "title" in declaration &&
    typeof declaration.title === "string" &&
    "source" in declaration &&
    typeof declaration.source === "string" &&
    "frontend" in declaration &&
    (typeof declaration.frontend === "string" || declaration.frontend instanceof URL) &&
    "backend" in declaration &&
    typeof declaration.backend === "function" &&
    (!("accept" in value) || value.accept === undefined || typeof value.accept === "function")
  );
}

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createFacetHost, type FacetHost } from "@earendil-works/chord";
import type { DesktopViewDeclaration, RichSurfaceDeclaration } from "@pi-garden/extension-ui";
import {
  compareRichSurfacePlacement,
  compareSingletonOwners,
  isRichSurfaceKind,
  type RichSurfaceKind,
} from "@pi-garden/extension-ui";
import type { DesktopHostAction, DesktopOverlayResult } from "@pi-garden/extension-ui/browser";
import { createChordServerConnection } from "@pi-garden/extension-ui/transport";
import { sessionKey, type SessionRef } from "@pi-garden/session-driver";
import type {
  DesktopExtensionViewInfo,
  DesktopRichSurface,
  RichSurfaceConflictPeer,
} from "../../contracts/extension-views";
import {
  resolveDesktopExtensionAsset,
  validateDesktopExtensionIdentity,
  validateDesktopExtensionFrontend,
  type DesktopExtensionSourceIdentity,
  type LoadedDesktopExtensionSource,
  type ValidatedDesktopExtensionSource,
} from "./extension-view-source";

export const DESKTOP_EXTENSION_SCHEME = "pi-extension";

export type { DesktopExtensionViewInfo } from "../../contracts/extension-views";

export interface DesktopExtensionRuntimeInput {
  readonly target: SessionRef;
  readonly generation: string;
  readonly extensions: readonly LoadedDesktopExtensionSource[];
  /** Workbench views from `registerDesktopView`. */
  readonly declarations: readonly DesktopViewDeclaration[];
  /** Generalized rich surfaces, including tool renderers and rich workbench views. */
  readonly richSurfaces?: readonly RichSurfaceDeclaration[];
}

export interface DesktopExtensionOverlayEvent {
  readonly phase: "open" | "close";
  readonly requestId: string;
  readonly senderId: number;
  readonly target: SessionRef;
  readonly extensionId: string;
  readonly viewId: string;
  readonly generation: string;
}

export interface DesktopExtensionConnectionContext {
  readonly connectionId: string;
  readonly senderId: number;
  readonly target: SessionRef;
  readonly generation: string;
  readonly extensionId: string;
  readonly viewId: string;
}

export interface DesktopExtensionHostAsset {
  readonly body: string | Uint8Array;
  readonly contentType: string;
}

export interface DesktopExtensionViewOwnerOptions {
  readonly frameDocument: (input: {
    readonly connectionId: string;
    readonly frontendUrl: string;
    readonly bridgeUrl: string;
    readonly nonce: string;
  }) => string;
  readonly hostAssets?: Readonly<Record<string, DesktopExtensionHostAsset>>;
  readonly onHostAction: (
    context: DesktopExtensionConnectionContext & { readonly action: DesktopHostAction },
  ) => Promise<unknown>;
  readonly onOverlay?: (event: DesktopExtensionOverlayEvent) => void;
  readonly onDiagnostic?: (target: SessionRef, source: string, message: string) => void;
  readonly activationTimeoutMs?: number;
}

interface RuntimeEntry {
  readonly target: SessionRef;
  readonly generation: string;
  readonly views: Map<string, ViewEntry>;
  readonly pending: Map<SurfaceDeclaration, Promise<void>>;
  readonly activating: Map<string, SurfaceDeclaration>;
  desired: ReadonlySet<SurfaceDeclaration>;
  alive: boolean;
}

type SurfaceDeclaration = DesktopViewDeclaration | RichSurfaceDeclaration;

interface ViewEntry {
  readonly declaration: SurfaceDeclaration;
  readonly surface: RichSurfaceKind;
  readonly order: number;
  readonly source: DesktopExtensionSourceIdentity;
  readonly assets?: ValidatedDesktopExtensionSource;
  readonly info: DesktopExtensionViewInfo;
  readonly host?: FacetHost;
}

interface PendingOverlay {
  readonly requestId: string;
  readonly presenterConnectionId: string;
  readonly runtime: RuntimeEntry;
  readonly senderId: number;
  readonly extensionId: string;
  readonly viewId: string;
  readonly resolve: (result: DesktopOverlayResult) => void;
}

interface ConnectionEntry {
  readonly context: DesktopExtensionConnectionContext;
  readonly runtime: RuntimeEntry;
  readonly view: ViewEntry;
  readonly assets: ValidatedDesktopExtensionSource;
  readonly send: (message: unknown) => void;
  readonly transport: ReturnType<typeof createChordServerConnection>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function viewKey(extensionId: string, surface: RichSurfaceKind, viewId: string): string {
  return `${extensionId}:${surface}:${viewId}`;
}

function surfaceOf(declaration: SurfaceDeclaration): RichSurfaceKind {
  if ("surface" in declaration && isRichSurfaceKind(declaration.surface))
    return declaration.surface;
  return "workbench";
}

function orderOf(declaration: SurfaceDeclaration): number {
  if ("order" in declaration && typeof declaration.order === "number") return declaration.order;
  return 0;
}

function titleOf(declaration: SurfaceDeclaration): string {
  if ("title" in declaration && typeof declaration.title === "string" && declaration.title.trim()) {
    return declaration.title;
  }
  return declaration.id;
}

function toolNameOf(declaration: SurfaceDeclaration): string | undefined {
  if ("toolName" in declaration && typeof declaration.toolName === "string") {
    return declaration.toolName;
  }
  return undefined;
}

function validateDeclaration(declaration: SurfaceDeclaration): void {
  const surface = surfaceOf(declaration);
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(declaration.id)) {
    throw new Error(
      surface === "workbench"
        ? "Desktop view ID must be a lowercase identifier of at most 64 characters"
        : "Rich surface ID must be a lowercase identifier of at most 64 characters",
    );
  }
  const title = "title" in declaration ? declaration.title : undefined;
  if (
    surface === "workbench" &&
    (typeof title !== "string" || !title.trim() || title.length > 120)
  ) {
    throw new Error("Desktop view title must be 1–120 characters");
  }
  if (
    surface !== "workbench" &&
    title !== undefined &&
    (typeof title !== "string" || !title.trim() || title.length > 120)
  ) {
    throw new Error("Rich surface title must be 1–120 characters");
  }
  if (typeof declaration.backend !== "function") {
    throw new Error("Desktop view must declare a backend facet factory");
  }
  const order = orderOf(declaration);
  if (!Number.isSafeInteger(order) || Math.abs(order) > 1_000_000) {
    throw new Error("Rich surface order must be an integer from -1000000 to 1000000");
  }
  const toolName = toolNameOf(declaration);
  if (surface === "tool") {
    if (!toolName || !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(toolName)) {
      throw new Error("Desktop tool renderer must name the Pi tool it presents");
    }
  } else if (toolName !== undefined) {
    throw new Error("Only a tool renderer declaration can name a Pi tool");
  }
}

/** Owns live extension views, never Pi session selection or durable extension state. */
export class DesktopExtensionViewOwner {
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly connections = new Map<string, ConnectionEntry>();
  private readonly listeners = new Set<(target: SessionRef) => void>();
  private readonly pendingOverlays = new Map<string, PendingOverlay>();

  constructor(private readonly options: DesktopExtensionViewOwnerOptions) {}

  subscribe(listener: (target: SessionRef) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listViews(target: SessionRef): readonly DesktopExtensionViewInfo[] {
    const runtime = this.runtimes.get(sessionKey(target));
    if (!runtime?.alive) return [];
    return [...runtime.views.values()]
      .map(({ info }) => ({ ...info }))
      .sort((left, right) => {
        const surface = (left.surface ?? "workbench").localeCompare(right.surface ?? "workbench");
        if (surface !== 0) return surface;
        return compareRichSurfacePlacement(
          { order: left.order, extensionId: left.extensionId, id: left.id },
          { order: right.order, extensionId: right.extensionId, id: right.id },
        );
      });
  }

  async replaceRuntime(input: DesktopExtensionRuntimeInput): Promise<void> {
    const key = sessionKey(input.target);
    let runtime = this.runtimes.get(key);
    const surfaces = runtimeSurfaces(input);
    if (runtime?.generation !== input.generation) {
      const previous = runtime;
      runtime = {
        target: { ...input.target },
        generation: input.generation,
        views: new Map(),
        pending: new Map(),
        activating: new Map(),
        desired: new Set(surfaces),
        alive: true,
      };
      this.runtimes.set(key, runtime);
      if (previous)
        this.disposeRuntime(previous).catch((error: unknown) => {
          this.options.onDiagnostic?.(previous.target, "desktop-view", messageOf(error));
        });
    }
    if (!runtime.alive) return;
    const declarations = new Set(surfaces);
    runtime.desired = declarations;
    for (const [registeredKey, view] of runtime.views) {
      if (declarations.has(view.declaration)) continue;
      runtime.views.delete(registeredKey);
      this.closeViewConnections(runtime, view, "Extension view was removed");
      if (view.host)
        view.host.dispose().catch((error: unknown) => {
          this.options.onDiagnostic?.(runtime.target, view.source.sourcePath, messageOf(error));
        });
    }
    const activations: Promise<void>[] = [];
    for (const declaration of declarations) {
      if ([...runtime.views.values()].some((view) => view.declaration === declaration)) continue;
      const pending = runtime.pending.get(declaration);
      if (pending) {
        activations.push(pending);
        continue;
      }
      const activation = this.activateView(runtime, declaration, input.extensions).finally(() => {
        runtime.pending.delete(declaration);
      });
      runtime.pending.set(declaration, activation);
      activations.push(activation);
    }
    await Promise.all(activations);
    if (runtime.alive) this.reconcile(runtime);
    this.publish(runtime.target);
  }

  async invalidateRuntime(target: SessionRef, generation: string): Promise<void> {
    const key = sessionKey(target);
    const runtime = this.runtimes.get(key);
    if (runtime?.generation !== generation) return;
    this.runtimes.delete(key);
    const disposal = this.disposeRuntime(runtime);
    this.publish(target);
    await disposal;
  }

  async openConnection(
    input: {
      readonly target: SessionRef;
      readonly extensionId: string;
      readonly viewId: string;
      readonly surface?: DesktopRichSurface;
      readonly senderId: number;
    },
    send: (message: unknown) => void,
  ): Promise<{ readonly connectionId: string; readonly frameUrl: string }> {
    const runtime = this.runtimes.get(sessionKey(input.target));
    const surface = input.surface ?? "workbench";
    const view = runtime?.views.get(viewKey(input.extensionId, surface, input.viewId));
    if (!runtime?.alive || !view?.host || !view.assets) {
      throw new Error(view?.info.error ?? "Desktop extension view is unavailable");
    }
    const connectionId = randomUUID();
    const context: DesktopExtensionConnectionContext = {
      connectionId,
      senderId: input.senderId,
      target: { ...runtime.target },
      generation: runtime.generation,
      extensionId: input.extensionId,
      viewId: input.viewId,
    };
    const transport = createChordServerConnection({
      provider: view.host.services,
      send: (message) => {
        if (!this.connections.has(connectionId)) return;
        try {
          send(message);
        } catch {
          this.closeConnection(connectionId, input.senderId);
        }
      },
      onError: (error) => {
        this.options.onDiagnostic?.(runtime.target, view.source.sourcePath, messageOf(error));
        this.closeConnection(connectionId, input.senderId);
      },
    });
    this.connections.set(connectionId, {
      context,
      runtime,
      view,
      assets: view.assets,
      send,
      transport,
    });
    return { connectionId, frameUrl: `${DESKTOP_EXTENSION_SCHEME}://${connectionId}/` };
  }

  getConnectionContext(connectionId: string, senderId: number): DesktopExtensionConnectionContext {
    const connection = this.requireConnection(connectionId, senderId);
    return { ...connection.context, target: { ...connection.context.target } };
  }

  async receive(connectionId: string, senderId: number, message: unknown): Promise<void> {
    const connection = this.requireConnection(connectionId, senderId);
    await connection.transport.receive(message);
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "closed"
    ) {
      this.closeConnection(connectionId, senderId);
    }
  }

  async invokeHostAction(
    connectionId: string,
    senderId: number,
    action: DesktopHostAction,
  ): Promise<unknown> {
    const context = this.getConnectionContext(connectionId, senderId);
    return this.options.onHostAction({ ...context, action });
  }

  presentOverlay(
    context: DesktopExtensionConnectionContext,
    surfaceId: string,
  ): Promise<DesktopOverlayResult> {
    const runtime = this.runtimes.get(sessionKey(context.target));
    const view = runtime?.views.get(viewKey(context.extensionId, "overlay", surfaceId));
    if (
      !runtime?.alive ||
      runtime.generation !== context.generation ||
      !view?.host ||
      !view.assets
    ) {
      return Promise.reject(new Error(view?.info.error ?? "Desktop overlay is unavailable"));
    }
    if (view.info.state !== "ready") {
      return Promise.reject(new Error(view.info.error ?? "Desktop overlay is unavailable"));
    }
    const key = overlayKey(context.senderId, context.extensionId, surfaceId);
    this.finishOverlay(key, { status: "cancelled" });
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const pending: PendingOverlay = {
        requestId,
        presenterConnectionId: context.connectionId,
        runtime,
        senderId: context.senderId,
        extensionId: context.extensionId,
        viewId: surfaceId,
        resolve,
      };
      this.pendingOverlays.set(key, pending);
      this.options.onOverlay?.({
        phase: "open",
        requestId,
        senderId: context.senderId,
        target: { ...runtime.target },
        extensionId: context.extensionId,
        viewId: surfaceId,
        generation: runtime.generation,
      });
    });
  }

  settleOverlay(context: DesktopExtensionConnectionContext, value: unknown): void {
    this.completeOverlay(context, { status: "result", value: value ?? null });
  }

  cancelOverlay(context: DesktopExtensionConnectionContext): void {
    this.completeOverlay(context, { status: "cancelled" });
  }

  dismissOverlay(senderId: number): void {
    for (const [key, pending] of this.pendingOverlays) {
      if (pending.senderId === senderId) this.finishOverlay(key, { status: "cancelled" });
    }
  }

  closeConnection(connectionId: string, senderId: number): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    if (connection.context.senderId !== senderId)
      throw new Error("Desktop view connection belongs to another window");
    this.close(connection, "Desktop view was closed");
  }

  closeSender(senderId: number): void {
    for (const connection of [...this.connections.values()]) {
      if (connection.context.senderId === senderId)
        this.close(connection, "Desktop window was closed");
    }
  }

  /** Protocol handler: a random live connection grants read access only to its browser build. */
  async assetResponse(requestUrl: string): Promise<Response> {
    try {
      const url = new URL(requestUrl);
      if (
        url.protocol !== `${DESKTOP_EXTENSION_SCHEME}:` ||
        url.username ||
        url.password ||
        url.port ||
        url.search
      ) {
        return new Response("Unavailable", { status: 404 });
      }
      const connection = this.connections.get(url.hostname);
      if (!connection || !connection.runtime.alive)
        return new Response("Unavailable", { status: 404 });
      const headers = new Headers({
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
      });
      if (url.pathname === "/") {
        const nonce = randomUUID();
        const origin = `${DESKTOP_EXTENSION_SCHEME}://${connection.context.connectionId}`;
        headers.set("Content-Type", "text/html; charset=utf-8");
        headers.set(
          "Content-Security-Policy",
          [
            "default-src 'none'",
            `script-src 'nonce-${nonce}' ${origin}`,
            `style-src 'unsafe-inline' ${origin}`,
            `img-src data: ${origin}`,
            `font-src ${origin}`,
            "connect-src 'none'",
            "object-src 'none'",
            "frame-src 'none'",
            "worker-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "sandbox allow-scripts",
          ].join("; "),
        );
        const body = this.options.frameDocument({
          connectionId: connection.context.connectionId,
          frontendUrl: `${origin}/assets/${encodeURIComponent(path.basename(connection.assets.frontendPath))}`,
          bridgeUrl: `${origin}/_host/frame-bridge.js`,
          nonce,
        });
        return new Response(body, { headers });
      }
      if (url.pathname.startsWith("/_host/")) {
        const assetName = url.pathname.slice("/_host/".length);
        const asset =
          this.options.hostAssets && Object.hasOwn(this.options.hostAssets, assetName)
            ? this.options.hostAssets[assetName]
            : undefined;
        if (!asset) return new Response("Unavailable", { status: 404 });
        headers.set("Content-Type", asset.contentType);
        return new Response(
          typeof asset.body === "string" ? asset.body : new Uint8Array(asset.body),
          { headers },
        );
      }
      if (!url.pathname.startsWith("/assets/")) return new Response("Unavailable", { status: 404 });
      const assetPath = await resolveDesktopExtensionAsset(
        connection.assets.assetRoot,
        url.pathname.slice("/assets/".length),
      );
      const contents = await readFile(assetPath);
      if (this.connections.get(url.hostname) !== connection)
        return new Response("Unavailable", { status: 404 });
      const contentType = assetContentType(assetPath);
      if (!contentType) return new Response("Unsupported asset", { status: 415 });
      headers.set("Content-Type", contentType);
      return new Response(new Uint8Array(contents), { headers });
    } catch {
      return new Response("Unavailable", { status: 404 });
    }
  }

  async dispose(): Promise<void> {
    const runtimes = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.all(runtimes.map((runtime) => this.disposeRuntime(runtime)));
    this.listeners.clear();
  }

  private async activateView(
    runtime: RuntimeEntry,
    declaration: SurfaceDeclaration,
    extensions: readonly LoadedDesktopExtensionSource[],
  ): Promise<void> {
    let source: DesktopExtensionSourceIdentity | undefined;
    let key: string | undefined;
    let reserved = false;
    try {
      validateDeclaration(declaration);
      const surface = surfaceOf(declaration);
      source = await validateDesktopExtensionIdentity(declaration.source, extensions);
      if (!runtime.alive || !runtime.desired.has(declaration)) return;
      key = viewKey(source.extensionId, surface, declaration.id);
      const pendingDeclaration = runtime.activating.get(key);
      if (
        runtime.views.has(key) ||
        (pendingDeclaration && runtime.desired.has(pendingDeclaration))
      ) {
        throw new Error(
          surface === "workbench"
            ? "Duplicate desktop view ID in one extension"
            : "Duplicate rich surface ID in one extension",
        );
      }
      // A removed registration cannot reserve its ID while authored activation is still pending.
      runtime.activating.set(key, declaration);
      reserved = true;
      const assets = await validateDesktopExtensionFrontend(source, declaration.frontend);
      if (!runtime.alive || !runtime.desired.has(declaration)) return;
      const activation = createFacetHost({
        facets: [declaration.backend()],
        onError: (error) =>
          this.options.onDiagnostic?.(runtime.target, declaration.source, messageOf(error)),
      });
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Chord activation is cooperative. A late result still owns resources and must be disposed.
      void activation
        .then((host) => {
          if (expired) return host.dispose();
        })
        .catch((error: unknown) => {
          if (expired)
            this.options.onDiagnostic?.(runtime.target, declaration.source, messageOf(error));
        });
      let host: FacetHost;
      try {
        host = await Promise.race([
          activation,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              expired = true;
              reject(
                new Error("Desktop view activation timed out. Reload the extension to retry."),
              );
            }, this.options.activationTimeoutMs ?? 10_000);
            timer.unref();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!runtime.alive || !runtime.desired.has(declaration)) {
        await host.dispose();
        return;
      }
      runtime.views.set(key, viewRecord(runtime, declaration, source, "ready", { assets, host }));
    } catch (error) {
      const message = messageOf(error);
      this.options.onDiagnostic?.(runtime.target, declaration.source, message);
      if (
        runtime.alive &&
        runtime.desired.has(declaration) &&
        source &&
        key &&
        !runtime.views.has(key) &&
        (reserved || !runtime.activating.has(key))
      ) {
        runtime.views.set(
          key,
          viewRecord(runtime, declaration, source, "error", { error: message }),
        );
      }
    } finally {
      if (key && reserved && runtime.activating.get(key) === declaration)
        runtime.activating.delete(key);
      if (runtime.alive) this.publish(runtime.target);
    }
  }

  private requireConnection(connectionId: string, senderId: number): ConnectionEntry {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.runtime.alive)
      throw new Error("Desktop view connection is unavailable");
    if (connection.context.senderId !== senderId)
      throw new Error("Desktop view connection belongs to another window");
    return connection;
  }

  private close(connection: ConnectionEntry, reason: string): void {
    this.connections.delete(connection.context.connectionId);
    this.cancelOverlaysForConnection(connection);
    connection.transport.close(reason);
    try {
      connection.send({ type: "closed", reason });
    } catch {
      /* The owning window can already be gone. */
    }
  }

  private closeViewConnections(runtime: RuntimeEntry, view: ViewEntry, reason: string): void {
    for (const connection of [...this.connections.values()]) {
      if (connection.runtime === runtime && connection.view === view)
        this.close(connection, reason);
    }
  }

  private async disposeRuntime(runtime: RuntimeEntry): Promise<void> {
    runtime.alive = false;
    for (const [key, pending] of this.pendingOverlays) {
      if (pending.runtime === runtime) this.finishOverlay(key, { status: "cancelled" });
    }
    for (const connection of [...this.connections.values()]) {
      if (connection.runtime === runtime)
        this.close(connection, "Pi extension runtime was replaced");
    }
    await Promise.allSettled(runtime.pending.values());
    const hosts = [...runtime.views.values()].flatMap(({ host }) => (host ? [host] : []));
    runtime.views.clear();
    const results = await Promise.allSettled(hosts.map((host) => host.dispose()));
    for (const result of results) {
      if (result.status === "rejected")
        this.options.onDiagnostic?.(runtime.target, "desktop-view", messageOf(result.reason));
    }
  }

  private publish(target: SessionRef): void {
    for (const listener of this.listeners) listener({ ...target });
  }

  private reconcile(runtime: RuntimeEntry): void {
    for (const surface of ["app-header", "app-footer"] as const) {
      this.reconcileSingleton(runtime, surface);
    }
    this.reconcileToolRenderers(runtime);
  }

  private reconcileSingleton(runtime: RuntimeEntry, surface: "app-header" | "app-footer"): void {
    const contenders = [...runtime.views.values()].filter(
      (view) =>
        view.surface === surface &&
        (view.info.state === "conflict" || (view.info.state === "ready" && view.host)),
    );
    if (contenders.length === 0) return;
    const sorted = [...contenders].sort((left, right) =>
      compareSingletonOwners(
        { extensionId: left.source.extensionId, id: left.declaration.id },
        { extensionId: right.source.extensionId, id: right.declaration.id },
      ),
    );
    const winner = sorted.find((view) => view.info.state === "ready" && view.host) ?? sorted[0];
    if (!winner?.host) return;
    const losers = sorted.filter((view) => view !== winner);
    const peers = (entry: ViewEntry): RichSurfaceConflictPeer => ({
      extensionId: entry.source.extensionId,
      id: entry.declaration.id,
      title: entry.info.title,
    });
    if (losers.length === 0) {
      runtime.views.set(viewKey(winner.source.extensionId, surface, winner.declaration.id), {
        ...winner,
        info: { ...winner.info, conflict: undefined },
      });
      return;
    }
    const message = `Competing ${surface} owners: ${sorted.map((entry) => entry.info.title).join(", ")}`;
    this.options.onDiagnostic?.(runtime.target, "rich-surface", message);
    runtime.views.set(viewKey(winner.source.extensionId, surface, winner.declaration.id), {
      ...winner,
      info: { ...winner.info, conflict: losers.map(peers) },
    });
    for (const loser of losers) this.demote(runtime, loser, message);
  }

  private reconcileToolRenderers(runtime: RuntimeEntry): void {
    const groups = new Map<string, ViewEntry[]>();
    for (const view of runtime.views.values()) {
      if (
        view.surface !== "tool" ||
        view.info.state !== "ready" ||
        !view.info.toolName ||
        !view.host
      ) {
        continue;
      }
      const group = groups.get(view.info.toolName) ?? [];
      group.push(view);
      groups.set(view.info.toolName, group);
    }
    for (const [toolName, group] of groups) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((left, right) =>
        compareSingletonOwners(
          { extensionId: left.source.extensionId, id: left.declaration.id },
          { extensionId: right.source.extensionId, id: right.declaration.id },
        ),
      );
      const message = `Competing desktop renderers for tool ${toolName}: ${sorted
        .map((entry) => entry.info.title)
        .join(", ")}`;
      this.options.onDiagnostic?.(runtime.target, "rich-surface", message);
      for (const entry of sorted) this.demote(runtime, entry, message);
    }
  }

  private demote(runtime: RuntimeEntry, view: ViewEntry, message: string): void {
    const key = viewKey(view.source.extensionId, view.surface, view.declaration.id);
    this.closeViewConnections(runtime, view, message);
    runtime.views.set(key, {
      ...view,
      host: undefined,
      info: { ...view.info, state: "conflict", error: message, conflict: undefined },
    });
    if (view.host) {
      view.host.dispose().catch((error: unknown) => {
        this.options.onDiagnostic?.(runtime.target, view.source.sourcePath, messageOf(error));
      });
    }
  }

  private completeOverlay(
    context: DesktopExtensionConnectionContext,
    result: DesktopOverlayResult,
  ): void {
    const connection = this.requireConnection(context.connectionId, context.senderId);
    if (connection.view.surface !== "overlay") {
      throw new Error("Only an overlay can settle or cancel its result");
    }
    const key = overlayKey(context.senderId, context.extensionId, connection.view.declaration.id);
    const pending = this.pendingOverlays.get(key);
    if (!pending) throw new Error("This overlay is not open");
    this.finishOverlay(key, result);
  }

  private cancelOverlaysForConnection(connection: ConnectionEntry): void {
    for (const [key, pending] of this.pendingOverlays) {
      const presenter = pending.presenterConnectionId === connection.context.connectionId;
      const overlay =
        connection.view.surface === "overlay" &&
        pending.senderId === connection.context.senderId &&
        pending.extensionId === connection.context.extensionId &&
        pending.viewId === connection.view.declaration.id;
      if (presenter || overlay) this.finishOverlay(key, { status: "cancelled" });
    }
  }

  private finishOverlay(key: string, result: DesktopOverlayResult): void {
    const pending = this.pendingOverlays.get(key);
    if (!pending) return;
    this.pendingOverlays.delete(key);
    pending.resolve(result);
    this.options.onOverlay?.({
      phase: "close",
      requestId: pending.requestId,
      senderId: pending.senderId,
      target: { ...pending.runtime.target },
      extensionId: pending.extensionId,
      viewId: pending.viewId,
      generation: pending.runtime.generation,
    });
  }
}

function runtimeSurfaces(input: DesktopExtensionRuntimeInput): SurfaceDeclaration[] {
  return [...input.declarations, ...(input.richSurfaces ?? [])];
}

function viewRecord(
  runtime: RuntimeEntry,
  declaration: SurfaceDeclaration,
  source: DesktopExtensionSourceIdentity,
  state: DesktopExtensionViewInfo["state"],
  extra: {
    readonly assets?: ValidatedDesktopExtensionSource;
    readonly host?: FacetHost;
    readonly error?: string;
  },
): ViewEntry {
  const surface = surfaceOf(declaration);
  const toolName = toolNameOf(declaration);
  return {
    declaration,
    surface,
    order: orderOf(declaration),
    source,
    ...(extra.assets ? { assets: extra.assets } : {}),
    ...(extra.host ? { host: extra.host } : {}),
    info: {
      id: declaration.id,
      extensionId: source.extensionId,
      title: titleOf(declaration),
      generation: runtime.generation,
      state,
      surface,
      order: orderOf(declaration),
      ...(toolName ? { toolName } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    },
  };
}

function overlayKey(senderId: number, extensionId: string, viewId: string): string {
  return `${senderId}:${extensionId}:${viewId}`;
}

function assetContentType(file: string): string | undefined {
  const types: Readonly<Record<string, string>> = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[path.extname(file).toLowerCase()];
}

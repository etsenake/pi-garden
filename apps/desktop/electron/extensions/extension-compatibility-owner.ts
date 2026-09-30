import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PiDesktopExtensionRuntime } from "@pi-garden/pi-sdk-driver";
import {
  sessionKey,
  type ExtensionTerminalUiCapability,
  type SessionRef,
} from "@pi-garden/session-driver";
import type { RuntimeExtensionRecord } from "@pi-garden/session-driver/runtime-types";
import {
  adaptableFindings,
  buildCompatibilityFinding,
  compareCompatibilityFindings,
  type ExtensionAdaptationAvailability,
  type ExtensionCapabilityId,
  type ExtensionCompatibilityEvidence,
  type ExtensionCompatibilityFinding,
  type ExtensionCompatibilityInventory,
  type ExtensionRuntimeEvidence,
  type ExtensionSourceEvidence,
} from "../../contracts/extension-compatibility";
import {
  analyzeExtensionSource,
  type ExtensionSourceAnalysis,
} from "./extension-compatibility-analyzer";

/**
 * Composes the per-extension desktop compatibility inventory.
 *
 * Source evidence comes from the bounded analyzer and is cached by entry file
 * mtime. Runtime evidence arrives through the existing desktop extension
 * bridge (registrations of the current generation) and the driver's
 * terminal-only `ctx.ui` observations; it is held per session generation and
 * discarded when that generation is replaced or invalidated. Nothing here is
 * persisted, so a stale generation can never be replayed as current truth.
 */

export interface ExtensionCompatibilityWorkspace {
  readonly workspaceId: string;
  readonly path: string;
}

export interface ExtensionCompatibilityOwnerDeps {
  /** Pi's project trust decision for a workspace; project-local edits require it. */
  readonly isProjectTrusted: (workspacePath: string) => Promise<boolean>;
  readonly analyze?: typeof analyzeExtensionSource;
}

interface RuntimeGeneration {
  readonly target: SessionRef;
  readonly generation: string;
  /** Realpath of extension entry → evidence observed in this generation. */
  readonly evidence: Map<string, Map<ExtensionCapabilityId, ExtensionRuntimeEvidence[]>>;
}

interface PendingObservation {
  readonly extensionPath: string;
  readonly capability: ExtensionCapabilityId;
  readonly observedAt: string;
  readonly attribution: "call-site" | "reported";
  readonly detail: string;
}

/** Observations made before a generation publishes are held this long. */
const PENDING_WINDOW_MS = 30_000;
const PENDING_LIMIT = 64;

interface SourceCacheEntry {
  readonly mtimeMs: number;
  readonly analysis: ExtensionSourceAnalysis;
}

const TERMINAL_UI_CAPABILITIES: Readonly<
  Record<ExtensionTerminalUiCapability, ExtensionCapabilityId>
> = {
  onTerminalInput: "ui.onTerminalInput",
  "setWidget:component": "ui.widget.component",
  setHeader: "ui.setHeader",
  setFooter: "ui.setFooter",
  custom: "ui.custom",
  setEditorComponent: "ui.setEditorComponent",
};

export class ExtensionCompatibilityOwner {
  private readonly generations = new Map<string, RuntimeGeneration>();
  private readonly retired = new Map<string, Set<string>>();
  private readonly pending = new Map<string, PendingObservation[]>();
  private readonly sourceCache = new Map<string, SourceCacheEntry>();
  private readonly listeners = new Set<(workspaceId: string) => void>();
  private readonly analyze: typeof analyzeExtensionSource;

  constructor(private readonly deps: ExtensionCompatibilityOwnerDeps) {
    this.analyze = deps.analyze ?? analyzeExtensionSource;
  }

  subscribe(listener: (workspaceId: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Registration evidence for the generation the bridge just published. */
  async replaceRuntime(runtime: PiDesktopExtensionRuntime): Promise<void> {
    const key = sessionKey(runtime.target);
    if (this.isRetired(key, runtime.generation)) return;
    const current = this.generations.get(key);
    if (current && current.generation !== runtime.generation) {
      this.retire(key, current.generation);
    }
    const generation: RuntimeGeneration =
      current?.generation === runtime.generation
        ? current
        : { target: runtime.target, generation: runtime.generation, evidence: new Map() };
    // Registration evidence is replaced wholesale; call-site evidence for the same generation stays.
    for (const perExtension of generation.evidence.values()) {
      for (const [capability, items] of perExtension) {
        const kept = items.filter((item) => item.attribution !== "registration");
        if (kept.length > 0) perExtension.set(capability, kept);
        else perExtension.delete(capability);
      }
    }
    const observedAt = new Date().toISOString();
    const add = async (source: string, capability: ExtensionCapabilityId, detail: string) => {
      const extensionPath = await realExtensionPath(source);
      if (!extensionPath) return;
      this.record(generation, extensionPath, capability, {
        kind: "runtime",
        generation: runtime.generation,
        sessionId: runtime.target.sessionId,
        observedAt,
        attribution: "registration",
        detail,
      });
    };
    for (const declaration of runtime.declarations) {
      await add(declaration.source, "garden.registerDesktopView", `view ${declaration.id}`);
    }
    for (const surface of runtime.richSurfaces) {
      await add(
        surface.source,
        surface.surface === "tool"
          ? "garden.registerDesktopToolRenderer"
          : "garden.registerRichSurface",
        `${surface.surface} ${surface.id}`,
      );
    }
    for (const editor of runtime.editors) {
      await add(editor.source, "garden.registerDesktopEditor", `editor ${editor.id}`);
    }
    for (const action of runtime.actions) {
      if (action.kind !== "action") continue;
      await add(action.extensionPath, "garden.registerAction", `action ${action.id}`);
    }
    // The bridge may have invalidated this generation while sources were resolving.
    if (this.isRetired(key, runtime.generation)) return;
    const cutoff = Date.parse(observedAt) - PENDING_WINDOW_MS;
    for (const observation of this.pending.get(key) ?? []) {
      if (Date.parse(observation.observedAt) >= cutoff) this.attach(generation, observation);
    }
    this.pending.delete(key);
    this.generations.set(key, generation);
    this.publish(runtime.target.workspaceId);
  }

  invalidateRuntime(target: SessionRef, generation: string): void {
    const key = sessionKey(target);
    this.retire(key, generation);
    this.pending.delete(key);
    const current = this.generations.get(key);
    if (current?.generation !== generation) return;
    this.generations.delete(key);
    this.publish(target.workspaceId);
  }

  /**
   * A live terminal-only `ctx.ui` call reported by the driver. It joins the
   * session's current generation; a call that lands before the bridge has
   * published that generation (for example inside `session_start`) waits
   * briefly and is attached when the generation arrives.
   */
  async observeTerminalUi(input: {
    readonly target: SessionRef;
    readonly capability: ExtensionTerminalUiCapability;
    readonly extensionPath: string | undefined;
    readonly observedAt: string;
    readonly attribution: "call-site" | "reported";
  }): Promise<void> {
    if (!input.extensionPath) return;
    const extensionPath = await realExtensionPath(input.extensionPath);
    if (!extensionPath) return;
    const key = sessionKey(input.target);
    const observation: PendingObservation = {
      extensionPath,
      capability: TERMINAL_UI_CAPABILITIES[input.capability],
      observedAt: input.observedAt,
      attribution: input.attribution,
      detail: `ctx.ui.${input.capability.replace(":component", "")} called`,
    };
    const generation = this.generations.get(key);
    if (!generation) {
      const pending = this.pending.get(key) ?? [];
      pending.push(observation);
      this.pending.set(key, pending.slice(-PENDING_LIMIT));
      return;
    }
    this.attach(generation, observation);
    this.publish(input.target.workspaceId);
  }

  private attach(generation: RuntimeGeneration, observation: PendingObservation): void {
    this.record(generation, observation.extensionPath, observation.capability, {
      kind: "runtime",
      generation: generation.generation,
      sessionId: generation.target.sessionId,
      observedAt: observation.observedAt,
      attribution: observation.attribution,
      detail: observation.detail,
    });
  }

  async inventory(input: {
    readonly workspace: ExtensionCompatibilityWorkspace;
    readonly extension: RuntimeExtensionRecord;
    readonly refresh?: boolean;
  }): Promise<ExtensionCompatibilityInventory> {
    const { workspace, extension } = input;
    const builtin = isPiGardenBuiltinExtension(extension);
    const analysis = builtin
      ? skippedAnalysis("pi-garden's own extensions have no user source to inspect.")
      : await this.sourceAnalysis(extension.path, input.refresh === true);
    const evidence = new Map<ExtensionCapabilityId, ExtensionCompatibilityEvidence[]>();
    for (const [capability, items] of analysis.evidence) {
      evidence.set(capability, [...items]);
    }
    const generations: { sessionId: string; generation: string }[] = [];
    const extensionRealPath = builtin ? undefined : await realExtensionPath(extension.path);
    for (const generation of this.generations.values()) {
      if (generation.target.workspaceId !== workspace.workspaceId) continue;
      const perExtension = extensionRealPath
        ? generation.evidence.get(extensionRealPath)
        : undefined;
      if (!perExtension) continue;
      generations.push({
        sessionId: generation.target.sessionId,
        generation: generation.generation,
      });
      for (const [capability, items] of perExtension) {
        evidence.set(capability, [...(evidence.get(capability) ?? []), ...items]);
      }
    }
    const findings: ExtensionCompatibilityFinding[] = [...evidence.entries()]
      .map(([capability, items]) => buildCompatibilityFinding(capability, items))
      .sort(compareCompatibilityFindings);
    const adaptation = await this.adaptationAvailability(workspace, extension, findings);
    return {
      extensionPath: extension.path,
      workspaceId: workspace.workspaceId,
      sourceInfo: extension.sourceInfo,
      source: analysis.inspection,
      runtime: { generations },
      findings,
      adaptation,
    };
  }

  /** Gating shared by the inventory and the Adapt action; the action re-checks it. */
  async adaptationAvailability(
    workspace: ExtensionCompatibilityWorkspace,
    extension: RuntimeExtensionRecord,
    findings: readonly ExtensionCompatibilityFinding[],
  ): Promise<ExtensionAdaptationAvailability> {
    if (isPiGardenBuiltinExtension(extension)) {
      return {
        available: false,
        reason: "builtin",
        message: "pi-garden's own extensions are already desktop-native.",
      };
    }
    const { sourceInfo } = extension;
    if (sourceInfo.origin === "package" || isInsideNodeModules(extension.path)) {
      return {
        available: false,
        reason: "package",
        message:
          "Installed packages are inventoried but not edited in place. Adapt the package from its source checkout.",
      };
    }
    if (sourceInfo.scope === "temporary" || !path.isAbsolute(extension.path)) {
      return {
        available: false,
        reason: "temporary",
        message: "Only extensions loaded from your user or workspace folders can be adapted.",
      };
    }
    if (!(await isFile(extension.path))) {
      return {
        available: false,
        reason: "not-a-file",
        message: "The extension entry file could not be found.",
      };
    }
    if (sourceInfo.scope === "project" && !(await this.deps.isProjectTrusted(workspace.path))) {
      return {
        available: false,
        reason: "untrusted-project",
        message: "Trust this project in Pi before adapting its workspace extensions.",
      };
    }
    if (adaptableFindings(findings).length === 0) {
      return {
        available: false,
        reason: "nothing-to-adapt",
        message: "No terminal-specific presentation was found to adapt.",
      };
    }
    return { available: true, message: "Opens a Pi thread that adapts this extension." };
  }

  private async sourceAnalysis(
    entryPath: string,
    refresh: boolean,
  ): Promise<ExtensionSourceAnalysis> {
    let mtimeMs: number | undefined;
    try {
      mtimeMs = (await stat(entryPath)).mtimeMs;
    } catch {
      mtimeMs = undefined;
    }
    const cached = this.sourceCache.get(entryPath);
    if (!refresh && cached && mtimeMs !== undefined && cached.mtimeMs === mtimeMs) {
      return cached.analysis;
    }
    const analysis = await this.analyze(entryPath);
    if (mtimeMs !== undefined) this.sourceCache.set(entryPath, { mtimeMs, analysis });
    return analysis;
  }

  private record(
    generation: RuntimeGeneration,
    extensionPath: string,
    capability: ExtensionCapabilityId,
    item: ExtensionRuntimeEvidence,
  ): void {
    const perExtension =
      generation.evidence.get(extensionPath) ??
      new Map<ExtensionCapabilityId, ExtensionRuntimeEvidence[]>();
    const items = perExtension.get(capability) ?? [];
    if (
      !items.some(
        (existing) => existing.attribution === item.attribution && existing.detail === item.detail,
      )
    ) {
      items.push(item);
    }
    perExtension.set(capability, items);
    generation.evidence.set(extensionPath, perExtension);
  }

  private isRetired(key: string, generation: string): boolean {
    return this.retired.get(key)?.has(generation) ?? false;
  }

  private retire(key: string, generation: string): void {
    const generations = this.retired.get(key) ?? new Set<string>();
    generations.add(generation);
    this.retired.set(key, generations);
  }

  private publish(workspaceId: string): void {
    for (const listener of this.listeners) listener(workspaceId);
  }
}

/** pi-garden's inline extensions: switched app-wide, with no user source on disk. */
function isPiGardenBuiltinExtension(extension: RuntimeExtensionRecord): boolean {
  return extension.sourceInfo.source === "builtin" && extension.sourceInfo.origin === "top-level";
}

function skippedAnalysis(reason: string): ExtensionSourceAnalysis {
  return {
    inspection: {
      status: "skipped",
      files: [],
      skipped: [{ file: "", reason }],
      inspectedAt: new Date().toISOString(),
    },
    evidence: new Map<ExtensionCapabilityId, readonly ExtensionSourceEvidence[]>(),
  };
}

async function realExtensionPath(source: string): Promise<string | undefined> {
  let filePath = source;
  if (source.startsWith("file:")) {
    try {
      filePath = fileURLToPath(source);
    } catch {
      return undefined;
    }
  }
  if (!path.isAbsolute(filePath)) return undefined;
  try {
    return await realpath(filePath);
  } catch {
    return undefined;
  }
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function isInsideNodeModules(file: string): boolean {
  return file.split(path.sep).includes("node_modules");
}

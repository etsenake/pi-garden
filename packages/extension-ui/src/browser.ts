import { isJsonValue, type RemoteServiceSource } from "@earendil-works/chord";

export interface DesktopFileTarget {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

export interface DesktopTaskDraft {
  readonly title: string;
  readonly prompt: string;
  readonly files?: readonly { readonly path: string; readonly line?: number }[];
}

export type DesktopHostAction =
  | ({ readonly type: "openFile" } & DesktopFileTarget)
  | ({ readonly type: "prepareTaskDraft" } & DesktopTaskDraft)
  | { readonly type: "presentOverlay"; readonly id: string }
  | { readonly type: "settleOverlay"; readonly value?: unknown }
  | { readonly type: "cancelOverlay" };

/** Graphical tool state pushed by Pi Garden. The extension does not execute the tool. */
export interface DesktopToolPresentation {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly arguments: unknown;
  readonly argumentsComplete: boolean;
  readonly executionStarted: boolean;
  readonly phase: "pending" | "running" | "partial" | "complete" | "error";
  readonly partial?: unknown;
  readonly result?: {
    readonly content: unknown;
    readonly details?: unknown;
    readonly isError: boolean;
  };
  readonly error?: string;
  readonly expanded: boolean;
}

export type DesktopOverlayResult =
  { readonly status: "result"; readonly value: unknown } | { readonly status: "cancelled" };

export interface DesktopViewContext {
  readonly services: RemoteServiceSource;
  /** Aborted when this mount loses its connection, including reload and task closure. */
  readonly signal: AbortSignal;
  /** Present for a tool renderer. Null for chrome, settings, workbench, and overlay mounts. */
  readonly tool: DesktopToolPresentation | null;
  subscribeTool(listener: (tool: DesktopToolPresentation) => void): () => void;
  subscribeTheme(listener: (theme: DesktopViewContext["theme"]) => void): () => void;
  readonly theme: {
    readonly mode: "light" | "dark";
    readonly background: string;
    readonly foreground: string;
    readonly accent: string;
    /** Semantic snapshot of the active Pi Garden theme. Present on the desktop host. */
    readonly snapshot?: {
      readonly id: string;
      readonly name: string;
      readonly variant: "light" | "dark";
      readonly syntaxTheme: string;
      readonly seed: {
        readonly surface: string;
        readonly ink: string;
        readonly accent: string;
        readonly added: string;
        readonly removed: string;
        readonly warning: string;
      };
      readonly tokens: Readonly<Record<string, string>>;
    };
  };
  readonly actions: {
    openFile(target: DesktopFileTarget): Promise<void>;
    prepareTaskDraft(draft: DesktopTaskDraft): Promise<void>;
    /** Opens this extension's overlay. The host owns focus, cancellation, and cleanup. */
    presentOverlay(id: string): Promise<DesktopOverlayResult>;
    /** Resolves the overlay that this mount is presenting. */
    settle(value?: unknown): Promise<void>;
    /** Cancels the overlay that this mount is presenting. */
    cancel(): Promise<void>;
  };
}

export interface DesktopEditorHostState {
  readonly status: "idle" | "running";
}

export interface DesktopEditorAutocompleteQuery {
  readonly text: string;
  readonly cursor: number;
  readonly force?: boolean;
}

export interface DesktopEditorAutocompleteItem {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
}

export interface DesktopEditorAutocompleteResult {
  readonly items: readonly DesktopEditorAutocompleteItem[];
  readonly prefix: string;
}

export interface DesktopEditorCompletion {
  readonly text: string;
  readonly cursor: number;
}

export interface DesktopEditorSubmitIntent {
  readonly shift?: boolean;
  readonly meta?: boolean;
  readonly ctrl?: boolean;
  readonly composing?: boolean;
}

/**
 * Capabilities of the prompt editor region.
 * The host owns the draft, submission, attachments, and autocomplete providers.
 */
export interface DesktopEditorContext {
  getText(): string;
  setText(text: string, cursor?: number): void;
  subscribeText(listener: (text: string) => void): () => void;
  getCursor(): number;
  subscribeCursor(listener: (cursor: number) => void): () => void;
  readonly state: DesktopEditorHostState;
  subscribeState(listener: (state: DesktopEditorHostState) => void): () => void;
  requestFocus(): void;
  /** Asks the host to submit. Shift, IME composition, steer, and follow-up stay host decisions. */
  submit(intent?: DesktopEditorSubmitIntent): void;
  autocomplete: {
    request(
      query: DesktopEditorAutocompleteQuery,
      signal?: AbortSignal,
    ): Promise<DesktopEditorAutocompleteResult>;
    apply(input: {
      readonly text: string;
      readonly cursor: number;
      readonly prefix: string;
      readonly item: DesktopEditorAutocompleteItem;
    }): Promise<DesktopEditorCompletion>;
  };
  readonly theme: DesktopViewContext["theme"];
  subscribeTheme(listener: (theme: DesktopViewContext["theme"]) => void): () => void;
  readonly signal: AbortSignal;
  readonly services: RemoteServiceSource;
}

export type DesktopEditorMount = (
  root: HTMLElement,
  host: DesktopEditorContext,
) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>;

export type DesktopViewMount = (
  root: HTMLElement,
  host: DesktopViewContext,
) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>;

/** Validate the untrusted action payload before binding it to the initiating task/window. */
export function parseDesktopHostAction(value: unknown): DesktopHostAction {
  if (!isJsonValue(value) || !isRecord(value)) throw new TypeError("Invalid desktop host action");
  if (value.type === "openFile") {
    assertKeys(value, ["type", "path"], ["line", "column"]);
    assertPath(value.path);
    assertLine(value.line);
    assertLine(value.column);
    return {
      type: "openFile",
      path: value.path,
      ...(typeof value.line === "number" ? { line: value.line } : {}),
      ...(typeof value.column === "number" ? { column: value.column } : {}),
    };
  }
  if (value.type === "prepareTaskDraft") {
    assertKeys(value, ["type", "title", "prompt"], ["files"]);
    if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 240) {
      throw new TypeError("Task draft title must contain 1 to 240 characters");
    }
    if (typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > 100_000) {
      throw new TypeError("Task draft prompt must contain 1 to 100000 characters");
    }
    let files: { path: string; line?: number }[] | undefined;
    if (value.files !== undefined) {
      if (!Array.isArray(value.files) || value.files.length > 100) {
        throw new TypeError("Task draft files must be a list of at most 100 targets");
      }
      files = value.files.map((file: unknown) => {
        if (!isRecord(file)) throw new TypeError("Invalid task draft file");
        assertKeys(file, ["path"], ["line"]);
        assertPath(file.path);
        assertLine(file.line);
        return { path: file.path, ...(typeof file.line === "number" ? { line: file.line } : {}) };
      });
    }
    return {
      type: "prepareTaskDraft",
      title: value.title,
      prompt: value.prompt,
      ...(files ? { files } : {}),
    };
  }
  if (value.type === "presentOverlay") {
    assertKeys(value, ["type", "id"], []);
    if (typeof value.id !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(value.id)) {
      throw new TypeError("Overlay ID must be a lowercase identifier of at most 64 characters");
    }
    return { type: "presentOverlay", id: value.id };
  }
  if (value.type === "settleOverlay") {
    assertKeys(value, ["type"], ["value"]);
    if (value.value !== undefined) assertJsonPayload(value.value);
    return {
      type: "settleOverlay",
      ...(value.value !== undefined ? { value: value.value } : {}),
    };
  }
  if (value.type === "cancelOverlay") {
    assertKeys(value, ["type"], []);
    return { type: "cancelOverlay" };
  }
  throw new TypeError("Unknown desktop host action");
}

function assertJsonPayload(value: unknown): void {
  if (!isJsonValue(value)) throw new TypeError("Overlay result must be JSON");
  if (JSON.stringify(value).length > 100_000) {
    throw new TypeError("Overlay result must be at most 100000 characters");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPath(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.includes("\0")) {
    throw new TypeError("Invalid file path");
  }
}

function assertLine(value: unknown): void {
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new TypeError("File line and column must be positive integers");
  }
}

function assertKeys(value: Record<string, unknown>, required: string[], optional: string[]): void {
  const keys = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !keys.has(key))
  ) {
    throw new TypeError("Unexpected desktop host action fields");
  }
}

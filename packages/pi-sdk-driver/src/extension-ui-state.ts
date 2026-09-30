import type { HostUiRequest, HostUiWorkingIndicator } from "@pi-garden/session-driver";

export interface ExtensionUiWidgetState {
  readonly key: string;
  readonly lines: readonly string[];
  readonly placement: "aboveComposer" | "belowComposer";
}

/**
 * Pi `ExtensionUIContext` state the host mirrors per session. Every field has
 * Pi's default when the extension has not set it; `resetExtensionUiState`
 * returns to those defaults exactly as Pi's own `resetExtensionUi` does.
 */
export interface ExtensionUiState {
  readonly statuses: Map<string, string>;
  readonly widgets: Map<string, ExtensionUiWidgetState>;
  title: string | undefined;
  editorText: string | undefined;
  /** `setWorkingMessage`; undefined means the host default. */
  workingMessage: string | undefined;
  /** `setWorkingVisible`; Pi defaults to visible. */
  workingVisible: boolean;
  /** `setWorkingIndicator`; undefined means the host default indicator. */
  workingIndicator: HostUiWorkingIndicator | undefined;
  /** `setHiddenThinkingLabel`; undefined means the host default label. */
  hiddenThinkingLabel: string | undefined;
  /** `setToolsExpanded`; Pi defaults to collapsed. */
  toolsExpanded: boolean;
}

export type ExtensionUiDialogRequest = Extract<
  HostUiRequest,
  { readonly kind: "confirm" | "select" | "input" | "editor" }
>;

export function createEmptyExtensionUiState(): ExtensionUiState {
  return {
    statuses: new Map(),
    widgets: new Map(),
    title: undefined,
    editorText: undefined,
    workingMessage: undefined,
    workingVisible: true,
    workingIndicator: undefined,
    hiddenThinkingLabel: undefined,
    toolsExpanded: false,
  };
}

/** Restore Pi's defaults in place, keeping the same state object. */
export function resetExtensionUiState(state: ExtensionUiState): void {
  state.statuses.clear();
  state.widgets.clear();
  state.title = undefined;
  state.editorText = undefined;
  state.workingMessage = undefined;
  state.workingVisible = true;
  state.workingIndicator = undefined;
  state.hiddenThinkingLabel = undefined;
  state.toolsExpanded = false;
}

export function applyHostUiRequestToExtensionUiState(
  state: ExtensionUiState,
  request: HostUiRequest,
): void {
  switch (request.kind) {
    case "status":
      if (request.text) {
        state.statuses.set(request.key, request.text);
      } else {
        state.statuses.delete(request.key);
      }
      break;
    case "widget":
      if (request.lines && request.lines.length > 0) {
        state.widgets.set(request.key, {
          key: request.key,
          lines: [...request.lines],
          placement: request.placement ?? "aboveComposer",
        });
      } else {
        state.widgets.delete(request.key);
      }
      break;
    case "title":
      state.title = request.title;
      break;
    case "editorText":
      state.editorText = request.text;
      break;
    case "editorPaste":
      state.editorText = `${state.editorText ?? ""}${request.text}`;
      break;
    case "workingMessage":
      state.workingMessage = request.message;
      break;
    case "workingVisible":
      state.workingVisible = request.visible;
      break;
    case "workingIndicator":
      state.workingIndicator = request.indicator
        ? {
            frames: [...request.indicator.frames],
            ...(request.indicator.intervalMs !== undefined
              ? { intervalMs: request.indicator.intervalMs }
              : {}),
          }
        : undefined;
      break;
    case "hiddenThinkingLabel":
      state.hiddenThinkingLabel = request.label;
      break;
    case "toolsExpanded":
      state.toolsExpanded = request.expanded;
      break;
    default:
      break;
  }
}

/**
 * Requests that rebuild the current state for a late subscriber. Dialogs are
 * not replayed: they are pending promises the host already tracks by request id.
 */
export function replayRequestsForExtensionUiState(
  state: ExtensionUiState,
): readonly HostUiRequest[] {
  const requests: HostUiRequest[] = [];
  for (const [key, text] of state.statuses) {
    requests.push({ kind: "status", requestId: `replay:status:${key}`, key, text });
  }
  for (const widget of state.widgets.values()) {
    requests.push({
      kind: "widget",
      requestId: `replay:widget:${widget.key}`,
      key: widget.key,
      lines: widget.lines,
      placement: widget.placement,
    });
  }
  if (state.title) {
    requests.push({ kind: "title", requestId: "replay:title", title: state.title });
  }
  if (state.editorText) {
    requests.push({ kind: "editorText", requestId: "replay:editorText", text: state.editorText });
  }
  if (state.workingMessage !== undefined) {
    requests.push({
      kind: "workingMessage",
      requestId: "replay:workingMessage",
      message: state.workingMessage,
    });
  }
  if (!state.workingVisible) {
    requests.push({ kind: "workingVisible", requestId: "replay:workingVisible", visible: false });
  }
  if (state.workingIndicator) {
    requests.push({
      kind: "workingIndicator",
      requestId: "replay:workingIndicator",
      indicator: state.workingIndicator,
    });
  }
  if (state.hiddenThinkingLabel !== undefined) {
    requests.push({
      kind: "hiddenThinkingLabel",
      requestId: "replay:hiddenThinkingLabel",
      label: state.hiddenThinkingLabel,
    });
  }
  if (state.toolsExpanded) {
    requests.push({ kind: "toolsExpanded", requestId: "replay:toolsExpanded", expanded: true });
  }
  return requests;
}

export function isExtensionUiDialogRequest(
  request: HostUiRequest,
): request is ExtensionUiDialogRequest {
  return (
    request.kind === "confirm" ||
    request.kind === "select" ||
    request.kind === "input" ||
    request.kind === "editor"
  );
}

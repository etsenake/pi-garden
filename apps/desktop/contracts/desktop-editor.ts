import type { SessionRef } from "@pi-garden/session-driver";

export interface DesktopEditorConflictPeer {
  readonly extensionId: string;
  readonly id: string;
  readonly title: string;
}

export interface DesktopEditorInfo {
  readonly id: string;
  readonly extensionId: string;
  readonly title: string;
  readonly generation: string;
  readonly state: "ready" | "error" | "conflict";
  readonly error?: string;
  readonly conflict?: readonly DesktopEditorConflictPeer[];
}

export interface EditorAutocompleteItem {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
}

export interface EditorAutocompleteQuery {
  readonly target: SessionRef;
  readonly text: string;
  readonly cursor: number;
  readonly force?: boolean;
}

export interface EditorAutocompleteResponse {
  readonly items: readonly EditorAutocompleteItem[];
  readonly prefix: string;
  readonly triggerCharacters: readonly string[];
}

export interface EditorAutocompleteApplyInput {
  readonly target: SessionRef;
  readonly text: string;
  readonly cursor: number;
  readonly prefix: string;
  readonly item: EditorAutocompleteItem;
}

export interface EditorAutocompleteApplied {
  readonly text: string;
  readonly cursor: number;
}

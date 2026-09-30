export interface ComposerEditorSelection {
  readonly start: number;
  readonly end: number;
}

/** Focus and selection for whichever prompt editor is mounted. */
export interface ComposerEditorHandle {
  focus(): void;
  isFocused(): boolean;
  getSelection(): ComposerEditorSelection | null;
  setSelection(start: number, end: number): void;
  isComposing(): boolean;
  syncHeight?(maxPx: number): void;
}

export function bindTextareaEditor(textarea: HTMLTextAreaElement): ComposerEditorHandle {
  return {
    focus() {
      textarea.focus();
    },
    isFocused() {
      return document.activeElement === textarea;
    },
    getSelection() {
      return { start: textarea.selectionStart, end: textarea.selectionEnd };
    },
    setSelection(start, end) {
      textarea.setSelectionRange(start, end);
    },
    isComposing() {
      return textarea.dataset.composing === "true";
    },
    syncHeight(maxPx) {
      textarea.style.height = "0px";
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxPx)}px`;
    },
  };
}

import { useEffect, useRef, useState } from "react";
import type { SessionRef } from "@pi-garden/session-driver/types";
import type { PiDesktopApi } from "../../../../contracts/ipc";
import type { EditorAutocompleteItem } from "../../../../contracts/desktop-editor";
import type { ComposerEditorHandle } from "../composer-editor";

const QUERY_DELAY_MS = 20;

export interface EditorAutocompleteMenu {
  readonly items: readonly EditorAutocompleteItem[];
  readonly prefix: string;
  readonly selectedIndex: number;
  readonly open: boolean;
}

export function extensionAutocompleteSuppressed(
  text: string,
  cursor: number,
  hostMenusOpen: boolean,
): boolean {
  if (hostMenusOpen) return true;
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const line = before.split("\n").pop() ?? "";
  if (line.trimStart().startsWith("/")) return true;
  return /(?:^|\s)@[^\s]*$/.test(before);
}

export function activeAutocompleteTrigger(
  text: string,
  cursor: number,
  triggers: readonly string[],
): string | null {
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  let tokenStart = 0;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const character = before[index];
    if (character === " " || character === "\n" || character === "\t") {
      tokenStart = index + 1;
      break;
    }
  }
  const first = before[tokenStart];
  if (!first || first.length !== 1 || !triggers.includes(first)) return null;
  return first;
}

export function useEditorAutocomplete({
  api,
  target,
  text,
  editorRef,
  hostMenusOpen,
  enabled,
  onApply,
}: {
  readonly api: PiDesktopApi | undefined;
  readonly target: SessionRef | null;
  readonly text: string;
  readonly editorRef: { readonly current: ComposerEditorHandle | null };
  readonly hostMenusOpen: boolean;
  readonly enabled: boolean;
  readonly onApply: (next: { readonly text: string; readonly cursor: number }) => void;
}) {
  const [menu, setMenu] = useState<EditorAutocompleteMenu>({
    items: [],
    prefix: "",
    selectedIndex: 0,
    open: false,
  });
  const triggersRef = useRef<readonly string[]>([]);
  const requestRef = useRef(0);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  useEffect(() => {
    if (!api || !target || !enabled) {
      setMenu((current) => (current.open ? { ...current, open: false, items: [] } : current));
      return;
    }
    const cursor = editorRef.current?.getSelection()?.start ?? text.length;
    if (extensionAutocompleteSuppressed(text, cursor, hostMenusOpen)) {
      setMenu((current) => (current.open ? { ...current, open: false, items: [] } : current));
      return;
    }
    if (
      triggersRef.current.length > 0 &&
      !activeAutocompleteTrigger(text, cursor, triggersRef.current)
    ) {
      setMenu((current) => (current.open ? { ...current, open: false, items: [] } : current));
      return;
    }
    const request = requestRef.current + 1;
    requestRef.current = request;
    const timer = window.setTimeout(() => {
      const liveCursor = editorRef.current?.getSelection()?.start ?? text.length;
      void api
        .queryEditorAutocomplete({
          target,
          text,
          cursor: liveCursor,
        })
        .then((result) => {
          if (requestRef.current !== request) return;
          triggersRef.current = result.triggerCharacters;
          const matched = activeAutocompleteTrigger(text, liveCursor, result.triggerCharacters);
          if (!matched || result.items.length === 0) {
            setMenu({ items: [], prefix: result.prefix, selectedIndex: 0, open: false });
            return;
          }
          setMenu({
            items: result.items,
            prefix: result.prefix,
            selectedIndex: 0,
            open: true,
          });
        })
        .catch((error: unknown) => {
          if (requestRef.current !== request) return;
          console.error("[editor-autocomplete] query failed", error);
          setMenu({ items: [], prefix: "", selectedIndex: 0, open: false });
        });
    }, QUERY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [api, editorRef, enabled, hostMenusOpen, target, text]);

  const applyItem = (item: EditorAutocompleteItem, prefix: string, cursor: number) => {
    if (!api || !target) return Promise.resolve();
    return api.applyEditorAutocomplete({ target, text, cursor, prefix, item }).then((applied) => {
      if (!applied) return;
      onApplyRef.current(applied);
      editorRef.current?.focus();
      requestAnimationFrame(() => editorRef.current?.setSelection(applied.cursor, applied.cursor));
    });
  };

  const accept = (item: EditorAutocompleteItem) => {
    const cursor = editorRef.current?.getSelection()?.start ?? text.length;
    const prefix = menuRef.current.prefix;
    setMenu({ items: [], prefix: "", selectedIndex: 0, open: false });
    applyItem(item, prefix, cursor).catch((error: unknown) => {
      console.error("[editor-autocomplete] apply failed", error);
    });
  };

  const handleKeyDown = (event: {
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }): boolean => {
    const current = menuRef.current;
    if (!current.open || current.items.length === 0) {
      if (event.key === "Tab" && !event.shiftKey && api && target && enabled && !hostMenusOpen) {
        event.preventDefault();
        const cursor = editorRef.current?.getSelection()?.start ?? text.length;
        api
          .queryEditorAutocomplete({ target, text, cursor, force: true })
          .then((result) => {
            triggersRef.current = result.triggerCharacters;
            const first = result.items[0];
            if (result.items.length === 1 && first) {
              return applyItem(first, result.prefix, cursor);
            }
            if (result.items.length > 0) {
              setMenu({ items: result.items, prefix: result.prefix, selectedIndex: 0, open: true });
            }
          })
          .catch((error: unknown) => {
            console.error("[editor-autocomplete] force query failed", error);
          });
        return true;
      }
      return false;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMenu({
        ...current,
        selectedIndex: (current.selectedIndex + 1) % current.items.length,
      });
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMenu({
        ...current,
        selectedIndex: (current.selectedIndex - 1 + current.items.length) % current.items.length,
      });
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMenu({ ...current, open: false, items: [] });
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const item = current.items[current.selectedIndex];
      if (!item) return false;
      event.preventDefault();
      accept(item);
      return true;
    }
    return false;
  };

  const highlight = (index: number) => {
    setMenu((current) =>
      current.open && index >= 0 && index < current.items.length && index !== current.selectedIndex
        ? { ...current, selectedIndex: index }
        : current,
    );
  };

  return { menu, accept, highlight, handleKeyDown };
}

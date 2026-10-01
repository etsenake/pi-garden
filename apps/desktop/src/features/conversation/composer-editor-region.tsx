import { useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import type { SessionRef } from "@pi-garden/session-driver/types";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type { ComposerAttachment } from "../../../contracts/desktop-state";
import type { DesktopEditorInfo, EditorAutocompleteItem } from "../../../contracts/desktop-editor";
import type { ActiveTheme } from "../../ui/active-theme";
import { DesktopEditorFrame } from "../extensions/desktop-editor-frame";
import { readComposerAttachmentsFromFiles } from "./composer-attachments";
import type { ComposerEditorHandle } from "./composer-editor";
import { ComposerMenuPopover } from "./composer-menu-popover";
import { CommandItem } from "@/ui/shadcn/command";
import {
  useEditorAutocomplete,
  type EditorAutocompleteMenu as EditorAutocompleteMenuState,
} from "./hooks/use-editor-autocomplete";

/**
 * The prompt-editor region: which registered editor (if any) owns the textarea slot and
 * the shared extension autocomplete menu. The canonical draft stays outside this hook.
 */
export function useComposerEditorRegion({
  api,
  target,
  editors,
  text,
  setText,
  editorRef,
  hostMenusOpen,
}: {
  readonly api: PiDesktopApi | undefined;
  readonly target: SessionRef | null;
  readonly editors: readonly DesktopEditorInfo[];
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly editorRef: MutableRefObject<ComposerEditorHandle | null>;
  readonly hostMenusOpen: boolean;
}) {
  const [failedEditorKey, setFailedEditorKey] = useState("");
  const winner = editors.find((editor) => editor.state === "ready");
  const winnerKey = winner ? `${winner.extensionId}:${winner.id}:${winner.generation}` : "";
  const autocomplete = useEditorAutocomplete({
    api,
    target,
    text,
    editorRef,
    hostMenusOpen,
    enabled: Boolean(target),
    onApply: ({ text: next, cursor }) => {
      setText(next);
      requestAnimationFrame(() => editorRef.current?.setSelection(cursor, cursor));
    },
  });
  return {
    api,
    target,
    winner,
    active: winner && failedEditorKey !== winnerKey ? winner : undefined,
    markUnavailable: () => setFailedEditorKey(winnerKey),
    autocomplete,
    menuOpen: autocomplete.menu.open || hostMenusOpen,
    text,
    setText,
    editorRef,
  };
}

export type ComposerEditorRegion = ReturnType<typeof useComposerEditorRegion>;

/** Builds the composer slots for the region once the host key handler exists. */
export function composerEditorRegionSlots(
  region: ComposerEditorRegion,
  host: {
    readonly theme: ActiveTheme;
    readonly status: "idle" | "running";
    readonly attachments: readonly ComposerAttachment[];
    readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  },
): { editorSlot?: ReactNode; suggestionMenu: ReactNode; editorNotice: ReactNode } {
  const { api, target } = region;
  return {
    editorSlot:
      region.active && api && target ? (
        <DesktopEditorFrame
          api={api}
          target={target}
          editor={region.active}
          theme={host.theme}
          text={region.text}
          status={host.status}
          menuOpen={region.menuOpen}
          handleRef={region.editorRef}
          onText={(text) => region.setText(text)}
          onSubmit={(intent) =>
            host.onKeyDown(
              customEditorKeyEvent({
                key: "Enter",
                shift: intent.shift,
                meta: intent.meta,
                ctrl: intent.ctrl,
                composing: intent.composing,
              }),
            )
          }
          onMenuKey={(key) => host.onKeyDown(customEditorKeyEvent(key))}
          onUnavailable={region.markUnavailable}
          onFiles={(files) => addEditorFiles(api, files, host.attachments)}
        />
      ) : undefined,
    suggestionMenu: (
      <EditorAutocompleteMenu
        menu={region.autocomplete.menu}
        onAccept={region.autocomplete.accept}
      />
    ),
    editorNotice: region.winner ? <DesktopEditorConflictNotice editor={region.winner} /> : null,
  };
}

/**
 * A custom editor reports keys as intents. The host turns them into the same event shape
 * the textarea produces so mention, slash, autocomplete, and send handling stay shared.
 */
function customEditorKeyEvent(key: {
  readonly key: string;
  readonly shift: boolean;
  readonly meta?: boolean;
  readonly ctrl?: boolean;
  readonly composing?: boolean;
}): KeyboardEvent<HTMLTextAreaElement> {
  return {
    key: key.key,
    shiftKey: key.shift,
    metaKey: key.meta === true,
    ctrlKey: key.ctrl === true,
    altKey: false,
    preventDefault() {},
    nativeEvent: { isComposing: key.composing === true },
  } as KeyboardEvent<HTMLTextAreaElement>;
}

function addEditorFiles(
  api: PiDesktopApi,
  files: File[],
  attachments: readonly ComposerAttachment[],
): void {
  void readComposerAttachmentsFromFiles(files, attachments)
    .then((next) => {
      const existingIds = new Set(attachments.map((item) => item.id));
      return api.addComposerAttachments(next.filter((item) => !existingIds.has(item.id)));
    })
    .catch((error: unknown) => {
      console.error("[desktop-editor] attachments failed", error);
    });
}

function EditorAutocompleteMenu({
  menu,
  onAccept,
}: {
  readonly menu: EditorAutocompleteMenuState;
  readonly onAccept: (item: EditorAutocompleteItem) => void;
}) {
  if (!menu.open) return null;
  return (
    <ComposerMenuPopover
      label="Suggestions"
      selectedValue={String(menu.selectedIndex)}
      testId="editor-autocomplete-menu"
    >
      {menu.items.map((item, index) => (
        <CommandItem
          className={`slash-menu__option ${index === menu.selectedIndex ? "slash-menu__option--active" : ""}`}
          key={`${item.value}:${index}`}
          value={String(index)}
          onSelect={() => onAccept(item)}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="slash-menu__option-title truncate">{item.label}</span>
            {item.description ? (
              <span className="slash-menu__option-description truncate text-xs text-muted-foreground">
                {item.description}
              </span>
            ) : null}
          </span>
        </CommandItem>
      ))}
    </ComposerMenuPopover>
  );
}

function DesktopEditorConflictNotice({ editor }: { readonly editor: DesktopEditorInfo }) {
  if (!editor.conflict || editor.conflict.length === 0) return null;
  return (
    <div className="composer__status" data-testid="desktop-editor-conflict" role="status">
      {editor.title} is the editor. Other registrations are waiting.
    </div>
  );
}

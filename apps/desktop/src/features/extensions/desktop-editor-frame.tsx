import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { SessionRef } from "@pi-garden/session-driver/types";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type { DesktopEditorInfo } from "../../../contracts/desktop-editor";
import type { ExtensionViewConnection } from "../../../contracts/extension-views";
import type { ComposerEditorHandle } from "../conversation/composer-editor";
import { toExtensionViewTheme, type ExtensionViewTheme } from "./extension-view-panel";
import type { ActiveTheme } from "../../ui/active-theme";

const FRAME_READY_TIMEOUT_MS = 10_000;

export function DesktopEditorFrame({
  api,
  target,
  editor,
  theme,
  text,
  status,
  menuOpen,
  handleRef,
  onText,
  onSubmit,
  onUnavailable,
  onFiles,
}: {
  readonly api: PiDesktopApi;
  readonly target: SessionRef;
  readonly editor: DesktopEditorInfo;
  readonly theme: ActiveTheme;
  readonly text: string;
  readonly status: "idle" | "running";
  readonly menuOpen: boolean;
  readonly handleRef: Ref<ComposerEditorHandle | null>;
  readonly onText: (text: string, cursor: number) => void;
  readonly onSubmit: (intent: {
    readonly shift: boolean;
    readonly meta: boolean;
    readonly ctrl: boolean;
    readonly composing: boolean;
  }) => void;
  readonly onUnavailable: (message: string) => void;
  readonly onFiles: (files: File[]) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const attachFrameRef = useRef<((frame: HTMLIFrameElement) => void) | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const cursorRef = useRef(text.length);
  const echoRef = useRef<string | null>(null);
  const onTextRef = useRef(onText);
  const onSubmitRef = useRef(onSubmit);
  const onFilesRef = useRef(onFiles);
  const onUnavailableRef = useRef(onUnavailable);
  onTextRef.current = onText;
  onSubmitRef.current = onSubmit;
  onFilesRef.current = onFiles;
  onUnavailableRef.current = onUnavailable;
  const composingRef = useRef(false);
  const themeMessage = toExtensionViewTheme(theme);
  const themeRef = useRef(themeMessage);
  themeRef.current = themeMessage;
  const [connection, setConnection] = useState<ExtensionViewConnection | null>(null);
  const scopeKey = JSON.stringify([
    target.workspaceId,
    target.sessionId,
    editor.extensionId,
    editor.id,
    editor.generation,
    editor.state,
  ]);

  useImperativeHandle(
    handleRef,
    (): ComposerEditorHandle => ({
      focus() {
        iframeRef.current?.focus();
        portRef.current?.postMessage({ type: "pi-garden:editor-focus" });
      },
      isFocused() {
        const frame = iframeRef.current;
        return document.activeElement === frame;
      },
      getSelection() {
        return { start: cursorRef.current, end: cursorRef.current };
      },
      setSelection(start) {
        cursorRef.current = start;
        portRef.current?.postMessage({
          type: "pi-garden:editor-text",
          text: textRef.current,
          cursor: start,
        });
      },
      isComposing() {
        return composingRef.current;
      },
    }),
    [],
  );

  useEffect(() => {
    portRef.current?.postMessage({ type: "pi-garden:theme-changed", theme: themeMessage });
  }, [themeMessage]);

  useEffect(() => {
    if (echoRef.current === text) {
      echoRef.current = null;
      return;
    }
    portRef.current?.postMessage({
      type: "pi-garden:editor-text",
      text,
      cursor: cursorRef.current,
    });
  }, [text]);

  useEffect(() => {
    portRef.current?.postMessage({ type: "pi-garden:editor-state", status });
  }, [status]);

  useEffect(() => {
    portRef.current?.postMessage({ type: "pi-garden:editor-shortcuts", shortcuts: [], menuOpen });
  }, [menuOpen]);

  useEffect(() => {
    let disposed = false;
    let opened: ExtensionViewConnection | null = null;
    let channel: MessageChannel | null = null;
    let readyTimer: number | undefined;
    let unsubscribe: (() => void) | undefined;
    const fail = (message: string) => {
      if (disposed) return;
      onUnavailableRef.current(message);
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (readyTimer !== undefined) window.clearTimeout(readyTimer);
      unsubscribe?.();
      channel?.port1.close();
      channel?.port2.close();
      if (portRef.current === channel?.port1) portRef.current = null;
      if (opened) {
        void api.closeExtensionView(opened.connectionId).catch((error: unknown) => {
          console.error("[desktop-editor] close failed", error);
        });
      }
    };

    const attachFrame = (frame: HTMLIFrameElement) => {
      if (disposed || !opened || !frame.contentWindow || channel) return;
      channel = new MessageChannel();
      portRef.current = channel.port1;
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data;
        if (!message || typeof message !== "object") return;
        const record = message as Record<string, unknown>;
        if (record.type === "pi-garden:frame-ready") {
          if (readyTimer !== undefined) window.clearTimeout(readyTimer);
          return;
        }
        if (record.type === "pi-garden:frame-error") {
          fail(typeof record.message === "string" ? record.message : "The editor could not start.");
          return;
        }
        if (record.type === "pi-garden:editor-text") {
          const next = typeof record.text === "string" ? record.text : "";
          const cursor = typeof record.cursor === "number" ? record.cursor : next.length;
          cursorRef.current = cursor;
          if (next !== textRef.current) {
            echoRef.current = next;
            onTextRef.current(next, cursor);
          }
          return;
        }
        if (record.type === "pi-garden:editor-submit") {
          onSubmitRef.current({
            shift: record.shift === true,
            meta: record.meta === true,
            ctrl: record.ctrl === true,
            composing: record.composing === true,
          });
          return;
        }
        if (record.type === "pi-garden:editor-focus-request") {
          iframeRef.current?.focus();
          return;
        }
        if (record.type === "pi-garden:editor-shortcut") {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: typeof record.key === "string" ? record.key : "",
              code: typeof record.code === "string" ? record.code : "",
              shiftKey: record.shift === true,
              metaKey: record.meta === true,
              ctrlKey: record.ctrl === true,
              altKey: record.alt === true,
              bubbles: true,
              cancelable: true,
            }),
          );
          return;
        }
        if (record.type === "pi-garden:editor-menu-key") {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: typeof record.key === "string" ? record.key : "",
              shiftKey: record.shift === true,
              bubbles: true,
              cancelable: true,
            }),
          );
          return;
        }
        if (record.type === "pi-garden:editor-query" || record.type === "pi-garden:editor-apply") {
          const requestId = record.requestId;
          const respond = (ok: boolean, result: unknown, error?: string) => {
            channel?.port1.postMessage({
              type: "pi-garden:editor-result",
              requestId,
              ok,
              ...(ok ? { result } : { error: error ?? "Editor request failed" }),
            });
          };
          const run =
            record.type === "pi-garden:editor-query"
              ? api.queryEditorAutocomplete({
                  target,
                  text: typeof record.text === "string" ? record.text : "",
                  cursor: typeof record.cursor === "number" ? record.cursor : 0,
                  ...(record.force === true ? { force: true } : {}),
                })
              : api.applyEditorAutocomplete({
                  target,
                  text: typeof record.text === "string" ? record.text : "",
                  cursor: typeof record.cursor === "number" ? record.cursor : 0,
                  prefix: typeof record.prefix === "string" ? record.prefix : "",
                  item: isAutocompleteItem(record.item) ? record.item : { label: "", value: "" },
                });
          void run.then(
            (result) => respond(true, result),
            (error: unknown) =>
              respond(false, null, error instanceof Error ? error.message : String(error)),
          );
          return;
        }
        if (record.type === "pi-garden:editor-files" && Array.isArray(record.files)) {
          void filesFromPayload(record.files).then(onFilesRef.current, (error: unknown) => {
            console.error("[desktop-editor] attachment paste failed", error);
          });
          return;
        }
        if (!opened) return;
        void api
          .sendExtensionViewMessage({ connectionId: opened.connectionId, message })
          .catch((error: unknown) => {
            console.error("[desktop-editor] message failed", error);
          });
      };
      channel.port1.start();
      frame.contentWindow.postMessage(
        {
          type: "pi-garden:extension-connect",
          connectionId: opened.connectionId,
          theme: themeRef.current,
          text: textRef.current,
          editorState: { status },
          shortcuts: [],
          menuOpen,
        },
        "*",
        [channel.port2],
      );
      channel.port1.postMessage({
        type: "pi-garden:editor-text",
        text: textRef.current,
        cursor: cursorRef.current,
      });
    };
    attachFrameRef.current = attachFrame;
    if (iframeRef.current) attachFrame(iframeRef.current);

    if (editor.state !== "ready") {
      fail(editor.error ?? "This editor is unavailable.");
      return dispose;
    }
    readyTimer = window.setTimeout(() => {
      fail("The editor took too long to start.");
    }, FRAME_READY_TIMEOUT_MS);
    unsubscribe = api.onExtensionViewMessage((event) => {
      if (!opened || event.connectionId !== opened.connectionId) return;
      channel?.port1.postMessage(event.message);
    });
    void api
      .openDesktopEditor({
        target,
        extensionId: editor.extensionId,
        editorId: editor.id,
      })
      .then((next) => {
        if (disposed) {
          void api.closeExtensionView(next.connectionId);
          return;
        }
        opened = next;
        setConnection(next);
        if (iframeRef.current) attachFrame(iframeRef.current);
      })
      .catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      });
    return () => {
      if (attachFrameRef.current === attachFrame) attachFrameRef.current = null;
      setConnection(null);
      dispose();
    };
    // The draft text is pushed by a separate effect so typing does not reopen the frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, editor.extensionId, editor.generation, editor.id, editor.state, scopeKey, target]);

  return (
    <div className="composer-editor" data-testid="desktop-editor" data-draft={text}>
      {connection ? (
        <iframe
          className="composer-editor__frame"
          data-testid="desktop-editor-frame"
          title={editor.title}
          ref={(node) => {
            iframeRef.current = node;
          }}
          src={connection.frameUrl}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={() => {
            const frame = iframeRef.current;
            if (frame) attachFrameRef.current?.(frame);
          }}
        />
      ) : null}
    </div>
  );
}

function isAutocompleteItem(
  value: unknown,
): value is { label: string; value: string; description?: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.label === "string" && typeof record.value === "string";
}

async function filesFromPayload(files: readonly unknown[]): Promise<File[]> {
  const decoded: File[] = [];
  for (const entry of files) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.data !== "string" || typeof record.name !== "string") continue;
    const binary = atob(record.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    decoded.push(
      new File([bytes], record.name, {
        type: typeof record.type === "string" ? record.type : "",
      }),
    );
  }
  return decoded;
}

export type { ExtensionViewTheme };

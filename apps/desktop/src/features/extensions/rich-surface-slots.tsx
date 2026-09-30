import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionRef } from "@pi-garden/session-driver/types";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type {
  DesktopExtensionViewInfo,
  DesktopRichSurface,
  ExtensionOverlayChange,
} from "../../../contracts/extension-views";
import { ExtensionViewPanel, type ExtensionViewTheme } from "./extension-view-panel";

export interface RichToolHost extends RichSurfaceHost {
  readonly renderers: readonly DesktopExtensionViewInfo[];
}

export interface RichSurfaceHost {
  readonly api: PiDesktopApi;
  readonly target: SessionRef;
  readonly theme: ExtensionViewTheme;
  readonly onBeforePrepareTaskDraft: () => Promise<void>;
  readonly onPrepareTaskDraftPendingChange: (pending: boolean, requestKey: string) => void;
}

const ADDITIVE_SURFACES = new Set<DesktopRichSurface>([
  "sidebar",
  "thread-header",
  "composer-before",
  "composer-after",
  "settings",
  "workbench",
]);

export function richSurfacesFor(
  views: readonly DesktopExtensionViewInfo[],
  surface: DesktopRichSurface,
): readonly DesktopExtensionViewInfo[] {
  return views
    .filter((view) => (view.surface ?? "workbench") === surface && view.state === "ready")
    .sort((left, right) =>
      comparePlacement(
        ADDITIVE_SURFACES.has(surface) ? (left.order ?? 0) : 0,
        left,
        ADDITIVE_SURFACES.has(surface) ? (right.order ?? 0) : 0,
        right,
      ),
    );
}

function comparePlacement(
  leftOrder: number,
  left: { readonly extensionId: string; readonly id: string },
  rightOrder: number,
  right: { readonly extensionId: string; readonly id: string },
): number {
  if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1;
  const extension = left.extensionId.localeCompare(right.extensionId);
  if (extension !== 0) return extension;
  return left.id.localeCompare(right.id);
}

export function RichSurfaceSlots({
  host,
  surface,
  views,
  label,
}: {
  readonly host: RichSurfaceHost;
  readonly surface: DesktopRichSurface;
  readonly views: readonly DesktopExtensionViewInfo[];
  readonly label: string;
}) {
  const ready = richSurfacesFor(views, surface);
  if (surface === "app-header" || surface === "app-footer") {
    const winner = ready[0];
    if (!winner) return null;
    return (
      <div
        className="rich-surface-slot"
        data-surface={surface}
        data-testid={`rich-surface-${surface}`}
        data-rich-owner={winner.id}
        data-rich-extension={winner.extensionId}
        data-rich-conflict={(winner.conflict ?? []).map((peer) => peer.id).join(" ")}
      >
        {winner.conflict && winner.conflict.length > 0 ? (
          <p className="rich-surface-conflict" role="status" data-testid="rich-surface-conflict">
            {winner.title} is the active {label}. Also registered:{" "}
            {winner.conflict.map((peer) => peer.title).join(", ")}.
          </p>
        ) : null}
        <RichSurfaceFrame host={host} view={winner} />
      </div>
    );
  }
  if (ready.length === 0) return null;
  return (
    <div
      className="rich-surface-stack"
      data-surface={surface}
      data-testid={`rich-surface-${surface}`}
    >
      {ready.map((view) => (
        <div
          className="rich-surface-slot"
          data-surface={surface}
          data-surface-id={view.id}
          data-surface-order={view.order ?? 0}
          data-rich-extension={view.extensionId}
          key={`${view.extensionId}:${view.id}:${view.generation}`}
        >
          <RichSurfaceFrame host={host} view={view} />
        </div>
      ))}
    </div>
  );
}

function RichSurfaceFrame({
  host,
  view,
}: {
  readonly host: RichSurfaceHost;
  readonly view: DesktopExtensionViewInfo;
}) {
  return (
    <ExtensionViewPanel
      api={host.api}
      target={host.target}
      view={view}
      theme={host.theme}
      variant="slot"
      onBeforePrepareTaskDraft={host.onBeforePrepareTaskDraft}
      onPrepareTaskDraftPendingChange={host.onPrepareTaskDraftPendingChange}
    />
  );
}

export function useRichOverlay(api: PiDesktopApi | undefined): {
  readonly overlay: ExtensionOverlayChange | null;
  readonly dismiss: () => void;
} {
  const [overlay, setOverlay] = useState<ExtensionOverlayChange | null>(null);
  useEffect(() => {
    if (!api) return;
    return api.onExtensionOverlayChanged((event) => {
      setOverlay((current) => {
        if (event.phase === "close") return current?.requestId === event.requestId ? null : current;
        return event;
      });
    });
  }, [api]);
  return {
    overlay,
    dismiss: () => {
      if (!api) return;
      void api.dismissExtensionOverlay().catch((error: unknown) => {
        console.error("[rich-overlay] dismiss failed", error);
      });
    },
  };
}

export function RichOverlayDialog({
  host,
  view,
  onDismiss,
}: {
  readonly host: RichSurfaceHost;
  readonly view: DesktopExtensionViewInfo;
  readonly onDismiss: () => void;
}): ReactNode {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = dialogRef.current;
    node?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);
  return (
    <div className="rich-overlay-backdrop" data-testid="rich-overlay">
      <div
        aria-label={view.title}
        aria-modal="true"
        className="rich-overlay-dialog"
        data-testid="rich-overlay-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="rich-overlay-dialog__header">
          <h2>{view.title}</h2>
          <button className="button" type="button" onClick={onDismiss}>
            Close
          </button>
        </header>
        <ExtensionViewPanel
          api={host.api}
          target={host.target}
          view={view}
          theme={host.theme}
          variant="overlay"
          onBeforePrepareTaskDraft={host.onBeforePrepareTaskDraft}
          onPrepareTaskDraftPendingChange={host.onPrepareTaskDraftPendingChange}
        />
      </div>
    </div>
  );
}

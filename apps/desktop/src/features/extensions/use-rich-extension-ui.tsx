import { useMemo, type ReactNode } from "react";
import type { SessionRef } from "@pi-garden/session-driver/types";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type {
  DesktopExtensionViewInfo,
  DesktopRichSurface,
} from "../../../contracts/extension-views";
import type { ExtensionViewTheme } from "./extension-view-panel";
import {
  RichOverlayDialog,
  RichSurfaceSlots,
  useRichOverlay,
  type RichSurfaceHost,
  type RichToolHost,
} from "./rich-surface-slots";

export function useRichExtensionUi(input: {
  readonly api: PiDesktopApi | undefined;
  readonly target: SessionRef | null;
  readonly theme: ExtensionViewTheme;
  readonly views: readonly DesktopExtensionViewInfo[];
  readonly beforePrepareTaskDraft: () => Promise<void>;
  readonly onPrepareTaskDraftPendingChange: (pending: boolean, requestKey: string) => void;
  readonly activeTool?: {
    readonly kind: string;
    readonly extensionId?: string;
    readonly viewId?: string;
  } | null;
}): {
  readonly activeView: DesktopExtensionViewInfo | undefined;
  readonly tools: RichToolHost | undefined;
  readonly overlay: ReactNode;
  readonly workbenchViews: readonly DesktopExtensionViewInfo[];
  readonly settings:
    | { readonly host: RichSurfaceHost; readonly views: readonly DesktopExtensionViewInfo[] }
    | undefined;
  readonly slot: (surface: DesktopRichSurface, label: string) => ReactNode;
} {
  const overlayState = useRichOverlay(input.api);
  const host = useMemo<RichSurfaceHost | null>(() => {
    if (!input.api || !input.target) return null;
    return {
      api: input.api,
      target: input.target,
      theme: input.theme,
      onBeforePrepareTaskDraft: input.beforePrepareTaskDraft,
      onPrepareTaskDraftPendingChange: input.onPrepareTaskDraftPendingChange,
    };
  }, [
    input.api,
    input.beforePrepareTaskDraft,
    input.onPrepareTaskDraftPendingChange,
    input.target,
    input.theme,
  ]);
  const tools = useMemo<RichToolHost | undefined>(() => {
    if (!host) return undefined;
    return { ...host, renderers: input.views };
  }, [host, input.views]);
  const workbenchViews = input.views.filter(
    (view) => (view.surface ?? "workbench") === "workbench",
  );
  const overlayView =
    overlayState.overlay && host
      ? input.views.find(
          (view) =>
            view.surface === "overlay" &&
            view.extensionId === overlayState.overlay?.extensionId &&
            view.id === overlayState.overlay.viewId &&
            view.generation === overlayState.overlay.generation &&
            view.state === "ready",
        )
      : undefined;
  const activeView =
    input.activeTool?.kind === "extension" &&
    input.activeTool.extensionId &&
    input.activeTool.viewId
      ? workbenchViews.find(
          (view) =>
            view.extensionId === input.activeTool?.extensionId &&
            view.id === input.activeTool.viewId,
        )
      : undefined;
  return {
    activeView,
    tools,
    workbenchViews,
    settings: host ? { host, views: input.views } : undefined,
    overlay:
      overlayView && host ? (
        <RichOverlayDialog host={host} view={overlayView} onDismiss={overlayState.dismiss} />
      ) : null,
    slot: (surface, label) =>
      host ? (
        <RichSurfaceSlots host={host} surface={surface} views={input.views} label={label} />
      ) : null,
  };
}

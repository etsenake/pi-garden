import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionRef } from "@pi-garden/session-driver/types";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type { DesktopEditorInfo } from "../../../contracts/desktop-editor";
import type { DesktopExtensionViewInfo } from "../../../contracts/extension-views";

interface ExtensionViewCatalog {
  readonly targetKey: string;
  readonly views: readonly DesktopExtensionViewInfo[];
  readonly editors: readonly DesktopEditorInfo[];
  readonly loading: boolean;
  readonly error: string;
}

export function useExtensionViews({
  api,
  target,
}: {
  readonly api: PiDesktopApi | undefined;
  readonly target: SessionRef | null;
}) {
  const [catalog, setCatalog] = useState<ExtensionViewCatalog | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((value) => value + 1), []);
  const latest = useRef(catalog);
  latest.current = catalog;
  const workspaceId = target?.workspaceId;
  const sessionId = target?.sessionId;
  const targetKey = JSON.stringify([workspaceId, sessionId]);

  useEffect(() => {
    if (!api || !workspaceId || !sessionId) return;
    let disposed = false;
    let receivedPush = false;
    const previous = latest.current;
    setCatalog({
      targetKey,
      views: previous?.targetKey === targetKey ? previous.views : [],
      editors: previous?.targetKey === targetKey ? previous.editors : [],
      loading: true,
      error: "",
    });
    // Subscribe before the initial list. A catalog replacement is newer than that in-flight read.
    const unsubscribe = api.onExtensionViewCatalogChanged((event) => {
      if (
        disposed ||
        event.target.workspaceId !== workspaceId ||
        event.target.sessionId !== sessionId
      )
        return;
      receivedPush = true;
      setCatalog((current) => ({
        targetKey,
        views: event.views,
        editors: event.editors ?? current?.editors ?? [],
        loading: false,
        error: "",
      }));
    });
    void Promise.all([
      api.listExtensionViews({ workspaceId, sessionId }),
      api.listDesktopEditors({ workspaceId, sessionId }),
    ]).then(
      ([views, editors]) => {
        if (!disposed && !receivedPush)
          setCatalog({ targetKey, views, editors, loading: false, error: "" });
      },
      (error: unknown) => {
        if (!disposed && !receivedPush)
          setCatalog({
            targetKey,
            views: previous?.targetKey === targetKey ? previous.views : [],
            editors: previous?.targetKey === targetKey ? previous.editors : [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, reloadNonce, sessionId, targetKey, workspaceId]);

  const current = catalog?.targetKey === targetKey ? catalog : null;
  return {
    views: current?.views ?? [],
    editors: current?.editors ?? [],
    loading: Boolean(target) && (!current || current.loading),
    error: current?.error ?? "",
    reload,
  };
}

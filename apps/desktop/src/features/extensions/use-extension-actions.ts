import { useEffect, useState } from "react";
import type { SessionRef } from "@pi-garden/session-driver/types";
import type { ExtensionActionCatalog } from "../../../contracts/extension-actions";
import type { PiDesktopApi } from "../../../contracts/ipc";

interface ExtensionActionState {
  readonly targetKey: string;
  readonly catalog: ExtensionActionCatalog | null;
}

export function useExtensionActions({
  api,
  target,
}: {
  readonly api: PiDesktopApi | undefined;
  readonly target: SessionRef | null;
}): ExtensionActionCatalog | null {
  const [state, setState] = useState<ExtensionActionState | null>(null);
  const workspaceId = target?.workspaceId;
  const sessionId = target?.sessionId;
  const targetKey = JSON.stringify([workspaceId, sessionId]);

  useEffect(() => {
    if (!api || !workspaceId || !sessionId) return;
    let disposed = false;
    let receivedPush = false;
    setState((previous) => ({
      targetKey,
      catalog: previous?.targetKey === targetKey ? previous.catalog : null,
    }));
    const unsubscribe = api.onExtensionActionsChanged((event) => {
      if (
        disposed ||
        event.target.workspaceId !== workspaceId ||
        event.target.sessionId !== sessionId
      ) {
        return;
      }
      receivedPush = true;
      setState({ targetKey, catalog: event.catalog });
    });
    void api.listExtensionActions({ workspaceId, sessionId }).then(
      (catalog) => {
        if (!disposed && !receivedPush) setState({ targetKey, catalog });
      },
      (error: unknown) => {
        console.error("[renderer] listExtensionActions failed", error);
        if (!disposed && !receivedPush) setState({ targetKey, catalog: null });
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, sessionId, targetKey, workspaceId]);

  return state?.targetKey === targetKey ? state.catalog : null;
}

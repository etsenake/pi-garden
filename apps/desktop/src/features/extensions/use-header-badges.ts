import { useEffect, useState } from "react";
import type { SessionRef } from "@pi-garden/session-driver/types";
import type { HeaderBadgePresentation } from "../../../contracts/header-badges";
import type { PiDesktopApi } from "../../../contracts/ipc";

interface HeaderBadgeCatalog {
  readonly targetKey: string;
  readonly badges: readonly HeaderBadgePresentation[];
}

export function useHeaderBadges({
  api,
  target,
}: {
  readonly api: PiDesktopApi | undefined;
  readonly target: SessionRef | null;
}): readonly HeaderBadgePresentation[] {
  const [catalog, setCatalog] = useState<HeaderBadgeCatalog | null>(null);
  const workspaceId = target?.workspaceId;
  const sessionId = target?.sessionId;
  const targetKey = JSON.stringify([workspaceId, sessionId]);

  useEffect(() => {
    if (!api || !workspaceId || !sessionId) return;
    let disposed = false;
    let receivedPush = false;
    setCatalog((previous) => ({
      targetKey,
      badges: previous?.targetKey === targetKey ? previous.badges : [],
    }));
    const unsubscribe = api.onHeaderBadgesChanged((event) => {
      if (
        disposed ||
        event.target.workspaceId !== workspaceId ||
        event.target.sessionId !== sessionId
      ) {
        return;
      }
      receivedPush = true;
      setCatalog({ targetKey, badges: event.badges });
    });
    void api.listHeaderBadges({ workspaceId, sessionId }).then(
      (badges) => {
        if (!disposed && !receivedPush) setCatalog({ targetKey, badges });
      },
      (error: unknown) => {
        console.error("[renderer] listHeaderBadges failed", error);
        if (!disposed && !receivedPush) setCatalog({ targetKey, badges: [] });
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, sessionId, targetKey, workspaceId]);

  return catalog?.targetKey === targetKey ? catalog.badges : [];
}

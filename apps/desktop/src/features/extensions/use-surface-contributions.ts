import { useEffect, useState } from "react";
import type { SessionRef } from "@pi-garden/session-driver/types";
import type { SurfaceContributionPresentation } from "../../../contracts/surface-contributions";
import type { PiDesktopApi } from "../../../contracts/ipc";

interface SurfaceContributionCatalog {
  readonly targetKey: string;
  readonly contributions: readonly SurfaceContributionPresentation[];
}

export function useSurfaceContributions({
  api,
  target,
}: {
  readonly api: PiDesktopApi | undefined;
  readonly target: SessionRef | null;
}): readonly SurfaceContributionPresentation[] {
  const [catalog, setCatalog] = useState<SurfaceContributionCatalog | null>(null);
  const workspaceId = target?.workspaceId;
  const sessionId = target?.sessionId;
  const targetKey = JSON.stringify([workspaceId, sessionId]);

  useEffect(() => {
    if (!api || !workspaceId || !sessionId) return;
    let disposed = false;
    let receivedPush = false;
    setCatalog((previous) => ({
      targetKey,
      contributions: previous?.targetKey === targetKey ? previous.contributions : [],
    }));
    const unsubscribe = api.onSurfaceContributionsChanged((event) => {
      if (
        disposed ||
        event.target.workspaceId !== workspaceId ||
        event.target.sessionId !== sessionId
      ) {
        return;
      }
      receivedPush = true;
      setCatalog({ targetKey, contributions: event.contributions });
    });
    void api.listSurfaceContributions({ workspaceId, sessionId }).then(
      (contributions) => {
        if (!disposed && !receivedPush) setCatalog({ targetKey, contributions });
      },
      (error: unknown) => {
        console.error("[renderer] listSurfaceContributions failed", error);
        if (!disposed && !receivedPush) setCatalog({ targetKey, contributions: [] });
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api, sessionId, targetKey, workspaceId]);

  return catalog?.targetKey === targetKey ? catalog.contributions : [];
}

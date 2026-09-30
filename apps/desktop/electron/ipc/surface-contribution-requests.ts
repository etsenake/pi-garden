import { desktopIpc } from "../../contracts/ipc";
import type { SurfaceRegistry } from "../extensions/surface-registry";
import type { MainFrameHandler } from "./main-frame-ipc";
import { expectSessionTarget } from "./request-validation";

export function registerSurfaceContributionRequests(
  handle: MainFrameHandler,
  registry: SurfaceRegistry,
): void {
  const senders = new Map<number, Electron.WebContents>();
  const track = (contents: Electron.WebContents) => {
    if (!senders.has(contents.id)) {
      senders.set(contents.id, contents);
      contents.once("destroyed", () => {
        senders.delete(contents.id);
      });
    }
    return contents;
  };
  registry.subscribe((target) => {
    const contributions = registry.list(target);
    for (const contents of senders.values()) {
      if (!contents.isDestroyed()) {
        contents.send(desktopIpc.surfaceContributionsChanged, { target, contributions });
      }
    }
  });
  handle(desktopIpc.listSurfaceContributions, expectSessionTarget, (target, request) => {
    track(request.contents);
    return registry.list(target);
  });
}

import { desktopIpc } from "../../contracts/ipc";
import type { HeaderBadgeOwner } from "../extensions/header-badge-owner";
import type { MainFrameHandler } from "./main-frame-ipc";
import { expectSessionTarget } from "./request-validation";

export function registerHeaderBadgeRequests(
  handle: MainFrameHandler,
  owner: HeaderBadgeOwner,
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
  owner.subscribe((target) => {
    const badges = owner.list(target);
    for (const contents of senders.values()) {
      if (!contents.isDestroyed())
        contents.send(desktopIpc.headerBadgesChanged, { target, badges });
    }
  });
  handle(desktopIpc.listHeaderBadges, expectSessionTarget, (target, request) => {
    track(request.contents);
    return owner.list(target);
  });
}

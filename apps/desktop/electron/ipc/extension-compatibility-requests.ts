import type { ExtensionCompatibilityRequest } from "../../contracts/extension-compatibility";
import { desktopIpc } from "../../contracts/ipc";
import type { ExtensionCompatibilityService } from "../extensions/extension-adaptation";
import type { ExtensionCompatibilityOwner } from "../extensions/extension-compatibility-owner";
import type { WindowOwner } from "../windows/window-owner";
import type { MainFrameHandler } from "./main-frame-ipc";
import { expectNonEmptyString, expectRecord } from "./request-validation";

function decodeRequest(raw: unknown): ExtensionCompatibilityRequest {
  const input = expectRecord(raw, "extension compatibility request");
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, "workspaceId"),
    extensionPath: expectNonEmptyString(input.extensionPath, "extensionPath"),
    ...(input.refresh === true ? { refresh: true } : {}),
  };
}

export function registerExtensionCompatibilityRequests(
  handle: MainFrameHandler,
  windows: Pick<WindowOwner, "runStateAction">,
  owner: Pick<ExtensionCompatibilityOwner, "subscribe">,
  service: Pick<ExtensionCompatibilityService, "inventory" | "adapt">,
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
  owner.subscribe((workspaceId) => {
    for (const contents of senders.values()) {
      if (!contents.isDestroyed()) {
        contents.send(desktopIpc.extensionCompatibilityChanged, { workspaceId });
      }
    }
  });
  handle(desktopIpc.getExtensionCompatibility, decodeRequest, (input, request) => {
    track(request.contents);
    return service.inventory(input);
  });
  handle(desktopIpc.adaptExtensionForDesktop, decodeRequest, (input, request) =>
    windows.runStateAction(request.window, () => service.adapt(input)),
  );
}

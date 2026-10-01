import type { ExtensionCompatibilityRequest } from "../../contracts/extension-compatibility";
import type { StartDesktopAuthoringInput } from "../../contracts/desktop-authoring";
import { desktopIpc } from "../../contracts/ipc";
import type { ExtensionCompatibilityService } from "../extensions/extension-adaptation";
import type { DesktopAuthoringService } from "../extensions/desktop-authoring";
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

const AUTHORING_KINDS = new Set([
  "host-contribution",
  "rich-surface",
  "desktop-view",
  "theme",
]);

function decodeAuthoring(raw: unknown): StartDesktopAuthoringInput {
  const input = expectRecord(raw, "desktop authoring request");
  const kind = expectNonEmptyString(input.kind, "kind");
  if (!AUTHORING_KINDS.has(kind)) {
    throw new Error(`Unknown desktop authoring kind: ${kind}`);
  }
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, "workspaceId"),
    kind: kind as StartDesktopAuthoringInput["kind"],
    ...(typeof input.id === "string" && input.id.trim() ? { id: input.id.trim() } : {}),
    ...(typeof input.surface === "string" && input.surface.trim()
      ? { surface: input.surface.trim() }
      : {}),
  };
}

export function registerExtensionCompatibilityRequests(
  handle: MainFrameHandler,
  windows: Pick<WindowOwner, "runStateAction">,
  owner: Pick<ExtensionCompatibilityOwner, "subscribe">,
  service: Pick<ExtensionCompatibilityService, "inventory" | "adapt">,
  authoring?: Pick<DesktopAuthoringService, "start">,
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
  if (authoring) {
    handle(desktopIpc.startDesktopAuthoring, decodeAuthoring, (input, request) =>
      windows.runStateAction(request.window, () => authoring.start(input)),
    );
  }
}

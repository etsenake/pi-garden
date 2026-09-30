import { STALE_EXTENSION_ACTION_MESSAGE } from "@pi-garden/extension-ui";
import { desktopIpc } from "../../contracts/ipc";
import type { ExtensionActionRegistry } from "../extensions/extension-action-registry";
import type { WindowOwner } from "../windows/window-owner";
import type { MainFrameHandler } from "./main-frame-ipc";
import {
  expectNonEmptyString,
  expectOptionalString,
  expectRecord,
  expectSessionTarget,
} from "./request-validation";

function decodeInvoke(raw: unknown) {
  const input = expectRecord(raw, "extension action request");
  return {
    actionId: expectNonEmptyString(input.actionId, "actionId"),
    generation: expectNonEmptyString(input.generation, "generation"),
    args: expectOptionalString(input.args, "args"),
  };
}

function decodeComplete(raw: unknown) {
  const input = expectRecord(raw, "extension command completion request");
  return {
    generation: expectNonEmptyString(input.generation, "generation"),
    commandName: expectNonEmptyString(input.commandName, "commandName"),
    prefix: expectOptionalString(input.prefix, "prefix") ?? "",
  };
}

export function registerExtensionActionRequests(
  handle: MainFrameHandler,
  windows: Pick<WindowOwner, "targetForSender">,
  registry: ExtensionActionRegistry,
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
    const catalog = registry.catalog(target) ?? null;
    for (const contents of senders.values()) {
      if (!contents.isDestroyed()) {
        contents.send(desktopIpc.extensionActionsChanged, { target, catalog });
      }
    }
  });
  handle(desktopIpc.listExtensionActions, expectSessionTarget, (target, request) => {
    track(request.contents);
    return registry.catalog(target) ?? null;
  });
  handle(desktopIpc.invokeExtensionAction, decodeInvoke, (input, request) => {
    const contents = track(request.contents);
    const target = windows.targetForSender(contents);
    if (!target) {
      throw new Error(STALE_EXTENSION_ACTION_MESSAGE);
    }
    return registry.invoke(target, input.generation, input.actionId, input.args);
  });
  handle(desktopIpc.completeExtensionCommandArgument, decodeComplete, (input, request) => {
    const contents = track(request.contents);
    const target = windows.targetForSender(contents);
    if (!target) return [];
    return registry.complete(target, input.generation, input.commandName, input.prefix);
  });
}

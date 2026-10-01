import path from "node:path";
import type { DesktopAppState, StartThreadInput } from "../../contracts/desktop-state";
import {
  buildDesktopAuthoringPrompt,
  type DesktopAuthoringKind,
  type DesktopAuthoringPaths,
  type StartDesktopAuthoringInput,
} from "../../contracts/desktop-authoring";

export interface DesktopAuthoringHost {
  workspaceFor(
    workspaceId: string,
  ): { readonly workspaceId: string; readonly path: string } | undefined;
  startThread(input: StartThreadInput): Promise<DesktopAppState>;
}

/**
 * Starts an ordinary Pi thread with a bundled authoring skill and absolute
 * writer / helper paths, same shape as Adapt for Desktop.
 */
export class DesktopAuthoringService {
  constructor(
    private readonly host: DesktopAuthoringHost,
    private readonly paths: DesktopAuthoringPaths,
  ) {}

  async start(input: StartDesktopAuthoringInput): Promise<DesktopAppState> {
    const workspace = this.host.workspaceFor(input.workspaceId);
    if (!workspace) throw new Error(`Unknown workspace: ${input.workspaceId}`);
    const extensionsDir = path.join(workspace.path, ".pi", "extensions");
    return this.host.startThread({
      rootWorkspaceId: workspace.workspaceId,
      environment: "local",
      prompt: buildDesktopAuthoringPrompt({
        kind: input.kind,
        workspacePath: workspace.path,
        paths: {
          ...this.paths,
          extensionsDir,
        },
        id: input.id,
        surface: input.surface,
      }),
    });
  }
}

export type { DesktopAuthoringKind, DesktopAuthoringPaths, StartDesktopAuthoringInput };

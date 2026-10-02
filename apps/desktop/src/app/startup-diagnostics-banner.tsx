import type { StartupDiagnostic, WorkspaceRecord } from "../../contracts/desktop-state";
import { CloseIcon } from "../ui/icons";
import { Button } from "@/ui/shadcn/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";

interface StartupDiagnosticsBannerProps {
  readonly diagnostics: readonly StartupDiagnostic[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly onRemoveWorkspace: (workspace: WorkspaceRecord) => void;
  readonly onDismiss: () => void;
}

export function StartupDiagnosticsBanner({
  diagnostics,
  workspaces,
  onRemoveWorkspace,
  onDismiss,
}: StartupDiagnosticsBannerProps) {
  if (diagnostics.length === 0) {
    return null;
  }
  return (
    <div className="startup-diagnostics" role="status" data-testid="startup-diagnostics">
      <div className="startup-diagnostics__body">
        <strong>Some saved workspaces could not be refreshed.</strong>
        {diagnostics.map((diagnostic, index) => {
          const workspaceName = diagnostic.workspacePath?.split(/[\\/]/).filter(Boolean).at(-1);
          const savedWorkspace = diagnostic.workspacePath
            ? workspaces.find(
                (workspace) =>
                  workspace.kind === "primary" && workspace.path === diagnostic.workspacePath,
              )
            : undefined;
          return (
            <Tooltip
              disabled={!diagnostic.workspacePath}
              key={`${diagnostic.workspacePath ?? diagnostic.scope}:${index}`}
            >
              <TooltipTrigger render={<span className="startup-diagnostics__item" />}>
                {workspaceName ? `${workspaceName} is unavailable.` : diagnostic.message}
                {savedWorkspace ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onRemoveWorkspace(savedWorkspace)}
                  >
                    Remove folder
                  </Button>
                ) : null}
              </TooltipTrigger>
              <TooltipContent side="bottom">{diagnostic.workspacePath}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button aria-label="Dismiss" size="icon-sm" variant="ghost" onClick={onDismiss} />
          }
        >
          <CloseIcon />
        </TooltipTrigger>
        <TooltipContent side="bottom">Dismiss</TooltipContent>
      </Tooltip>
    </div>
  );
}

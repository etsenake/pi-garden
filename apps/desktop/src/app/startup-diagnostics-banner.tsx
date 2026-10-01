import type { StartupDiagnostic, WorkspaceRecord } from "../../contracts/desktop-state";
import { CloseIcon } from "../ui/icons";

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
            <span
              className="startup-diagnostics__item"
              key={`${diagnostic.workspacePath ?? diagnostic.scope}:${index}`}
              title={diagnostic.workspacePath}
            >
              {workspaceName ? `${workspaceName} is unavailable.` : diagnostic.message}
              {savedWorkspace ? (
                <button
                  className="startup-diagnostics__action"
                  type="button"
                  onClick={() => onRemoveWorkspace(savedWorkspace)}
                >
                  Remove folder
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      <button
        aria-label="Dismiss"
        className="icon-button startup-diagnostics__dismiss"
        title="Dismiss"
        type="button"
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

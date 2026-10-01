import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { SurfaceContributionPresentation } from "../../contracts/surface-contributions";
import type { AppView, WorkspaceRecord, WorktreeRecord } from "../../contracts/desktop-state";
import { HeaderBadges } from "../features/extensions/header-badges";
import { StatusChromeContributions } from "../features/extensions/host-contributions";
import { getSidePanelToggleShortcutLabel, type PiDesktopApi } from "../../contracts/ipc";
import { SidePanelIcon } from "../ui/icons";
import { Button } from "@/ui/shadcn/button";
import { Kbd } from "@/ui/shadcn/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";

interface TopbarProps {
  readonly activeView: AppView;
  readonly sessionTitle?: string;
  readonly headerBadges?: readonly SurfaceContributionPresentation[];
  readonly statusContributions?: readonly SurfaceContributionPresentation[];
  readonly richHeader?: ReactNode;
  readonly onInvokeExtensionAction?: (actionId: string) => void;
  readonly children?: ReactNode;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly api: PiDesktopApi;
  readonly panelAvailable: boolean;
  readonly panelVisible: boolean;
  readonly onTogglePanel: () => void;
}

export function Topbar({
  activeView,
  sessionTitle,
  headerBadges = [],
  statusContributions = [],
  richHeader,
  onInvokeExtensionAction,
  children,
  rootWorkspace,
  selectedWorkspace,
  selectedWorktree,
  api,
  panelAvailable,
  panelVisible,
  onTogglePanel,
}: TopbarProps) {
  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(".topbar__actions")) return;
    void api.toggleWindowMaximize().catch((error: unknown) => {
      console.error("[renderer] toggleWindowMaximize failed", error);
    });
  };
  const checkoutLabel =
    selectedWorkspace?.kind === "worktree"
      ? (selectedWorktree?.name ?? selectedWorkspace.branchName ?? selectedWorkspace.name)
      : selectedWorkspace?.branchName;

  return (
    <header className="topbar" data-testid="topbar" onDoubleClick={handleDoubleClick}>
      <div className="topbar__title">
        <span
          className="topbar__workspace"
          title={checkoutLabel ? `${rootWorkspace?.name ?? ""} · ${checkoutLabel}` : undefined}
        >
          {rootWorkspace ? rootWorkspace.name : "Open a folder to begin"}
        </span>
        {sessionTitle ? (
          <>
            <span className="topbar__separator">/</span>
            <h1 className="chat-header__title" title={sessionTitle}>
              {sessionTitle}
            </h1>
            <HeaderBadges badges={headerBadges} onInvokeAction={onInvokeExtensionAction} />
            {richHeader}
          </>
        ) : activeView === "threads" && checkoutLabel ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{checkoutLabel}</span>
          </>
        ) : activeView === "new-thread" && rootWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">New thread</span>
          </>
        ) : null}
      </div>
      <div className="topbar__actions">
        <StatusChromeContributions
          contributions={statusContributions}
          onInvokeAction={onInvokeExtensionAction}
        />
        {children}
        {!panelVisible ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-controls="task-workbench"
                  aria-label="Toggle side panel"
                  aria-pressed={panelVisible}
                  className="topbar__icon"
                  data-testid="toggle-side-panel"
                  disabled={!panelAvailable}
                  size="icon"
                  variant="ghost"
                  onClick={onTogglePanel}
                />
              }
            >
              <SidePanelIcon />
            </TooltipTrigger>
            <TooltipContent align="end" side="bottom">
              Show side panel
              <Kbd>{getSidePanelToggleShortcutLabel(api.platform)}</Kbd>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </header>
  );
}

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  formatShortcut,
  getSidePanelTabShortcutLabel,
  SIDE_PANEL_TAB_SHORTCUT_SLOT_COUNT,
} from "../../../contracts/ipc";
import { toolRefId, type TaskWorkbenchTemplate, type ToolRef } from "../../../contracts/workbench";
import type { DesktopExtensionViewInfo } from "../../../contracts/extension-views";
import { CloseIcon, ExtensionIcon, PlusIcon, SidePanelIcon } from "../../ui/icons";
import { Button } from "@/ui/shadcn/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/ui/shadcn/item";
import { Kbd } from "@/ui/shadcn/kbd";
import { ScrollArea } from "@/ui/shadcn/scroll-area";
import { Spinner } from "@/ui/shadcn/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";
import { PanelEmpty } from "./panel-empty";
import { WithTooltip } from "./workbench-tooltip";
import { BUILTIN_TOOL_ENTRIES, BUILTIN_TOOLS } from "./builtin-tools";
import { activeWorkbenchTool } from "./workbench-state";

interface WorkbenchProps {
  readonly view: TaskWorkbenchTemplate;
  readonly platform: NodeJS.Platform;
  /** Whether the side panel tab modifier is held, so tabs show their numbers. */
  readonly tabHintsVisible: boolean;
  readonly onTogglePanel: () => void;
  readonly onOpenTool: (tool: ToolRef) => void;
  readonly onActivateTool: (toolId: string) => void;
  readonly onCloseTool: (toolId: string) => void;
  readonly onShowChooser: () => void;
  readonly children?: ReactNode;
  readonly error?: string;
  readonly loading?: boolean;
  readonly onRetryRestore?: () => void;
  readonly extensionViews?: readonly DesktopExtensionViewInfo[];
  readonly extensionViewsLoading?: boolean;
  readonly extensionViewsError?: string;
  readonly onReloadExtensionViews?: () => void;
}

export function workbenchToolLabel(tool: ToolRef): string {
  return tool.kind === "extension" ? tool.viewId : BUILTIN_TOOLS[tool.kind].label;
}

function ToolIcon({ tool }: { readonly tool: ToolRef }) {
  if (tool.kind === "extension") return <ExtensionIcon />;
  const { Icon } = BUILTIN_TOOLS[tool.kind];
  return <Icon />;
}

export function Workbench({
  view,
  platform,
  tabHintsVisible,
  onTogglePanel,
  onOpenTool,
  onActivateTool,
  onCloseTool,
  onShowChooser,
  children,
  error,
  loading = false,
  onRetryRestore,
  extensionViews = [],
  extensionViewsLoading = false,
  extensionViewsError = "",
  onReloadExtensionViews,
}: WorkbenchProps) {
  const panelId = useId();
  const addRef = useRef<HTMLButtonElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeTool = activeWorkbenchTool(view);
  const activeExtension =
    activeTool?.kind === "extension"
      ? extensionViews.find(
          (entry) => entry.extensionId === activeTool.extensionId && entry.id === activeTool.viewId,
        )
      : undefined;
  useEffect(() => {
    if (view.visibility === "visible" && view.selection.kind === "tool") {
      tabRefs.current
        .get(view.selection.toolId)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [view.selection, view.visibility]);

  const tabId = (toolId: string) => `${panelId}-${encodeURIComponent(toolId)}`;

  const closeAndFocus = (toolId: string) => {
    const index = view.tools.findIndex((tool) => toolRefId(tool) === toolId);
    const remaining = view.tools.filter((tool) => toolRefId(tool) !== toolId);
    const neighbor = remaining[Math.min(index, remaining.length - 1)];
    const active = view.selection;
    const nextId =
      active.kind === "tool" && active.toolId !== toolId
        ? active.toolId
        : neighbor
          ? toolRefId(neighbor)
          : undefined;
    onCloseTool(toolId);
    window.requestAnimationFrame(() => {
      if (nextId) tabRefs.current.get(nextId)?.focus();
      else addRef.current?.focus();
    });
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, toolId: string) => {
    // Arrow, Home and End keys move between tabs through the tab list itself.
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      closeAndFocus(toolId);
    }
  };

  if (view.visibility === "hidden") return null;

  return (
    <Tabs
      aria-label="Side workspace"
      className="workbench side-panel h-full gap-0"
      data-testid="workbench"
      id="task-workbench"
      onValueChange={(toolId) => {
        if (typeof toolId === "string") onActivateTool(toolId);
      }}
      render={<aside />}
      value={view.selection.kind === "tool" ? view.selection.toolId : null}
    >
      <div className="workbench__tabbar">
        <TabsList
          activateOnFocus
          aria-label="Workspace tools"
          className="min-w-0 flex-1 justify-start overflow-x-auto [scrollbar-width:none]"
          variant="line"
        >
          {view.tools.map((tool, index) => {
            const toolId = toolRefId(tool);
            const label =
              tool.kind === "extension"
                ? (extensionViews.find(
                    (entry) => entry.extensionId === tool.extensionId && entry.id === tool.viewId,
                  )?.title ?? workbenchToolLabel(tool))
                : workbenchToolLabel(tool);
            const slot = index < SIDE_PANEL_TAB_SHORTCUT_SLOT_COUNT ? index + 1 : undefined;
            const shortcut = slot ? getSidePanelTabShortcutLabel(platform, slot) : undefined;
            return (
              <div className="flex max-w-45 min-w-0 flex-none items-center" key={toolId}>
                <WithTooltip label={label} shortcut={shortcut}>
                  <TabsTrigger
                    aria-controls={panelId}
                    aria-keyshortcuts={
                      slot ? `${platform === "darwin" ? "Control" : "Alt"}+${slot}` : undefined
                    }
                    aria-label={label}
                    className="min-w-0"
                    data-tab-shortcut={tabHintsVisible && slot ? String(slot) : undefined}
                    data-testid={`workbench-tab-${toolId}`}
                    disabled={loading}
                    id={tabId(toolId)}
                    onKeyDown={(event) => onTabKeyDown(event, toolId)}
                    ref={(button: HTMLButtonElement | null) => {
                      if (button) tabRefs.current.set(toolId, button);
                      else tabRefs.current.delete(toolId);
                    }}
                    value={toolId}
                  >
                    {tabHintsVisible && shortcut ? (
                      <Kbd aria-hidden="true" className="workbench__tab-shortcut">
                        {shortcut}
                      </Kbd>
                    ) : (
                      <ToolIcon tool={tool} />
                    )}
                    <span className="truncate">{label}</span>
                  </TabsTrigger>
                </WithTooltip>
                <Button
                  aria-label={`Close ${label} tab`}
                  disabled={loading}
                  onClick={() => closeAndFocus(toolId)}
                  size="icon-xs"
                  tabIndex={-1}
                  variant="ghost"
                >
                  <CloseIcon />
                </Button>
              </div>
            );
          })}
        </TabsList>
        <WithTooltip label="Add tab">
          <Button
            aria-label="Add tab"
            data-testid="workbench-add-tab"
            disabled={loading}
            onClick={onShowChooser}
            ref={addRef}
            size="icon-sm"
            variant="ghost"
          >
            <PlusIcon />
          </Button>
        </WithTooltip>
        <WithTooltip label="Hide side panel">
          <Button
            aria-label="Toggle side panel"
            aria-pressed="true"
            aria-controls="task-workbench"
            data-testid="toggle-side-panel"
            onClick={onTogglePanel}
            size="icon-sm"
            variant="ghost"
          >
            <SidePanelIcon />
          </Button>
        </WithTooltip>
      </div>
      {error ? (
        <div className="workbench__error" role="status">
          <p>{error}</p>
          {loading && onRetryRestore ? (
            <Button onClick={onRetryRestore} size="sm" variant="outline">
              Retry restoring tabs
            </Button>
          ) : null}
        </div>
      ) : null}
      <WorkbenchContent
        id={panelId}
        labelledBy={activeTool ? tabId(toolRefId(activeTool)) : undefined}
        toolId={activeTool ? toolRefId(activeTool) : undefined}
      >
        {loading ? (
          <PanelEmpty
            loading
            role="status"
            title={
              error
                ? "Saved tabs are unavailable until restoration succeeds."
                : "Restoring tool tabs…"
            }
          />
        ) : view.selection.kind === "chooser" ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="workbench__chooser" data-testid="workbench-chooser">
              <h2>Open a tool</h2>
              <p>Keep the tools you need alongside your conversation.</p>
              {BUILTIN_TOOL_ENTRIES.map(({ kind, label, description, Icon, shortcutKey }) => (
                <Item
                  aria-keyshortcuts={
                    shortcutKey
                      ? `${platform === "darwin" ? "Meta" : "Control"}+${shortcutKey}`
                      : undefined
                  }
                  aria-label={label}
                  className="text-left hover:bg-muted"
                  key={kind}
                  onClick={() => onOpenTool({ kind })}
                  render={<button type="button" />}
                  variant="outline"
                >
                  <ItemMedia variant="icon">
                    <Icon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{label}</ItemTitle>
                    <ItemDescription>{description}</ItemDescription>
                  </ItemContent>
                  {shortcutKey ? (
                    <ItemActions>
                      <Kbd>{formatShortcut(platform, shortcutKey)}</Kbd>
                    </ItemActions>
                  ) : null}
                </Item>
              ))}
              <h3 className="workbench__extension-heading">Extension views</h3>
              {extensionViewsLoading ? (
                <p className="flex items-center gap-2" role="status">
                  <Spinner aria-hidden="true" role="presentation" />
                  Loading extension views…
                </p>
              ) : null}
              {extensionViewsError ? (
                <div role="status">
                  <p>{extensionViewsError}</p>
                  {onReloadExtensionViews ? (
                    <Button onClick={onReloadExtensionViews} size="sm" variant="outline">
                      Refresh views
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {extensionViews.map((extension) => (
                <Item
                  aria-label={extension.title}
                  className="text-left hover:bg-muted"
                  key={toolRefId({
                    kind: "extension",
                    extensionId: extension.extensionId,
                    viewId: extension.id,
                  })}
                  onClick={() =>
                    onOpenTool({
                      kind: "extension",
                      extensionId: extension.extensionId,
                      viewId: extension.id,
                    })
                  }
                  render={<button type="button" />}
                  variant="outline"
                >
                  <ItemMedia variant="icon">
                    <ExtensionIcon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{extension.title}</ItemTitle>
                    {extension.state === "error" ? (
                      <ItemDescription>{extension.error ?? "View unavailable"}</ItemDescription>
                    ) : null}
                  </ItemContent>
                </Item>
              ))}
              {!extensionViewsLoading && !extensionViewsError && extensionViews.length === 0 ? (
                <p>Installed extensions can provide additional views here.</p>
              ) : null}
            </div>
          </ScrollArea>
        ) : activeTool?.kind === "extension" && activeExtension?.state !== "ready" ? (
          <PanelEmpty
            description={
              activeExtension?.error ||
              extensionViewsError ||
              "Your saved tab is retained. Extension commands can still be used when installed."
            }
            loading={extensionViewsLoading}
            media={<ExtensionIcon />}
            role="status"
            title={
              extensionViewsLoading
                ? "Finding this extension view…"
                : "This extension view is unavailable"
            }
          >
            <div className="flex gap-2">
              {!extensionViewsLoading && onReloadExtensionViews ? (
                <Button onClick={onReloadExtensionViews} size="sm" variant="outline">
                  Refresh views
                </Button>
              ) : null}
              <Button
                onClick={() => closeAndFocus(toolRefId(activeTool))}
                size="sm"
                variant="outline"
              >
                Close tab
              </Button>
            </div>
          </PanelEmpty>
        ) : (
          children
        )}
      </WorkbenchContent>
    </Tabs>
  );
}

/** The active tool's tab panel; the chooser has no selected tab, so it is a plain region. */
function WorkbenchContent({
  id,
  labelledBy,
  toolId,
  children,
}: {
  readonly id: string;
  readonly labelledBy: string | undefined;
  readonly toolId: string | undefined;
  readonly children: ReactNode;
}) {
  if (toolId === undefined) {
    return (
      <div className="workbench__content" id={id}>
        {children}
      </div>
    );
  }
  return (
    <TabsContent aria-labelledby={labelledBy} className="workbench__content" id={id} value={toolId}>
      {children}
    </TabsContent>
  );
}

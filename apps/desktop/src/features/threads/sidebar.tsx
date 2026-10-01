import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SurfaceContributionPresentation } from "../../../contracts/surface-contributions";
import type {
  AppView,
  SessionRecord,
  ThreadGrouping,
  WorkspaceRecord,
  WorktreeRecord,
} from "../../../contracts/desktop-state";
import { SidebarSectionContributions } from "../extensions/host-contributions";
import { SidebarFooter } from "../extensions/sidebar-footer";
import {
  ArchiveIcon,
  ChevronDownIcon,
  CustomizeSidebarIcon,
  ExtensionIcon,
  FolderIcon,
  MoreIcon,
  PinIcon,
  PlusIcon,
  RestoreIcon,
  SettingsIcon,
  SkillIcon,
  ClockIcon,
  WorktreeIcon,
} from "../../ui/icons";
import {
  getDesktopShortcutLabel,
  THREAD_SHORTCUT_SLOT_COUNT,
  type PiDesktopApi,
} from "../../../contracts/ipc";
import { formatRelativeTime } from "../../lib/string-utils";
import { PaneResizeHandle, type PaneWidthBounds } from "../../ui/pane-resize-handle";
import { usePersistedPaneWidth } from "../../ui/use-persisted-pane-width";
import { sessionLastInteractedAt } from "../../../contracts/thread-recency";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import type { ThreadMenuState } from "./hooks/use-thread-actions";
import { archiveThreadShortcut, ThreadActionContextMenuItems } from "./thread-actions";
import {
  recencyHistoryExpansionKey,
  sessionThreadKey,
  threadHistoryPreview,
  visibleThreadShortcutOrder,
  workspaceHistoryExpansionKey,
  type RecencyThreadSection,
  type ThreadSidebarModel,
  type ThreadListEntry,
  type WorkspaceThreadGroup,
} from "./thread-groups";
import { useThreadShortcutHintsVisible } from "./thread-shortcut-hints";
import type { Dispatch, SetStateAction } from "react";
import type { DesktopAppState } from "../../../contracts/desktop-state";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/shadcn/collapsible";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/ui/shadcn/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/shadcn/empty";
import { Input } from "@/ui/shadcn/input";
import { Kbd } from "@/ui/shadcn/kbd";
import { ScrollArea } from "@/ui/shadcn/scroll-area";
import { Separator } from "@/ui/shadcn/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";

interface SidebarProps {
  readonly activeView: AppView;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
  readonly threadSidebarModel: ThreadSidebarModel;
  readonly threadGrouping: ThreadGrouping;
  readonly linkedWorktreeByWorkspaceId: ReadonlyMap<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly threadMenu: ThreadMenuState;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly onNewThread: (workspaceId?: string) => void;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onOpenSkills: (workspaceId?: string) => void;
  readonly onOpenExtensions: (workspaceId?: string) => void;
  readonly onOpenSettings: (workspaceId?: string) => void;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly threadShortcutOrderRef: MutableRefObject<readonly ThreadListEntry[] | null>;
  readonly sidebarFooter?: readonly SurfaceContributionPresentation[];
  readonly sidebarSection?: readonly SurfaceContributionPresentation[];
  readonly richSections?: ReactNode;
  readonly onInvokeExtensionAction?: (actionId: string) => void;
}

const SIDEBAR_WIDTH_RANGE = { min: 200, max: 520 } as const;

function sidebarWidthBounds(_sidebar: HTMLElement, shell: HTMLElement): PaneWidthBounds {
  return {
    min: SIDEBAR_WIDTH_RANGE.min,
    max: Math.floor(Math.min(SIDEBAR_WIDTH_RANGE.max, shell.clientWidth * 0.45)),
  };
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

interface ThreadShortcutBadge {
  readonly slot: number;
  readonly label: string;
}

const ThreadShortcutContext = createContext<ReadonlyMap<string, ThreadShortcutBadge> | undefined>(
  undefined,
);

export function Sidebar(props: SidebarProps) {
  const {
    activeView,
    selectedWorkspace,
    selectedSession,
    visibleWorkspaces,
    threadSidebarModel,
    threadGrouping,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    threadMenu,
    api,
    setSnapshot,
    updateSnapshot,
    onNewThread,
    onSetActiveView,
    onOpenSkills,
    onOpenExtensions,
    onOpenSettings,
    onArchiveSession,
    onSelectSession,
    onSetSessionPinned,
    onUnarchiveSession,
    threadShortcutOrderRef,
    sidebarFooter = [],
    sidebarSection = [],
    richSections,
    onInvokeExtensionAction,
  } = props;

  const [sidebarWidth, setSidebarWidth] = usePersistedPaneWidth(
    "pi-garden.sidebar-width",
    SIDEBAR_WIDTH_RANGE,
  );
  const sidebarWidthStyle: (CSSProperties & { "--sidebar-width": string }) | undefined =
    sidebarWidth === undefined ? undefined : { "--sidebar-width": `${sidebarWidth}px` };
  const [activeId, setActiveId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<ReadonlySet<string>>(() => new Set());
  const commandHeld = useThreadShortcutHintsVisible(api.platform);
  const shortcutOrder = visibleThreadShortcutOrder({
    grouping: threadGrouping,
    model: threadSidebarModel,
    expandedHistory,
    archivedOpen,
  });
  threadShortcutOrderRef.current = shortcutOrder;
  const shortcutByKey = commandHeld
    ? new Map(
        shortcutOrder.slice(0, THREAD_SHORTCUT_SLOT_COUNT).map((thread, index) => {
          const slot = index + 1;
          return [
            sessionThreadKey(thread),
            { slot, label: getDesktopShortcutLabel(api.platform, String(slot)) },
          ] as const;
        }),
      )
    : undefined;

  useEffect(() => {
    return () => {
      threadShortcutOrderRef.current = null;
    };
  }, [threadShortcutOrderRef]);

  // Rename can start from the header, Cmd-K or its shortcut, so reveal the
  // row that holds the rename field when it sits in a collapsed group.
  const renameSessionId = threadMenu.renameSessionId;
  useEffect(() => {
    if (!renameSessionId) return;
    const holds = (threads: readonly ThreadListEntry[]) =>
      threads.some((thread) => thread.session.id === renameSessionId);
    if (holds(threadSidebarModel.archivedThreads)) {
      setArchivedOpen(true);
      return;
    }
    const keys = [
      ...threadSidebarModel.recencySections
        .filter((section) => holds(section.threads))
        .map((section) => recencyHistoryExpansionKey(section.bucket)),
      ...threadSidebarModel.workspaceGroups
        .filter((group) => holds(group.threads))
        .map((group) => workspaceHistoryExpansionKey(group.workspace.id)),
    ];
    setExpandedHistory((current) =>
      keys.every((key) => current.has(key)) ? current : new Set([...current, ...keys]),
    );
    // Reveal once per rename; later list changes should not reopen groups.
  }, [renameSessionId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const pinnedSortableId = (thread: ThreadListEntry) => `pinned:${sessionThreadKey(thread)}`;
  const pinnedSessionKeyFromSortableId = (id: string) =>
    id.startsWith("pinned:") ? id.slice("pinned:".length) : id;

  // Collision detection based on workspace row headers only (~30px top of each group),
  // not the full group height including all sessions.
  const headerCollision: CollisionDetection = (args) => {
    if (String(args.active.id).startsWith("pinned:")) {
      const pointerY = args.pointerCoordinates?.y;
      if (pointerY == null) return [];
      let closest: { id: string; distance: number } | null = null;
      for (const container of args.droppableContainers) {
        const containerId = String(container.id);
        if (!containerId.startsWith("pinned:") || containerId === String(args.active.id)) {
          continue;
        }
        const rect = container.rect.current;
        if (!rect) continue;
        const rowCenter = rect.top + rect.height / 2;
        const distance = Math.abs(pointerY - rowCenter);
        if (!closest || distance < closest.distance) {
          closest = { id: containerId, distance };
        }
      }
      return closest
        ? [
            {
              id: closest.id,
              data: {
                droppableContainer: args.droppableContainers.find(
                  (c) => String(c.id) === closest!.id,
                )!,
              },
            },
          ]
        : [];
    }
    const pointerY = args.pointerCoordinates?.y;
    if (pointerY == null) return [];

    let closest: { id: string; distance: number } | null = null;
    for (const container of args.droppableContainers) {
      if (String(container.id).startsWith("pinned:")) {
        continue;
      }
      const rect = container.rect.current;
      if (!rect) continue;
      const headerCenter = rect.top + 15; // center of the ~30px workspace row header
      const distance = Math.abs(pointerY - headerCenter);
      if (!closest || distance < closest.distance) {
        closest = { id: String(container.id), distance };
      }
    }
    return closest
      ? [
          {
            id: closest.id,
            data: {
              droppableContainer: args.droppableContainers.find(
                (c) => String(c.id) === closest!.id,
              )!,
            },
          },
        ]
      : [];
  };

  const folderHasThreads = (folderId: string) =>
    threadSidebarModel.workspaceGroups.some(
      (group) => group.workspace.id === folderId && group.threads.length > 0,
    ) ||
    threadSidebarModel.pinnedThreads.some((thread) => thread.folderId === folderId) ||
    threadSidebarModel.archivedThreads.some((thread) => thread.folderId === folderId);
  const showFolderRow = (group: WorkspaceThreadGroup) =>
    threadGrouping === "workspace" || !folderHasThreads(group.workspace.id);
  const rootGroups = threadSidebarModel.workspaceGroups.filter(
    (group) => group.workspace.kind === "primary" && showFolderRow(group),
  );
  const orphanGroups = threadSidebarModel.workspaceGroups.filter(
    (group) => group.workspace.kind !== "primary" && showFolderRow(group),
  );
  const pinnedThreads = threadSidebarModel.pinnedThreads;
  const pinnedSortableIds = pinnedThreads.map(pinnedSortableId);
  const rootGroupIds = rootGroups.map((group) => group.workspace.id);
  const canDrag = rootGroups.length > 1;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    if (String(active.id).startsWith("pinned:")) {
      const oldIndex = pinnedSortableIds.indexOf(String(active.id));
      const newIndex = pinnedSortableIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const newOrder = arrayMove(pinnedSortableIds, oldIndex, newIndex).map(
        pinnedSessionKeyFromSortableId,
      );
      applyOptimisticReorder(
        (prev) => ({ ...prev, pinnedSessionOrder: newOrder }),
        () => api.reorderPinnedSessions(newOrder),
      );
      return;
    }

    const oldIndex = rootGroupIds.indexOf(String(active.id));
    const newIndex = rootGroupIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const newOrder = arrayMove(rootGroupIds, oldIndex, newIndex);
    applyOptimisticReorder(
      (prev) => ({ ...prev, workspaceOrder: newOrder }),
      () => api.reorderWorkspaces(newOrder),
    );
  }

  // Optimistically update local state to avoid snap-back animation, then reconcile with the
  // authoritative state the IPC call returns; roll back to the pre-reorder snapshot on rejection.
  function applyOptimisticReorder(
    optimistic: (prev: DesktopAppState) => DesktopAppState,
    commit: () => Promise<DesktopAppState>,
  ) {
    let previousSnapshot: DesktopAppState | null = null;
    setSnapshot((prev) => {
      previousSnapshot = prev;
      return prev ? optimistic(prev) : prev;
    });
    void commit().then(
      (state) => setSnapshot(state),
      () => setSnapshot(previousSnapshot),
    );
  }

  const activeFolder = activeId
    ? rootGroups.find((group) => group.workspace.id === activeId)?.workspace
    : undefined;
  const activePinnedThread = activeId?.startsWith("pinned:")
    ? pinnedThreads.find((thread) => pinnedSortableId(thread) === activeId)
    : undefined;

  function pickWorkspace() {
    void updateSnapshot(setSnapshot, () => api.pickWorkspace()).catch((error: unknown) => {
      console.error("[renderer] pickWorkspace failed", error);
    });
  }

  function toggleHistoryExpanded(key: string) {
    setExpandedHistory((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <aside className="sidebar" id="primary-sidebar" style={sidebarWidthStyle}>
      <PaneResizeHandle
        className="sidebar__resize-handle"
        label="Sidebar width"
        controls="primary-sidebar"
        edge="right"
        bounds={sidebarWidthBounds}
        onResize={setSidebarWidth}
        onReset={() => setSidebarWidth(undefined)}
      />
      <div className="sidebar__top">
        <Button
          className="sidebar__new w-full justify-start"
          variant="secondary"
          disabled={!selectedWorkspace}
          onClick={() => onNewThread()}
        >
          <PlusIcon />
          <span>New thread</span>
        </Button>

        <nav className="sidebar__nav" aria-label="Sidebar">
          <SidebarNavItem
            active={activeView === "threads"}
            icon={<FolderIcon />}
            label="Threads"
            onClick={() => onSetActiveView("threads")}
          />
          <SidebarNavItem
            active={activeView === "scheduled"}
            icon={<ClockIcon />}
            label="Scheduled"
            testId="sidebar-scheduled"
            onClick={() => onSetActiveView("scheduled")}
          />
          <SidebarNavItem
            icon={<SkillIcon />}
            label="Skills"
            onClick={() =>
              onOpenSkills(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)
            }
          />
          <SidebarNavItem
            icon={<ExtensionIcon />}
            label="Extensions"
            onClick={() =>
              onOpenExtensions(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)
            }
          />
          <SidebarNavItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={() =>
              onOpenSettings(selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id)
            }
          />
        </nav>
      </div>

      <ScrollArea className="mr-1 min-h-0">
        <div className="sidebar__section">
          <div className="section__head">
            <span>Threads</span>
            <div className="section__tools">
              <ThreadGroupingControl
                grouping={threadGrouping}
                onChange={(grouping) => {
                  void updateSnapshot(setSnapshot, () => api.setThreadGrouping(grouping)).catch(
                    (error: unknown) => {
                      console.error("[renderer] setThreadGrouping failed", error);
                    },
                  );
                }}
              />
              <Tooltip disableHoverablePopup>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="Open folder"
                      variant="ghost"
                      size="icon-sm"
                      onClick={pickWorkspace}
                    />
                  }
                >
                  <FolderIcon />
                </TooltipTrigger>
                <TooltipContent role="tooltip">Open folder</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {visibleWorkspaces.length === 0 ? (
            <Empty className="p-4" data-testid="empty-state">
              <EmptyHeader>
                <EmptyTitle>No folders yet</EmptyTitle>
                <EmptyDescription>
                  Open a project folder to start building a workspace and session list.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={pickWorkspace}>Open first folder</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={headerCollision}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <ThreadShortcutContext.Provider value={shortcutByKey}>
                <div className="workspace-list" data-testid="workspace-list">
                  <SortableContext items={rootGroupIds} strategy={verticalListSortingStrategy}>
                    {rootGroups.map((group) => (
                      <SortableWorkspaceFolder
                        key={group.workspace.id}
                        workspace={group.workspace}
                        threads={threadGrouping === "workspace" ? group.threads : undefined}
                        historyExpanded={expandedHistory.has(
                          workspaceHistoryExpansionKey(group.workspace.id),
                        )}
                        onToggleHistory={() =>
                          toggleHistoryExpanded(workspaceHistoryExpansionKey(group.workspace.id))
                        }
                        canDrag={canDrag}
                        selectedWorkspace={selectedWorkspace}
                        selectedSession={selectedSession}
                        linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                        wsMenu={wsMenu}
                        api={api}
                        threadMenu={threadMenu}
                        onNewThread={onNewThread}
                        onArchiveSession={onArchiveSession}
                        onSelectSession={onSelectSession}
                        onSetSessionPinned={onSetSessionPinned}
                      />
                    ))}
                  </SortableContext>
                  {orphanGroups.map((group) => (
                    <section
                      key={group.workspace.id}
                      className="workspace-group"
                      data-workspace-id={group.workspace.id}
                    >
                      <WorkspaceFolderContent
                        workspace={group.workspace}
                        threads={threadGrouping === "workspace" ? group.threads : undefined}
                        historyExpanded={expandedHistory.has(
                          workspaceHistoryExpansionKey(group.workspace.id),
                        )}
                        onToggleHistory={() =>
                          toggleHistoryExpanded(workspaceHistoryExpansionKey(group.workspace.id))
                        }
                        canDrag={false}
                        selectedWorkspace={selectedWorkspace}
                        selectedSession={selectedSession}
                        linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                        wsMenu={wsMenu}
                        api={api}
                        threadMenu={threadMenu}
                        onNewThread={onNewThread}
                        onArchiveSession={onArchiveSession}
                        onSelectSession={onSelectSession}
                        onSetSessionPinned={onSetSessionPinned}
                      />
                    </section>
                  ))}
                  {pinnedThreads.length > 0 ? (
                    <PinnedThreadsSection
                      pinnedThreads={pinnedThreads}
                      sortableIds={pinnedSortableIds}
                      sortableIdForThread={pinnedSortableId}
                      selectedWorkspace={selectedWorkspace}
                      selectedSession={selectedSession}
                      threadMenu={threadMenu}
                      onArchiveSession={onArchiveSession}
                      onSelectSession={onSelectSession}
                      onSetSessionPinned={onSetSessionPinned}
                    />
                  ) : null}
                  {threadGrouping === "time"
                    ? threadSidebarModel.recencySections.map((section) => (
                        <RecencyThreadSectionView
                          key={section.bucket}
                          section={section}
                          historyExpanded={expandedHistory.has(
                            recencyHistoryExpansionKey(section.bucket),
                          )}
                          onToggleHistory={() =>
                            toggleHistoryExpanded(recencyHistoryExpansionKey(section.bucket))
                          }
                          selectedWorkspace={selectedWorkspace}
                          selectedSession={selectedSession}
                          threadMenu={threadMenu}
                          onArchiveSession={onArchiveSession}
                          onSelectSession={onSelectSession}
                          onSetSessionPinned={onSetSessionPinned}
                        />
                      ))
                    : null}
                  {threadSidebarModel.archivedThreads.length > 0 ? (
                    <ArchivedThreadsSection
                      archivedThreads={threadSidebarModel.archivedThreads}
                      open={archivedOpen}
                      onOpenChange={setArchivedOpen}
                      selectedWorkspace={selectedWorkspace}
                      selectedSession={selectedSession}
                      threadMenu={threadMenu}
                      onUnarchiveSession={onUnarchiveSession}
                      onSelectSession={onSelectSession}
                      onSetSessionPinned={onSetSessionPinned}
                    />
                  ) : null}
                </div>
                <DragOverlay>
                  {activePinnedThread ? (
                    <ThreadSessionRow
                      active={
                        activePinnedThread.workspaceId === selectedWorkspace?.id &&
                        activePinnedThread.session.id === selectedSession?.id
                      }
                      thread={activePinnedThread}
                      showContext
                      overlay
                      onAction={() => undefined}
                      onSelect={() => undefined}
                      onTogglePinned={() => undefined}
                    />
                  ) : activeFolder ? (
                    <div className="workspace-group workspace-group--overlay">
                      <WorkspaceFolderContent
                        workspace={activeFolder}
                        canDrag={false}
                        selectedWorkspace={selectedWorkspace}
                        linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
                        wsMenu={wsMenu}
                        api={api}
                      />
                    </div>
                  ) : null}
                </DragOverlay>
              </ThreadShortcutContext.Provider>
            </DndContext>
          )}
        </div>
      </ScrollArea>
      <SidebarSectionContributions
        contributions={sidebarSection}
        onInvokeAction={onInvokeExtensionAction}
      />
      {richSections}
      <SidebarFooter contributions={sidebarFooter} onInvokeAction={onInvokeExtensionAction} />
    </aside>
  );
}

/* ── Sortable workspace folder ─────────────────────────── */

interface WorkspaceFolderProps {
  readonly workspace: WorkspaceRecord;
  readonly threads?: readonly ThreadListEntry[];
  readonly historyExpanded?: boolean;
  readonly onToggleHistory?: () => void;
  readonly canDrag: boolean;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession?: SessionRecord;
  readonly linkedWorktreeByWorkspaceId: ReadonlyMap<string, WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly threadMenu?: ThreadMenuState;
  readonly onNewThread?: (workspaceId: string) => void;
  readonly onArchiveSession?: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession?: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned?: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}

function SortableWorkspaceFolder(props: WorkspaceFolderProps) {
  const { workspace, wsMenu } = props;
  const isRenaming = wsMenu.workspaceRenameId === workspace.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.id,
    disabled: isRenaming,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`workspace-group ${isDragging ? "workspace-group--dragging" : ""}`}
      data-workspace-id={workspace.id}
    >
      <WorkspaceFolderContent
        {...props}
        dragHandleProps={props.canDrag && !isRenaming ? { attributes, listeners } : undefined}
      />
    </section>
  );
}

interface DragHandleProps {
  readonly attributes: DraggableAttributes;
  readonly listeners: DraggableSyntheticListeners;
}

function WorkspaceFolderContent(
  props: WorkspaceFolderProps & { readonly dragHandleProps?: DragHandleProps },
) {
  const {
    workspace,
    threads,
    historyExpanded = false,
    onToggleHistory,
    selectedWorkspace,
    selectedSession,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    api,
    threadMenu,
    onNewThread,
    onArchiveSession,
    onSelectSession,
    onSetSessionPinned,
    dragHandleProps,
  } = props;
  const history = threads ? threadHistoryPreview(threads, historyExpanded) : undefined;

  const workspaceActive =
    workspace.id === selectedWorkspace?.id || workspace.id === selectedWorkspace?.rootWorkspaceId;
  const linkedWorktree = linkedWorktreeByWorkspaceId.get(workspace.id);

  return (
    <>
      <div className={`workspace-row ${workspaceActive ? "workspace-row--active" : ""}`}>
        <button
          className={`workspace-row__select ${dragHandleProps ? "workspace-row__select--draggable" : ""}`}
          onClick={() => {
            wsMenu.selectWorkspace(workspace.id);
          }}
          type="button"
          {...(dragHandleProps
            ? { ...dragHandleProps.attributes, ...dragHandleProps.listeners }
            : {})}
        >
          <span className="workspace-row__icon" aria-hidden="true">
            <span className="workspace-row__icon-folder">
              <FolderIcon />
            </span>
          </span>
          <span className="workspace-row__name">{workspace.name}</span>
        </button>
        <span className="workspace-row__actions">
          {onNewThread ? (
            <Tooltip disableHoverablePopup>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`New thread in ${workspace.name}`}
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onNewThread(workspace.id)}
                  />
                }
              >
                <PlusIcon />
              </TooltipTrigger>
              <TooltipContent role="tooltip">New thread</TooltipContent>
            </Tooltip>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={`Workspace actions for ${workspace.name}`}
                  variant="ghost"
                  size="icon-sm"
                />
              }
            >
              <MoreIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              aria-label={`Workspace actions for ${workspace.name}`}
              className="w-auto"
              // "Edit name" opens a field; keep focus there instead of on the trigger.
              finalFocus={() => wsMenu.workspaceRenameInputRef.current ?? true}
            >
              <DropdownMenuItem
                onClick={() => {
                  void api.openWorkspaceInFinder(workspace.id).catch((error: unknown) => {
                    console.error("[renderer] openWorkspaceInFinder failed", error);
                  });
                }}
              >
                Open folder
              </DropdownMenuItem>
              {linkedWorktree ? (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() =>
                    wsMenu.removeWorktree(
                      linkedWorktree.rootWorkspaceId || workspace.id,
                      linkedWorktree,
                    )
                  }
                >
                  Remove worktree
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => wsMenu.createWorktree(workspace.id)}>
                  Create permanent worktree
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => wsMenu.startRename(workspace)}>
                Edit name
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => wsMenu.removeWorkspace(workspace)}
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {wsMenu.workspaceRenameId === workspace.id ? (
        <form
          className="workspace-rename"
          ref={wsMenu.workspaceRenamePanelRef}
          onSubmit={(event) => {
            event.preventDefault();
            wsMenu.submitRename(workspace);
          }}
        >
          <Input
            aria-label={`Rename ${workspace.name}`}
            ref={wsMenu.workspaceRenameInputRef}
            value={wsMenu.workspaceRenameDraft}
            onChange={(event) => {
              wsMenu.setWorkspaceRenameDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                wsMenu.cancelRename();
              }
            }}
          />
          <RenameActions onCancel={wsMenu.cancelRename} />
        </form>
      ) : null}
      {history && onSelectSession && onArchiveSession && onSetSessionPinned ? (
        <>
          <div className="session-list session-list--history">
            {history.visible.map((thread) => (
              <HistoryThreadRow
                key={`${thread.workspaceId}:${thread.session.id}`}
                thread={thread}
                selectedWorkspace={selectedWorkspace}
                selectedSession={selectedSession}
                threadMenu={threadMenu}
                onArchiveSession={onArchiveSession}
                onSelectSession={onSelectSession}
                onSetSessionPinned={onSetSessionPinned}
              />
            ))}
          </div>
          {history.overflow && onToggleHistory ? (
            <HistoryToggle
              expanded={historyExpanded}
              label={workspace.name}
              onToggle={onToggleHistory}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function RecencyThreadSectionView({
  section,
  historyExpanded,
  onToggleHistory,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onArchiveSession,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly section: RecencyThreadSection;
  readonly historyExpanded: boolean;
  readonly onToggleHistory: () => void;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}) {
  const history = threadHistoryPreview(section.threads, historyExpanded);
  return (
    <section
      className="recency-thread-group"
      aria-label={section.label}
      data-recency-bucket={section.bucket}
    >
      <div className="recency-thread-group__head">{section.label}</div>
      <div className="session-list session-list--history">
        {history.visible.map((thread) => (
          <HistoryThreadRow
            key={`${thread.workspaceId}:${thread.session.id}`}
            showContext
            thread={thread}
            selectedWorkspace={selectedWorkspace}
            selectedSession={selectedSession}
            threadMenu={threadMenu}
            onArchiveSession={onArchiveSession}
            onSelectSession={onSelectSession}
            onSetSessionPinned={onSetSessionPinned}
          />
        ))}
      </div>
      {history.overflow ? (
        <HistoryToggle
          expanded={historyExpanded}
          label={section.label}
          onToggle={onToggleHistory}
        />
      ) : null}
    </section>
  );
}

function HistoryThreadRow({
  thread,
  showContext = false,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onArchiveSession,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly thread: ThreadListEntry;
  readonly showContext?: boolean;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState | undefined;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}) {
  const active =
    thread.workspaceId === selectedWorkspace?.id && thread.session.id === selectedSession?.id;
  return (
    <ThreadSessionRow
      active={active}
      showContext={showContext}
      thread={thread}
      threadMenu={threadMenu}
      onAction={() =>
        onArchiveSession({
          workspaceId: thread.workspaceId,
          sessionId: thread.session.id,
        })
      }
      onSelect={() =>
        onSelectSession({
          workspaceId: thread.workspaceId,
          sessionId: thread.session.id,
        })
      }
      onTogglePinned={() =>
        onSetSessionPinned(
          { workspaceId: thread.workspaceId, sessionId: thread.session.id },
          !thread.session.pinnedAt,
        )
      }
    />
  );
}

function HistoryToggle({
  expanded,
  label,
  onToggle,
}: {
  readonly expanded: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}) {
  const text = expanded ? "Show less" : "Show more";
  return (
    <Button
      aria-expanded={expanded}
      aria-label={`${text} ${label}`}
      className="thread-history-toggle w-full justify-start pl-6.5"
      variant="ghost"
      size="sm"
      onClick={onToggle}
    >
      {text}
    </Button>
  );
}

function SidebarNavItem({
  active = false,
  icon,
  label,
  testId,
  onClick,
}: {
  readonly active?: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly testId?: string;
  readonly onClick: () => void;
}) {
  return (
    <Button
      aria-current={active ? "page" : undefined}
      className="sidebar__nav-item w-full justify-start"
      data-testid={testId}
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

function RenameActions({ onCancel }: { readonly onCancel: () => void }) {
  return (
    <div className="workspace-rename__actions">
      <Button variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" type="submit">
        Save
      </Button>
    </div>
  );
}

function ThreadGroupingControl({
  grouping,
  onChange,
}: {
  readonly grouping: ThreadGrouping;
  readonly onChange: (grouping: ThreadGrouping) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip disableHoverablePopup>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button aria-label="Customize Sidebar" variant="ghost" size="icon-sm" />}
            />
          }
        >
          <CustomizeSidebarIcon />
        </TooltipTrigger>
        <TooltipContent role="tooltip">Customize Sidebar</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" aria-label="Customize Sidebar">
        <DropdownMenuSub
          onOpenChange={(subOpen, details) => {
            // Escape dismisses the whole menu, not just the Grouping submenu.
            if (!subOpen && details.reason === "escape-key") setOpen(false);
          }}
        >
          <DropdownMenuSubTrigger>Grouping</DropdownMenuSubTrigger>
          <DropdownMenuSubContent aria-label="Grouping">
            <DropdownMenuRadioGroup
              value={grouping}
              onValueChange={(value: ThreadGrouping) => {
                if (value !== grouping) onChange(value);
              }}
            >
              <DropdownMenuRadioItem value="time" closeOnClick>
                Time
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="workspace" closeOnClick>
                Workspace
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ArchivedThreadsSection({
  archivedThreads,
  open,
  onOpenChange,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onUnarchiveSession,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly archivedThreads: readonly ThreadListEntry[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}) {
  return (
    <Collapsible className="archived-thread-group" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        render={
          <Button className="archived-thread-group__toggle w-fit" variant="ghost" size="xs" />
        }
      >
        <span aria-hidden="true" className={cn("flex transition-transform", !open && "-rotate-90")}>
          <ChevronDownIcon />
        </span>
        <span>Archived</span>
        <Badge variant="secondary">{archivedThreads.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="session-list session-list--archived">
        {archivedThreads.map((thread) => {
          const active =
            thread.workspaceId === selectedWorkspace?.id &&
            thread.session.id === selectedSession?.id;
          return (
            <ThreadSessionRow
              key={`${thread.workspaceId}:${thread.session.id}`}
              active={active}
              archived
              thread={thread}
              showContext
              threadMenu={threadMenu}
              onAction={() =>
                onUnarchiveSession({
                  workspaceId: thread.workspaceId,
                  sessionId: thread.session.id,
                })
              }
              onSelect={() =>
                onSelectSession({
                  workspaceId: thread.workspaceId,
                  sessionId: thread.session.id,
                })
              }
              onTogglePinned={() =>
                onSetSessionPinned(
                  { workspaceId: thread.workspaceId, sessionId: thread.session.id },
                  !thread.session.pinnedAt,
                )
              }
            />
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

function PinnedThreadsSection({
  pinnedThreads,
  sortableIds,
  sortableIdForThread,
  selectedWorkspace,
  selectedSession,
  threadMenu,
  onArchiveSession,
  onSelectSession,
  onSetSessionPinned,
}: {
  readonly pinnedThreads: readonly ThreadListEntry[];
  readonly sortableIds: readonly string[];
  readonly sortableIdForThread: (thread: ThreadListEntry) => string;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly threadMenu: ThreadMenuState;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetSessionPinned: (
    target: { workspaceId: string; sessionId: string },
    pinned: boolean,
  ) => void;
}) {
  return (
    <section className="pinned-thread-group" aria-label="Pinned threads">
      <div className="pinned-thread-group__head">
        <PinIcon filled />
        <span>Pinned</span>
      </div>
      <SortableContext items={[...sortableIds]} strategy={verticalListSortingStrategy}>
        <div className="session-list session-list--pinned">
          {pinnedThreads.map((thread) => {
            const active =
              thread.workspaceId === selectedWorkspace?.id &&
              thread.session.id === selectedSession?.id;
            return (
              <SortablePinnedThreadRow
                key={`${thread.workspaceId}:${thread.session.id}`}
                id={sortableIdForThread(thread)}
                active={active}
                thread={thread}
                threadMenu={threadMenu}
                onAction={() =>
                  onArchiveSession({
                    workspaceId: thread.workspaceId,
                    sessionId: thread.session.id,
                  })
                }
                onSelect={() =>
                  onSelectSession({ workspaceId: thread.workspaceId, sessionId: thread.session.id })
                }
                onTogglePinned={() =>
                  onSetSessionPinned(
                    { workspaceId: thread.workspaceId, sessionId: thread.session.id },
                    !thread.session.pinnedAt,
                  )
                }
              />
            );
          })}
        </div>
      </SortableContext>
      <Separator />
    </section>
  );
}

/* ── Thread session row ────────────────────────────────── */

function SortablePinnedThreadRow({
  id,
  active,
  thread,
  threadMenu,
  onAction,
  onSelect,
  onTogglePinned,
}: {
  readonly id: string;
  readonly active: boolean;
  readonly thread: ThreadListEntry;
  readonly threadMenu: ThreadMenuState;
  readonly onAction: () => void;
  readonly onSelect: () => void;
  readonly onTogglePinned: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };
  return (
    <ThreadSessionRow
      ref={setNodeRef}
      style={style}
      active={active}
      thread={thread}
      threadMenu={threadMenu}
      showContext
      dragging={isDragging}
      dragAttributes={attributes}
      dragListeners={listeners}
      onAction={onAction}
      onSelect={onSelect}
      onTogglePinned={onTogglePinned}
    />
  );
}

function sessionIndicatorVariant(
  thread: ThreadListEntry,
): "running" | "failed" | "unseen" | "none" {
  if (thread.session.status === "running") {
    return "running";
  }
  if (thread.session.status === "failed") {
    return "failed";
  }
  if (thread.session.hasUnseenUpdate) {
    return "unseen";
  }
  return "none";
}

interface ThreadSessionRowProps {
  readonly active: boolean;
  readonly archived?: boolean;
  readonly showContext?: boolean;
  readonly overlay?: boolean;
  readonly dragging?: boolean;
  readonly style?: CSSProperties;
  readonly dragAttributes?: DraggableAttributes;
  readonly dragListeners?: DraggableSyntheticListeners;
  readonly thread: ThreadListEntry;
  readonly threadMenu?: ThreadMenuState;
  readonly onAction: () => void;
  readonly onSelect: () => void;
  readonly onTogglePinned: () => void;
}

const ThreadSessionRow = forwardRef<HTMLDivElement, ThreadSessionRowProps>(
  function ThreadSessionRow(
    {
      active,
      archived = false,
      showContext = false,
      overlay = false,
      dragging = false,
      style,
      dragAttributes,
      dragListeners,
      thread,
      threadMenu,
      onAction,
      onSelect,
      onTogglePinned,
    },
    ref,
  ) {
    const indicatorVariant = sessionIndicatorVariant(thread);
    const pinned = Boolean(thread.session.pinnedAt);
    const actionContext = showContext ? ` in ${thread.contextLabel}` : "";
    const shortcut = useContext(ThreadShortcutContext)?.get(sessionThreadKey(thread));
    const shortcutBadge = overlay ? undefined : shortcut;
    const classes = [
      "session-row",
      active ? "session-row--active" : "",
      pinned ? "session-row--pinned" : "",
      dragging ? "session-row--dragging" : "",
      overlay ? "session-row--overlay" : "",
      shortcutBadge ? "session-row--shortcut" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const rowProps = {
      ref,
      style,
      className: classes,
      "data-sidebar-indicator": indicatorVariant,
      "data-session-pinned": pinned ? "true" : "false",
      "data-session-id": thread.session.id,
      "data-thread-shortcut": shortcutBadge ? String(shortcutBadge.slot) : undefined,
      "aria-keyshortcuts": shortcutBadge
        ? `${IS_MAC ? "Meta" : "Control"}+${shortcutBadge.slot}`
        : undefined,
      onClick: () => {
        if (!dragging) onSelect();
      },
    };
    const rowContent = (
      <>
        <button
          className="session-row__select"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          type="button"
          {...dragAttributes}
          {...dragListeners}
        >
          <span className="session-row__leading" aria-hidden="true">
            {indicatorVariant === "running" ? (
              <span className="session-row__status session-row__status--running" />
            ) : null}
            {indicatorVariant === "failed" ? (
              <span className="session-row__status session-row__status--failed" />
            ) : null}
            {indicatorVariant === "unseen" ? (
              <span className="session-row__status session-row__status--unseen" />
            ) : null}
          </span>
          <span className="session-row__body">
            <span className="session-row__title-line">
              <span className="session-row__title">{thread.session.title}</span>
            </span>
            {showContext ? (
              <span className="session-row__context">{thread.contextLabel}</span>
            ) : null}
          </span>
        </button>
        <span className="session-row__trailing">
          {thread.environment.kind === "worktree" ? (
            <span className="session-row__workspace-icon" aria-hidden="true" title="Worktree">
              <WorktreeIcon />
            </span>
          ) : null}
          {shortcutBadge ? (
            <Kbd className="session-row__shortcut" aria-hidden="true">
              {shortcutBadge.label}
            </Kbd>
          ) : (
            <span className="session-row__time">
              {formatRelativeTime(sessionLastInteractedAt(thread.session))}
            </span>
          )}
          <span className="session-row__action-cluster">
            {!archived ? (
              <Button
                aria-label={`${pinned ? "Unpin" : "Pin"} ${thread.session.title}${actionContext}`}
                aria-pressed={pinned}
                className="session-row__action session-row__pin-action"
                variant="ghost"
                size="icon-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePinned();
                }}
              >
                <PinIcon filled={pinned} />
              </Button>
            ) : null}
            <Tooltip disableHoverablePopup>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`${archived ? "Restore" : "Archive"} ${thread.session.title}${actionContext}`}
                    className="session-row__action"
                    variant="ghost"
                    size="icon-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAction();
                    }}
                  />
                }
              >
                {archived ? <RestoreIcon /> : <ArchiveIcon />}
              </TooltipTrigger>
              {threadMenu && !overlay ? (
                <TooltipContent role="tooltip">
                  <span>{archived ? "Restore thread" : "Archive thread"}</span>
                  {archived ? null : <Kbd>{archiveThreadShortcut(threadMenu.platform)}</Kbd>}
                </TooltipContent>
              ) : null}
            </Tooltip>
          </span>
        </span>
      </>
    );
    return (
      <>
        {threadMenu && !overlay ? (
          <ContextMenu>
            <ContextMenuTrigger {...rowProps}>{rowContent}</ContextMenuTrigger>
            <ContextMenuContent
              // "Rename thread" opens a field; keep focus there instead of on the row.
              finalFocus={() => threadMenu.renamePanelRef.current?.querySelector("input") ?? true}
            >
              <SidebarThreadMenuItems thread={thread} threadMenu={threadMenu} />
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          <div {...rowProps}>{rowContent}</div>
        )}
        {threadMenu?.renameSessionId === thread.session.id ? (
          <form
            className="workspace-rename session-rename"
            ref={threadMenu.renamePanelRef}
            onSubmit={(event) => {
              event.preventDefault();
              threadMenu.submitRename(thread);
            }}
          >
            <Input
              aria-label={`Rename thread ${thread.session.title}`}
              // Mounts when a rename starts, including after the sidebar or a
              // collapsed group opens to reveal the row.
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              value={threadMenu.renameDraft}
              onChange={(event) => threadMenu.setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  threadMenu.cancelRename();
                }
              }}
            />
            <RenameActions onCancel={threadMenu.cancelRename} />
          </form>
        ) : null}
      </>
    );
  },
);

/** Builds the action list only while the row's right-click menu is open. */
function SidebarThreadMenuItems({
  thread,
  threadMenu,
}: {
  readonly thread: ThreadListEntry;
  readonly threadMenu: ThreadMenuState;
}) {
  return <ThreadActionContextMenuItems actions={threadMenu.actionsFor(thread)} />;
}

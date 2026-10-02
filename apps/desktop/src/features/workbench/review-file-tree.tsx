import { useEffect, useMemo, useRef, useState } from "react";
import type { ReviewFileEntry, ReviewFileStatus } from "../../../contracts/review";
import { ChevronRightIcon } from "lucide-react";
import { MinusIcon, PlusIcon, SearchIcon } from "../../ui/icons";
import { buildFileTree, filterWorkspaceFiles, type FileTreeNode } from "./file-tree";
import { Button } from "@/ui/shadcn/button";
import { Checkbox } from "@/ui/shadcn/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/shadcn/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/shadcn/input-group";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/ui/shadcn/sidebar";
import { PanelEmpty } from "./panel-empty";
import { TooltipTrigger } from "@/ui/shadcn/tooltip";
import { SharedTooltip, WithTooltip, createSharedTooltip } from "./workbench-tooltip";

interface ReviewFileTreeProps {
  readonly checkoutId: string;
  readonly files: readonly ReviewFileEntry[];
  readonly selectedPath: string | null;
  /** The index moves this comparison allows; empty for read-only comparisons. */
  readonly stageActions: readonly ("stage" | "unstage")[];
  readonly busyFiles: ReadonlySet<string>;
  readonly stale: boolean;
  readonly onSelect: (path: string) => void;
  readonly onToggleReviewed: (file: ReviewFileEntry) => void;
  readonly onStage: (file: ReviewFileEntry, action: "stage" | "unstage") => void;
}

/** The changed files of one comparison as a filterable folder tree, like Codex's Review. */
export function ReviewFileTree({
  checkoutId,
  files,
  selectedPath,
  stageActions,
  busyFiles,
  stale,
  onSelect,
  onToggleReviewed,
  onStage,
}: ReviewFileTreeProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [rowTooltip] = useState(createSharedTooltip);
  const listRef = useRef<HTMLDivElement | null>(null);
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const tree = useMemo(
    () =>
      buildFileTree(
        filterWorkspaceFiles(
          files.map((file) => file.path),
          query,
        ),
      ),
    [files, query],
  );
  const filtering = query.trim() !== "";
  const reviewedCount = files.filter((file) => file.reviewed).length;

  useEffect(() => {
    if (!selectedPath) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [files, selectedPath]);

  const toggleFolder = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (node: FileTreeNode) => {
    if (node.kind === "directory") {
      const open = filtering || !collapsed.has(node.path);
      return (
        <SidebarMenuItem key={`dir:${node.path}`}>
          <Collapsible
            aria-label={node.name}
            className="[&[data-open]>button>svg:first-child]:rotate-90"
            onOpenChange={() => toggleFolder(node.path)}
            open={open}
            role="group"
          >
            <SidebarMenuButton
              render={
                <TooltipTrigger
                  handle={rowTooltip}
                  payload={node.path}
                  render={<CollapsibleTrigger />}
                />
              }
              size="sm"
            >
              <ChevronRightIcon className="transition-transform" />
              <span>{node.name}</span>
            </SidebarMenuButton>
            <CollapsibleContent>
              <SidebarMenuSub className="me-0 translate-x-0 ps-1 pe-0">
                {node.children.map((child) => renderNode(child))}
              </SidebarMenuSub>
            </CollapsibleContent>
          </Collapsible>
        </SidebarMenuItem>
      );
    }
    const file = byPath.get(node.path);
    if (!file) return null;
    const selected = file.path === selectedPath;
    const busy = busyFiles.has(file.id);
    return (
      <SidebarMenuItem
        className={`diff-panel__file review-tree__file${selected ? " diff-panel__file--selected" : ""}${file.reviewed ? " diff-panel__file--reviewed" : ""}`}
        key={file.id}
        data-workspace-id={checkoutId}
        data-file-path={file.path}
      >
        <SidebarMenuButton
          aria-current={selected ? "true" : undefined}
          className="diff-panel__file-name min-w-0 flex-1"
          isActive={selected}
          onClick={() => onSelect(file.path)}
          render={<TooltipTrigger handle={rowTooltip} payload={formatPathForDisplay(file.path)} />}
          size="sm"
        >
          <span className="diff-panel__file-path">{formatPathForDisplay(node.name)}</span>
        </SidebarMenuButton>
        {stageActions.length ? (
          <span className="review-panel__stage-actions">
            {file.hasStagedChanges && stageActions.includes("unstage") ? (
              <WithTooltip label="Unstage file">
                <Button
                  aria-label="Unstage"
                  disabled={busy || stale || file.conflicted}
                  onClick={() => onStage(file, "unstage")}
                  size="icon-xs"
                  variant="ghost"
                >
                  <MinusIcon />
                </Button>
              </WithTooltip>
            ) : null}
            {file.hasUnstagedChanges && stageActions.includes("stage") ? (
              <WithTooltip label="Stage file">
                <Button
                  aria-label="Stage"
                  disabled={busy || stale || file.conflicted}
                  onClick={() => onStage(file, "stage")}
                  size="icon-xs"
                  variant="ghost"
                >
                  <PlusIcon />
                </Button>
              </WithTooltip>
            ) : null}
          </span>
        ) : null}
        <Checkbox
          aria-label={`Mark ${file.path} reviewed`}
          checked={file.reviewed}
          className="mx-1"
          data-testid={`diff-panel-reviewed-${file.path}`}
          disabled={busy || stale}
          onCheckedChange={() => onToggleReviewed(file)}
        />
        <TooltipTrigger
          handle={rowTooltip}
          payload={file.conflicted ? "Conflicted" : file.status}
          render={
            <span
              className={`review-tree__status review-tree__status--${file.conflicted ? "conflicted" : file.status}`}
            />
          }
        >
          {statusLetter(file.conflicted ? "conflicted" : file.status)}
        </TooltipTrigger>
      </SidebarMenuItem>
    );
  };

  return (
    <section className="review-tree" aria-label="Changed files">
      <div className="review-tree__header">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Filter changed files"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter files…"
            value={query}
          />
        </InputGroup>
        <span className="review-tree__counter" data-testid="diff-panel-counter">
          Reviewed {reviewedCount} of {files.length}
        </span>
      </div>
      <div className="review-tree__list diff-panel__file-list" ref={listRef}>
        {tree.length ? (
          <SidebarMenu>
            <SharedTooltip handle={rowTooltip} />
            {tree.map((node) => renderNode(node))}
          </SidebarMenu>
        ) : (
          <PanelEmpty title="No files match." />
        )}
      </div>
    </section>
  );
}

/** Files in the order the tree shows them, so the diff can open the first visible file. */
export function reviewTreeOrder(files: readonly ReviewFileEntry[]): readonly string[] {
  const order: string[] = [];
  const walk = (nodes: readonly FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "file") order.push(node.path);
      else walk(node.children);
    }
  };
  walk(buildFileTree(files.map((file) => file.path)));
  return order;
}

function statusLetter(status: ReviewFileStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "copied":
      return "C";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    case "conflicted":
      return "!";
    case "typechanged":
      return "T";
    case "modified":
      return "M";
  }
}

/**
 * Plain paths read as-is. Paths whose edges or characters would be invisible or
 * ambiguous (surrounding whitespace, control characters, a leading or trailing
 * quote) are shown JSON-quoted so they cannot be confused with another path.
 */
export function formatPathForDisplay(path: string): string {
  const ambiguous =
    /^[\s"]|[\s"]$/.test(path) ||
    [...path].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
  return ambiguous ? JSON.stringify(path) : path;
}

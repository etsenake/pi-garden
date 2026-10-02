import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { FileIcon, FolderIcon, RefreshIcon, SearchIcon } from "../../ui/icons";
import { Button } from "@/ui/shadcn/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/shadcn/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/shadcn/input-group";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/ui/shadcn/sidebar";
import { PanelEmpty } from "./panel-empty";
import { WithTooltip } from "./workbench-tooltip";
import { ancestorDirectoryPaths } from "./file-workbench-state";
import { buildFileTree, filterWorkspaceFiles, type FileTreeNode } from "./file-tree";

interface FileExplorerProps {
  readonly files: readonly string[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
  readonly onRefresh: () => void;
}

export function FileExplorer({
  files,
  loading,
  error,
  selectedPath,
  onSelect,
  onRefresh,
}: FileExplorerProps) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const filterActive = filter.trim().length > 0;
  const visibleFiles = useMemo(
    () => (files ? filterWorkspaceFiles(files, filter) : []),
    [files, filter],
  );
  const tree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    setExpanded((current) => {
      const next = new Set(current);
      let changed = false;
      for (const directory of ancestorDirectoryPaths(selectedPath)) {
        if (!next.has(directory)) {
          next.add(directory);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [selectedPath]);

  const emptyCopy = error
    ? error
    : files === null
      ? "Loading files..."
      : files.length === 0
        ? "No indexed files"
        : visibleFiles.length === 0
          ? "No matching files"
          : null;

  return (
    <section className="file-explorer" data-testid="file-explorer" aria-label="File explorer">
      <div className="file-explorer__toolbar">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Filter files"
            data-testid="file-workbench-filter"
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter files…"
            type="search"
            value={filter}
          />
        </InputGroup>
        <WithTooltip label="Refresh files">
          <Button
            aria-label="Refresh"
            disabled={loading}
            onClick={onRefresh}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshIcon />
          </Button>
        </WithTooltip>
      </div>
      {emptyCopy ? (
        <PanelEmpty loading={files === null && !error} title={emptyCopy} />
      ) : (
        <SidebarMenu className="file-workbench__tree" data-testid="file-workbench-tree">
          {tree.map((node) => (
            <FileTreeRow
              key={node.path || node.name}
              expandAll={filterActive}
              expanded={expanded}
              node={node}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onToggleDirectory={(path) => {
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(path)) {
                    next.delete(path);
                  } else {
                    next.add(path);
                  }
                  return next;
                });
              }}
            />
          ))}
        </SidebarMenu>
      )}
    </section>
  );
}

function FileTreeRow({
  node,
  expandAll,
  expanded,
  selectedPath,
  onSelect,
  onToggleDirectory,
}: {
  readonly node: FileTreeNode;
  readonly expandAll: boolean;
  readonly expanded: ReadonlySet<string>;
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
  readonly onToggleDirectory: (path: string) => void;
}) {
  if (node.kind === "directory") {
    const isExpanded = expandAll || expanded.has(node.path);
    return (
      <SidebarMenuItem>
        <Collapsible
          className="[&[data-open]>button>svg:first-child]:rotate-90"
          onOpenChange={() => onToggleDirectory(node.path)}
          open={isExpanded}
        >
          <SidebarMenuButton
            className="file-workbench__tree-row file-workbench__tree-row--dir"
            render={<CollapsibleTrigger />}
            title={node.path}
          >
            <ChevronRightIcon className="transition-transform" />
            <FolderIcon />
            <span>{node.name}</span>
          </SidebarMenuButton>
          <CollapsibleContent>
            <SidebarMenuSub className="me-0 translate-x-0 ps-1 pe-0">
              {node.children.map((child) => (
                <FileTreeRow
                  key={child.path || child.name}
                  expandAll={expandAll}
                  expanded={expanded}
                  node={child}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  onToggleDirectory={onToggleDirectory}
                />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    );
  }

  return (
    <FileTreeFileRow
      name={node.name}
      path={node.path}
      selected={selectedPath === node.path}
      onSelect={onSelect}
    />
  );
}

function FileTreeFileRow({
  name,
  path,
  selected,
  onSelect,
}: {
  readonly name: string;
  readonly path: string;
  readonly selected: boolean;
  readonly onSelect: (path: string) => void;
}) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selected && rowRef.current) {
      scrollIntoContainer(rowRef.current, ".file-workbench__tree");
    }
  }, [selected]);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className={`file-workbench__tree-row file-workbench__tree-row--file${selected ? " file-workbench__tree-row--selected" : ""}`}
        data-file-path={path}
        isActive={selected}
        onClick={() => onSelect(path)}
        ref={rowRef}
        title={path}
      >
        <FileIcon />
        <span>{name}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function scrollIntoContainer(element: HTMLElement, containerSelector: string): void {
  const container = element.closest(containerSelector);
  if (!(container instanceof HTMLElement)) {
    return;
  }
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
    return;
  }
  const top =
    container.scrollTop +
    (elementRect.top - containerRect.top) -
    container.clientHeight / 2 +
    elementRect.height / 2;
  container.scrollTop = Math.max(0, top);
}

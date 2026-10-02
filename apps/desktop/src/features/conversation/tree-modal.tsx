import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  NavigateSessionTreeOptions,
  SessionTreeNodeKind,
  SessionTreeNodeSnapshot,
  SessionTreeSnapshot,
} from "@pi-garden/session-driver/types";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon } from "../../ui/icons";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/ui/shadcn/alert";
import { Button } from "@/ui/shadcn/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/ui/shadcn/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/ui/shadcn/field";
import { RadioGroup, RadioGroupItem } from "@/ui/shadcn/radio-group";
import { Spinner } from "@/ui/shadcn/spinner";
import { Textarea } from "@/ui/shadcn/textarea";

interface TreeModalProps {
  readonly tree?: SessionTreeSnapshot;
  readonly loading: boolean;
  readonly submitting: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onNavigate: (targetId: string, options?: NavigateSessionTreeOptions) => void;
}

interface GutterInfo {
  readonly position: number;
  readonly show: boolean;
}

/** The modal's nested view of the flat snapshot; it never crosses the preload bridge. */
interface TreeNode extends SessionTreeNodeSnapshot {
  readonly children: readonly TreeNode[];
}

interface TreeRow {
  readonly node: TreeNode;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly displayIndent: number;
  readonly showConnector: boolean;
  readonly isLast: boolean;
  readonly isVirtualRootChild: boolean;
  readonly gutters: readonly GutterInfo[];
  readonly isOnActivePath: boolean;
}

type TreeSummaryMode = "none" | "summary" | "custom";

const DEFAULT_HIDDEN_KINDS: ReadonlySet<SessionTreeNodeKind> = new Set([
  "label",
  "custom",
  "model_change",
  "thinking_level_change",
  "session_info",
  "usage",
  "context_edit",
]);

export function TreeModal({
  tree,
  loading,
  submitting,
  error,
  onClose,
  onNavigate,
}: TreeModalProps) {
  const [step, setStep] = useState<"select" | "summary">("select");
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string>("");
  const [summaryMode, setSummaryMode] = useState<TreeSummaryMode>("none");
  const [customInstructions, setCustomInstructions] = useState("");
  const [autoScrollRequest, setAutoScrollRequest] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const customInstructionsRef = useRef<HTMLTextAreaElement | null>(null);
  const summaryConfirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!tree) {
      return;
    }
    setStep("select");
    setSearch("");
    setExpandedIds(createInitialExpandedState(tree.nodes));
    setSelectedId(tree.leafId ?? tree.nodes[0]?.id ?? "");
    setSummaryMode("none");
    setCustomInstructions("");
    setAutoScrollRequest((value) => value + 1);
  }, [tree]);

  useLayoutEffect(() => {
    if (step === "select") {
      if (loading || !tree) {
        return;
      }
      searchRef.current?.focus();
      return;
    }
    if (summaryMode === "custom") {
      customInstructionsRef.current?.focus();
      return;
    }
    summaryConfirmRef.current?.focus();
  }, [loading, step, summaryMode, tree]);

  useLayoutEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      const target = event.target;
      if (!dialog || !(target instanceof Element) || dialog.contains(target)) {
        return;
      }
      // A dialog that opens over this one owns focus until it closes.
      if (target.closest("[role='dialog'], [role='alertdialog']")) {
        return;
      }

      // The dialog traps keyboard focus; this also contains delayed programmatic focus.
      if (step === "select" && !loading && tree && searchRef.current) {
        searchRef.current.focus();
        return;
      }
      if (step === "summary" && summaryMode === "custom" && customInstructionsRef.current) {
        customInstructionsRef.current.focus();
        return;
      }
      summaryConfirmRef.current?.focus();
      if (!dialog.contains(document.activeElement)) {
        dialog.focus();
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [loading, step, summaryMode, tree]);

  const displayRows = useMemo(
    () => (tree ? buildVisibleRows(tree.nodes, expandedIds, search, tree.leafId) : []),
    [expandedIds, search, tree],
  );
  const selectedRow = displayRows.find((row) => row.node.id === selectedId);
  const currentLeafId = tree?.leafId ?? null;
  const currentLeafSelected = selectedId !== "" && selectedId === currentLeafId;
  const searching = search.trim().length > 0;

  const cancelAutoScroll = () => {
    if (autoScrollRequest !== 0) {
      setAutoScrollRequest(0);
    }
  };

  useEffect(() => {
    if (displayRows.length === 0) {
      setSelectedId("");
      return;
    }
    if (!displayRows.some((row) => row.node.id === selectedId)) {
      setSelectedId(displayRows[0]?.node.id ?? "");
    }
  }, [displayRows, selectedId]);

  useLayoutEffect(() => {
    if (autoScrollRequest === 0 || step !== "select") {
      return;
    }
    const scrollToBottom = () => {
      const listElement = listRef.current;
      if (!listElement) {
        return;
      }
      listElement.scrollTop = Math.max(0, listElement.scrollHeight - listElement.clientHeight);
    };
    scrollToBottom();
    let attempts = 0;
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
    });
    const interval = window.setInterval(() => {
      scrollToBottom();
      attempts += 1;
      if (attempts >= 8) {
        window.clearInterval(interval);
      }
    }, 30);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [autoScrollRequest, displayRows, step]);

  // The command list moves the selection with the arrow keys; branches fold on left/right,
  // and Enter continues instead of selecting.
  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      cancelAutoScroll();
      return;
    }
    if (
      event.key === "ArrowLeft" &&
      !searching &&
      selectedRow?.hasChildren &&
      selectedRow.expanded
    ) {
      event.preventDefault();
      cancelAutoScroll();
      setExpandedIds((current) => ({ ...current, [selectedRow.node.id]: false }));
      return;
    }
    if (
      event.key === "ArrowRight" &&
      !searching &&
      selectedRow?.hasChildren &&
      !selectedRow.expanded
    ) {
      event.preventDefault();
      cancelAutoScroll();
      setExpandedIds((current) => ({ ...current, [selectedRow.node.id]: true }));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!currentLeafSelected && selectedId) {
        setStep("summary");
      }
    }
  };

  const handleOpenChange = (open: boolean, details: { readonly reason: string }) => {
    if (open || submitting) {
      return;
    }
    if (step === "summary") {
      // Escape steps back; only the select step closes on an outside click.
      if (details.reason !== "outside-press") setStep("select");
      return;
    }
    onClose();
  };

  const handleToggleExpanded = (nodeId: string) => {
    cancelAutoScroll();
    setExpandedIds((current) => ({ ...current, [nodeId]: !current[nodeId] }));
  };

  const handleSubmit = () => {
    if (!selectedId || submitting) {
      return;
    }
    if (summaryMode === "custom" && customInstructions.trim().length === 0) {
      return;
    }

    onNavigate(selectedId, {
      summarize: summaryMode !== "none",
      ...(summaryMode === "custom" ? { customInstructions: customInstructions.trim() } : {}),
    });
  };

  const setListElement = (node: HTMLDivElement | null) => {
    listRef.current = node;
    if (!node || autoScrollRequest === 0 || step !== "select") {
      return;
    }
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      {/* The app returns focus to the composer or the topmost remaining dialog. */}
      <DialogContent
        className="max-h-[calc(100vh-3rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-4xl"
        data-testid="tree-modal"
        finalFocus={false}
        initialFocus={() => searchRef.current ?? true}
        ref={dialogRef}
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <DialogTitle>{step === "summary" ? "Switch branch" : "Browse branches"}</DialogTitle>
            <DialogDescription>
              {step === "summary"
                ? "You're leaving the current branch. Choose whether pi should summarize the abandoned path before switching."
                : searching
                  ? "Search expands matching branches."
                  : currentLeafId
                    ? "Tree opens at the most recent entries."
                    : "Select a node to branch from it."}
            </DialogDescription>
          </div>
          <Button
            aria-label="Close tree modal"
            disabled={submitting}
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              if (step === "summary") {
                setStep("select");
                return;
              }
              onClose();
            }}
          >
            <CloseIcon />
          </Button>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4">
          {error ? (
            <Alert data-testid="tree-modal-error" variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div
              className="flex items-center justify-center gap-2 py-7 text-muted-foreground"
              data-testid="tree-modal-loading"
            >
              <Spinner />
              Loading session tree…
            </div>
          ) : null}

          {!loading && tree && step === "select" ? (
            <>
              <Command
                className="min-h-0"
                disablePointerSelection
                label="Session tree entries"
                shouldFilter={false}
                value={selectedId}
                onKeyDown={handleListKeyDown}
                onValueChange={setSelectedId}
              >
                <CommandInput
                  aria-label="Search session tree"
                  autoFocus
                  data-testid="tree-modal-search"
                  placeholder="Search visible tree entries"
                  ref={searchRef}
                  value={search}
                  onValueChange={(value) => {
                    cancelAutoScroll();
                    setSearch(value);
                  }}
                />
                <CommandList
                  className="mt-1 max-h-[min(420px,54vh)] min-h-80"
                  data-testid="tree-modal-list"
                  ref={setListElement}
                >
                  <CommandEmpty>No matching nodes.</CommandEmpty>
                  {displayRows.map((row) => (
                    <TreeRowItem
                      currentLeafId={currentLeafId}
                      key={row.node.id}
                      row={row}
                      searching={searching}
                      onDoubleClick={() => {
                        cancelAutoScroll();
                        setSelectedId(row.node.id);
                        if (row.node.id !== currentLeafId) {
                          setStep("summary");
                        }
                      }}
                      onSelect={() => {
                        cancelAutoScroll();
                        setSelectedId(row.node.id);
                      }}
                      onToggleExpanded={handleToggleExpanded}
                    />
                  ))}
                </CommandList>
              </Command>

              <DialogFooter className="items-center sm:justify-between">
                <p className="text-muted-foreground">
                  Selecting a user prompt reopens it in the composer. Selecting any other node jumps
                  directly there.
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    disabled={!selectedId || currentLeafSelected}
                    onClick={() => setStep("summary")}
                  >
                    {currentLeafSelected ? "Already here" : "Continue"}
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : null}

          {!loading && tree && step === "summary" ? (
            <div className="flex flex-col gap-4" data-testid="tree-summary-step">
              <RadioGroup
                aria-label="Branch summary"
                value={summaryMode}
                onValueChange={(value) => setSummaryMode(value as TreeSummaryMode)}
              >
                {SUMMARY_OPTIONS.map((option) => (
                  <FieldLabel htmlFor={`tree-summary-${option.mode}`} key={option.mode}>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle id={`tree-summary-${option.mode}-title`}>
                          {option.title}
                        </FieldTitle>
                        <FieldDescription id={`tree-summary-${option.mode}-description`}>
                          {option.description}
                        </FieldDescription>
                      </FieldContent>
                      <RadioGroupItem
                        aria-describedby={`tree-summary-${option.mode}-description`}
                        aria-labelledby={`tree-summary-${option.mode}-title`}
                        id={`tree-summary-${option.mode}`}
                        value={option.mode}
                      />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>

              {summaryMode === "custom" ? (
                <Textarea
                  aria-label="Custom summary instructions"
                  autoFocus
                  className="min-h-28"
                  placeholder="Focus the summary on decisions, changed files, and unresolved risks."
                  ref={customInstructionsRef}
                  value={customInstructions}
                  onChange={(event) => setCustomInstructions(event.target.value)}
                />
              ) : null}

              <DialogFooter className="items-center sm:justify-between">
                <p className="text-muted-foreground">
                  {submitting
                    ? "Switching branches…"
                    : summaryMode === "none"
                      ? "The current branch will be left as-is."
                      : "The summary will be attached to the branch you switch to."}
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button disabled={submitting} variant="outline" onClick={() => setStep("select")}>
                    Back
                  </Button>
                  <Button
                    disabled={
                      submitting ||
                      !selectedId ||
                      (summaryMode === "custom" && customInstructions.trim().length === 0)
                    }
                    ref={summaryConfirmRef}
                    onClick={handleSubmit}
                  >
                    {submitting ? <Spinner data-icon="inline-start" /> : null}
                    {submitting ? "Switching…" : "Switch branch"}
                  </Button>
                </div>
              </DialogFooter>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SUMMARY_OPTIONS: readonly {
  readonly mode: TreeSummaryMode;
  readonly title: string;
  readonly description: string;
}[] = [
  { mode: "none", title: "No summary", description: "Jump immediately with no branch summary." },
  {
    mode: "summary",
    title: "Summarize",
    description: "Generate a branch summary before switching.",
  },
  {
    mode: "custom",
    title: "Summarize with custom prompt",
    description: "Provide extra instructions for the summary.",
  },
];

function TreeRowItem({
  row,
  currentLeafId,
  searching,
  onSelect,
  onDoubleClick,
  onToggleExpanded,
}: {
  readonly row: TreeRow;
  readonly currentLeafId: string | null;
  readonly searching: boolean;
  readonly onSelect: () => void;
  readonly onDoubleClick: () => void;
  readonly onToggleExpanded: (nodeId: string) => void;
}) {
  const line = buildTreeRowLine(row, currentLeafId);
  return (
    <CommandItem
      className="items-start py-0.5 pl-0.5"
      data-testid={`tree-row-${row.node.id}`}
      value={row.node.id}
      onDoubleClick={onDoubleClick}
      onSelect={onSelect}
    >
      <Button
        aria-label={row.expanded ? "Collapse branch" : "Expand branch"}
        className={row.hasChildren ? undefined : "invisible"}
        disabled={searching || !row.hasChildren}
        size="icon-xs"
        tabIndex={-1}
        variant="ghost"
        onClick={(event) => {
          // Folding a branch leaves the selection where it is.
          event.stopPropagation();
          onToggleExpanded(row.node.id);
        }}
      >
        {row.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
      </Button>
      <span className="min-w-0 flex-1 py-0.5 font-mono break-words whitespace-pre-wrap">
        {line}
      </span>
    </CommandItem>
  );
}

function createInitialExpandedState(
  nodes: readonly SessionTreeNodeSnapshot[],
): Record<string, boolean> {
  const expanded: Record<string, boolean> = {};
  for (const node of nodes) {
    if (node.parentId !== null) {
      expanded[node.parentId] = true;
    }
  }
  return expanded;
}

function buildVisibleRows(
  nodes: readonly SessionTreeNodeSnapshot[],
  expandedIds: Readonly<Record<string, boolean>>,
  search: string,
  currentLeafId: string | null,
): readonly TreeRow[] {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const { roots, activePathIds } = buildDisplayTree(nodes, currentLeafId, tokens);
  return flattenTreeRows(roots, currentLeafId, activePathIds, expandedIds, tokens.length > 0);
}

/**
 * Builds the nested tree the modal shows: hidden and non-matching nodes are dropped (their
 * shown descendants move up to the nearest shown ancestor), and siblings leading to the
 * current leaf sort first. Loops rather than recursion, since one path can be thousands of
 * entries deep.
 */
function buildDisplayTree(
  nodes: readonly SessionTreeNodeSnapshot[],
  currentLeafId: string | null,
  searchTokens: readonly string[],
): { readonly roots: readonly TreeNode[]; readonly activePathIds: ReadonlySet<string> } {
  const ids = new Set(nodes.map((node) => node.id));
  const shownChildren = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  const activePathIds = new Set<string>();
  const leadsToLeaf = (node: TreeNode) => activePathIds.has(node.id);

  // Children follow their parent in the snapshot, so walking it backwards finishes every
  // child before its parent. Lists fill in reverse and flip once their owner is reached.
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    const children = (shownChildren.get(node.id) ?? []).reverse();
    children.sort((left, right) => Number(leadsToLeaf(right)) - Number(leadsToLeaf(left)));

    let shown: readonly TreeNode[] = children;
    const matches = searchTokens.length === 0 || matchesTreeSearch(node, searchTokens);
    if (shouldShowNodeInView(node) && (matches || children.length > 0)) {
      if (node.id === currentLeafId || children.some(leadsToLeaf)) {
        activePathIds.add(node.id);
      }
      shown = [{ ...node, children }];
    }

    const parentId = node.parentId;
    let siblings = roots;
    if (parentId !== null && parentId !== node.id && ids.has(parentId)) {
      siblings = shownChildren.get(parentId) ?? [];
      shownChildren.set(parentId, siblings);
    }
    for (let shownIndex = shown.length - 1; shownIndex >= 0; shownIndex -= 1) {
      siblings.push(shown[shownIndex]!);
    }
  }

  roots.reverse();
  roots.sort((left, right) => Number(leadsToLeaf(right)) - Number(leadsToLeaf(left)));
  return { roots, activePathIds };
}

function shouldShowNodeInView(node: SessionTreeNodeSnapshot): boolean {
  if (DEFAULT_HIDDEN_KINDS.has(node.kind)) {
    return false;
  }
  if (node.kind === "message" && node.role === "assistant" && !hasVisiblePreview(node.preview)) {
    return false;
  }
  return true;
}

function hasVisiblePreview(preview: string | undefined): boolean {
  return typeof preview === "string" && preview.trim().length > 0;
}

function matchesTreeSearch(node: SessionTreeNodeSnapshot, tokens: readonly string[]): boolean {
  const text = nodeSearchText(node);
  return tokens.every((token) => text.includes(token));
}

function flattenTreeRows(
  roots: readonly TreeNode[],
  currentLeafId: string | null,
  activePathIds: ReadonlySet<string>,
  expandedIds: Readonly<Record<string, boolean>>,
  expandAll: boolean,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const multipleRoots = roots.length > 1;
  type StackItem = readonly [
    node: TreeNode,
    indent: number,
    justBranched: boolean,
    showConnector: boolean,
    isLast: boolean,
    gutters: readonly GutterInfo[],
    isVirtualRootChild: boolean,
  ];
  const stack: StackItem[] = [];

  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const isLast = index === roots.length - 1;
    const root = roots[index];
    if (!root) {
      continue;
    }
    stack.push([
      root,
      multipleRoots ? 1 : 0,
      multipleRoots,
      multipleRoots,
      isLast,
      [],
      multipleRoots,
    ]);
  }

  while (stack.length > 0) {
    const [node, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] =
      stack.pop()!;
    const children = node.children;
    const multipleChildren = children.length > 1;
    const expanded = expandAll || children.length === 0 || expandedIds[node.id] !== false;
    const displayIndent = multipleRoots ? Math.max(0, indent - 1) : indent;

    rows.push({
      node,
      hasChildren: children.length > 0,
      expanded,
      displayIndent,
      showConnector,
      isLast,
      isVirtualRootChild,
      gutters,
      isOnActivePath: activePathIds.has(node.id),
    });

    if (!expanded || children.length === 0) {
      continue;
    }

    let childIndent: number;
    if (multipleChildren) {
      childIndent = indent + 1;
    } else if (justBranched && indent > 0) {
      childIndent = indent + 1;
    } else {
      childIndent = indent;
    }

    const connectorDisplayed = showConnector && !isVirtualRootChild;
    const connectorPosition = Math.max(0, displayIndent - 1);
    const childGutters: readonly GutterInfo[] = connectorDisplayed
      ? [...gutters, { position: connectorPosition, show: !isLast }]
      : gutters;

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const childIsLast = index === children.length - 1;
      const child = children[index];
      if (!child) {
        continue;
      }
      stack.push([
        child,
        childIndent,
        multipleChildren,
        multipleChildren,
        childIsLast,
        childGutters,
        false,
      ]);
    }
  }

  return rows;
}

function buildTreeRowLine(row: TreeRow, currentLeafId: string | null): string {
  const prefix = buildTreePrefix(row);
  const pathMarker = row.node.id === currentLeafId ? "• " : row.isOnActivePath ? "· " : "  ";
  const label = row.node.label ? `[${row.node.label}] ` : "";
  const current = row.node.id === currentLeafId ? "  ← current" : "";
  return `${prefix}${pathMarker}${label}${formatTreeNodeDisplayText(row.node)}${current}`;
}

function buildTreePrefix(row: TreeRow): string {
  const chars: string[] = [];
  const connector =
    row.showConnector && !row.isVirtualRootChild ? (row.isLast ? "└─ " : "├─ ") : "";
  const connectorPosition = connector ? row.displayIndent - 1 : -1;
  const totalChars = row.displayIndent * 3;

  for (let index = 0; index < totalChars; index += 1) {
    const level = Math.floor(index / 3);
    const positionInLevel = index % 3;
    const gutter = row.gutters.find((entry) => entry.position === level);
    if (gutter) {
      chars.push(positionInLevel === 0 ? (gutter.show ? "│" : " ") : " ");
      continue;
    }
    if (connector && level === connectorPosition) {
      if (positionInLevel === 0) {
        chars.push(row.isLast ? "└" : "├");
      } else if (positionInLevel === 1) {
        chars.push(row.expanded ? "─" : "⊞");
      } else {
        chars.push(" ");
      }
      continue;
    }
    chars.push(" ");
  }

  return chars.join("");
}

function formatTreeNodeDisplayText(node: SessionTreeNodeSnapshot): string {
  switch (node.kind) {
    case "message":
      switch (node.role) {
        case "user":
          return `user: ${node.preview ?? "(empty)"}`;
        case "assistant":
          return `assistant: ${node.preview ?? "(no content)"}`;
        case "toolResult":
          return node.preview ?? "[tool]";
        case "bashExecution":
          return `[bash]: ${node.preview ?? "(no command)"}`;
        case "branchSummary":
          return `[branch summary]: ${node.preview ?? "(empty)"}`;
        case "compactionSummary":
          return `[compaction]: ${node.preview ?? "(empty)"}`;
        default:
          return `[${node.role ?? "message"}]${node.preview ? ` ${node.preview}` : ""}`;
      }
    case "custom_message":
      return `[${node.customType ?? "custom"}]: ${node.preview ?? "(empty)"}`;
    case "compaction":
      return `[compaction: ${node.preview ?? "summary"}]`;
    case "branch_summary":
      return `[branch summary]: ${node.preview ?? "(empty)"}`;
    default:
      return node.preview ? `${node.title}: ${node.preview}` : node.title;
  }
}

function nodeSearchText(node: SessionTreeNodeSnapshot): string {
  return [
    node.title,
    node.preview,
    node.label,
    node.role,
    node.customType,
    formatTreeNodeDisplayText(node),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

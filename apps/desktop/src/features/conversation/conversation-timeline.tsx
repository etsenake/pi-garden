import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { TranscriptMessage } from "../../../contracts/desktop-state";
import type { DisplayTimelineItem } from "../../../contracts/timeline-types";
import type { ScheduledTaskOrigin } from "../../../contracts/scheduled-tasks";
import type { TimelineViewport } from "./hooks/use-timeline-viewport";
import type { AnnotationMarker, OpenAnnotation } from "./annotations/annotation-markers";
import { useAnnotationSelection } from "./annotations/annotation-selection";
import type { TranscriptAnnotations } from "./annotations/use-transcript-annotations";
import { ThreadSearchBar } from "./thread-search";
import type { RichToolHost } from "../extensions/rich-surface-slots";
import {
  DEFAULT_TIMELINE_EXTENSION_UI,
  TimelineItem,
  type TimelineExtensionUi,
} from "./timeline-item";
import type { OpenTurnChange } from "./turn-changes-card";
import type { WorkspaceFileLine } from "./workspace-file-line";
import { SparkIcon } from "../../ui/icons";
import { Button } from "@/ui/shadcn/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/ui/shadcn/message-scroller";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/shadcn/empty";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { Spinner } from "@/ui/shadcn/spinner";

interface ThreadSearchModel {
  readonly isOpen: boolean;
  readonly query: string;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly search: (query: string) => void;
  readonly goToMatch: (direction: 1 | -1) => void;
  readonly close: () => void;
}
interface ConversationTimelineProps {
  readonly transcript: readonly TranscriptMessage[];
  readonly isTranscriptLoading: boolean;
  readonly transcriptFailed?: { readonly retrying: boolean } | null;
  readonly onRetryTranscript?: () => void;
  readonly viewport: TimelineViewport;
  readonly threadSearch: ThreadSearchModel;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onOpenTurnChange?: OpenTurnChange;
  readonly onForkFromMessage?: (messageIndex: number, preview?: string) => void;
  readonly onOpenWorkspaceFileLine?: (target: WorkspaceFileLine) => void;
  readonly scheduledOrigins?: ReadonlyMap<string, ScheduledTaskOrigin>;
  readonly workspacePath?: string;
  readonly annotations?: TranscriptAnnotations;
  readonly platform: NodeJS.Platform;
  /** Pi extension UI state for this session; Pi's defaults when absent. */
  readonly extensionUi?: TimelineExtensionUi;
  readonly richTools?: RichToolHost;
}
const NO_MARKERS: readonly AnnotationMarker[] = [];
export function ConversationTimeline({
  transcript,
  isTranscriptLoading,
  transcriptFailed = null,
  onRetryTranscript,
  viewport,
  threadSearch,
  onViewFileInDiff,
  onOpenTurnChange,
  onForkFromMessage,
  onOpenWorkspaceFileLine,
  scheduledOrigins,
  workspacePath,
  annotations,
  platform,
  extensionUi = DEFAULT_TIMELINE_EXTENSION_UI,
  richTools,
}: ConversationTimelineProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const annotationSelection = useAnnotationSelection({
    paneRef: surfaceRef,
    annotations,
    platform,
  });
  const annotationList = annotations?.list;
  // Keyed by every id an annotation knows its message by: a row keeps its live id after it
  // is saved, and a reload shows it by its saved id.
  const markersByMessage = useMemo(() => {
    const markers = new Map<string, AnnotationMarker[]>();
    annotationList?.forEach(({ id, messageIds, start, end, anchorText }, index) => {
      const entry = { id, number: index + 1, start, end, anchorText };
      for (const messageId of messageIds) {
        markers.set(messageId, [...(markers.get(messageId) ?? []), entry]);
      }
    });
    return markers;
  }, [annotationList]);
  // Pi's `setToolsExpanded` is the session default; a row the user clicks
  // flips away from it. A new default (an extension toggling) wins over
  // earlier clicks, exactly like Pi re-rendering every tool row.
  const toolsExpanded = extensionUi.toolsExpanded;
  const [toggledToolCallIds, setToggledToolCallIds] = useState<Set<string>>(() => new Set());
  const toggleToolCall = useCallback(
    (id: string) =>
      setToggledToolCallIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  useLayoutEffect(() => {
    setToggledToolCallIds((current) => (current.size === 0 ? current : new Set()));
  }, [toolsExpanded]);
  useLayoutEffect(() => {
    const available = new Set(
      transcript.filter((item) => item.kind === "tool").map((item) => item.callId),
    );
    setToggledToolCallIds((current) => {
      if ([...current].every((id) => available.has(id))) return current;
      return new Set([...current].filter((id) => available.has(id)));
    });
  }, [transcript]);
  const renderedMessageIndexById = useMemo(() => {
    const indices = new Map<string, number>();
    let index = 0;
    for (const item of transcript) if (item.kind === "message") indices.set(item.id, index++);
    return indices;
  }, [transcript]);
  return (
    <div className="timeline-surface" ref={surfaceRef}>
      <div className="timeline-column">
        {threadSearch.isOpen ? (
          <ThreadSearchBar
            query={threadSearch.query}
            matchCount={threadSearch.matchCount}
            activeIndex={threadSearch.activeIndex}
            inputRef={threadSearch.inputRef}
            onSearch={threadSearch.search}
            onNext={() => threadSearch.goToMatch(1)}
            onPrev={() => threadSearch.goToMatch(-1)}
            onClose={threadSearch.close}
          />
        ) : null}
        {/* MessageScroller owns the scroll frame, its scroll-state attributes and the
            jump control. Rows stay windowed: mounting every row of a 2000-row transcript
            took ~1.3s to open and dropped frames while streaming. So, as upstream documents
            for virtualized lists, the virtual list is Content's only child and
            useTimelineViewport keeps owning follow/reading position (autoScroll stays off). */}
        <MessageScrollerProvider>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport
              className="timeline-pane timeline-pane--thread"
              data-testid="timeline-pane"
              preserveScrollOnPrepend={false}
              ref={viewport.attachPane}
              tabIndex={0}
            >
              {transcriptFailed ? (
                <div className="timeline" data-testid="transcript">
                  <TranscriptHydrateError
                    retrying={transcriptFailed.retrying}
                    onRetry={onRetryTranscript}
                  />
                </div>
              ) : isTranscriptLoading ? (
                <div className="timeline" data-testid="transcript">
                  <TranscriptSkeleton />
                </div>
              ) : transcript.length === 0 ? (
                <div className="timeline" data-testid="transcript">
                  <TranscriptEmptyState />
                </div>
              ) : (
                <MessageScrollerContent className="block min-h-full">
                  <div
                    className="timeline timeline--virtualized"
                    data-testid="transcript"
                    style={{ height: viewport.totalHeight }}
                  >
                    {viewport.visibleRows.map(({ item, top }) => (
                      <MeasuredTimelineItem
                        key={item.id}
                        item={item}
                        top={top}
                        className="timeline__virtual-row"
                        onHeightChange={viewport.measureRow}
                        generation={viewport.layoutGeneration}
                        toggledToolCallIds={toggledToolCallIds}
                        extensionUi={extensionUi}
                        richTools={richTools}
                        onToggleToolCall={toggleToolCall}
                        onViewFileInDiff={onViewFileInDiff}
                        onOpenTurnChange={onOpenTurnChange}
                        sourceMessageIndex={renderedMessageIndexById.get(item.id)}
                        onForkFromMessage={onForkFromMessage}
                        onOpenWorkspaceFileLine={onOpenWorkspaceFileLine}
                        workspacePath={workspacePath}
                        annotationMarkers={
                          markersByMessage.get(item.id) ??
                          (item.kind === "message" && item.sourceMessageId
                            ? markersByMessage.get(item.sourceMessageId)
                            : undefined) ??
                          NO_MARKERS
                        }
                        onOpenAnnotation={annotationSelection.openAnnotation}
                        scheduledOrigin={
                          item.kind === "message" ? scheduledOrigins?.get(item.id) : undefined
                        }
                      />
                    ))}
                  </div>
                </MessageScrollerContent>
              )}
            </MessageScrollerViewport>
            {/* The button scrolls to the end; jumpToLatest records the intent to follow. */}
            {!transcriptFailed && viewport.showJumpToLatest ? (
              <MessageScrollerButton
                behavior="auto"
                data-testid="timeline-jump"
                size="default"
                onClick={viewport.jumpToLatest}
              >
                New activity below
              </MessageScrollerButton>
            ) : null}
          </MessageScroller>
        </MessageScrollerProvider>
      </div>
      {annotationSelection.layer}
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="transcript-skeleton" data-testid="transcript-skeleton" aria-hidden="true">
      <div className="transcript-skeleton__row transcript-skeleton__row--user">
        <Skeleton className="h-3" style={{ width: "42%" }} />
      </div>
      <div className="transcript-skeleton__row">
        <Skeleton className="h-3" style={{ width: "88%" }} />
        <Skeleton className="h-3" style={{ width: "94%" }} />
        <Skeleton className="h-3" style={{ width: "66%" }} />
      </div>
      <div className="transcript-skeleton__row transcript-skeleton__row--tool">
        <Skeleton className="h-5" style={{ width: "38%" }} />
      </div>
      <div className="transcript-skeleton__row">
        <Skeleton className="h-3" style={{ width: "80%" }} />
        <Skeleton className="h-3" style={{ width: "72%" }} />
      </div>
      <span className="sr-only">Loading transcript…</span>
    </div>
  );
}

function TranscriptHydrateError({
  retrying,
  onRetry,
}: {
  readonly retrying: boolean;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="transcript-hydrate-error" data-testid="transcript-hydrate-error">
      <h2>Couldn't load this thread</h2>
      <p>The selected conversation couldn't be restored. Retry to try again.</p>
      <div className="transcript-hydrate-error__actions">
        <Button data-testid="hydrate-retry" disabled={retrying || !onRetry} onClick={onRetry}>
          {retrying ? <Spinner data-icon="inline-start" /> : null}
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </div>
  );
}

function TranscriptEmptyState() {
  return (
    <Empty className="py-16" data-testid="transcript-empty">
      <EmptyHeader>
        <EmptyMedia aria-hidden="true" variant="icon">
          <SparkIcon />
        </EmptyMedia>
        <EmptyTitle>Start the conversation</EmptyTitle>
        <EmptyDescription>Send a prompt below to begin this session.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

interface MeasuredTimelineItemProps {
  readonly item: DisplayTimelineItem;
  readonly className?: string;
  readonly top?: number;
  readonly onHeightChange: (id: string, height: number, generation: number) => void;
  readonly generation: number;
  readonly toggledToolCallIds: ReadonlySet<string>;
  readonly extensionUi: TimelineExtensionUi;
  readonly richTools?: RichToolHost;
  readonly onToggleToolCall: (callId: string) => void;
  readonly onViewFileInDiff?: (path: string) => void;
  readonly onOpenTurnChange?: OpenTurnChange;
  readonly sourceMessageIndex?: number;
  readonly onForkFromMessage?: (messageIndex: number, preview?: string) => void;
  readonly onOpenWorkspaceFileLine?: (target: WorkspaceFileLine) => void;
  readonly scheduledOrigin?: ScheduledTaskOrigin;
  readonly workspacePath?: string;
  readonly annotationMarkers: readonly AnnotationMarker[];
  readonly onOpenAnnotation: OpenAnnotation;
}

function MeasuredTimelineItemBase({
  item,
  className,
  top,
  onHeightChange,
  generation,
  toggledToolCallIds,
  extensionUi,
  richTools,
  onToggleToolCall,
  onViewFileInDiff,
  onOpenTurnChange,
  sourceMessageIndex,
  onForkFromMessage,
  onOpenWorkspaceFileLine,
  scheduledOrigin,
  workspacePath,
  annotationMarkers,
  onOpenAnnotation,
}: MeasuredTimelineItemProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) {
      return undefined;
    }

    const measure = () => {
      onHeightChange(item.id, element.getBoundingClientRect().height, generation);
    };

    measure();
    const resizeObserver = new ResizeObserver(() => {
      measure();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [item, onHeightChange, generation]);

  return (
    <div
      className={className}
      ref={rowRef}
      data-message-id={item.id}
      data-source-message-id={item.kind === "message" ? item.sourceMessageId : undefined}
      style={top == null ? undefined : { transform: `translateY(${top}px)` }}
    >
      <TimelineItem
        item={item}
        toggledToolCallIds={toggledToolCallIds}
        extensionUi={extensionUi}
        richTools={richTools}
        onToggleToolCall={onToggleToolCall}
        onViewFileInDiff={onViewFileInDiff}
        onOpenTurnChange={onOpenTurnChange}
        sourceMessageIndex={sourceMessageIndex}
        onForkFromMessage={onForkFromMessage}
        onOpenWorkspaceFileLine={onOpenWorkspaceFileLine}
        scheduledOrigin={scheduledOrigin}
        workspacePath={workspacePath}
        annotationMarkers={annotationMarkers}
        onOpenAnnotation={onOpenAnnotation}
      />
    </div>
  );
}

// The transcript array is rebuilt with fresh item objects on every session
// update, so reference equality on `item` would re-render all rows each
// streaming tick — on long threads (virtualization off) that means re-running
// every row several times per second, which saturates the renderer. Compare
// items structurally by the fields that actually affect their rendering.
function isSameDisplayItem(a: DisplayTimelineItem, b: DisplayTimelineItem): boolean {
  if (a === b) {
    return true;
  }
  if (a.kind !== b.kind || a.id !== b.id) {
    return false;
  }
  if (a.kind === "message" && b.kind === "message") {
    return (
      a.role === b.role &&
      a.text === b.text &&
      a.attachments === b.attachments &&
      a.sourceMessageId === b.sourceMessageId &&
      a.hasThinking === b.hasThinking
    );
  }
  if (a.kind === "tool" && b.kind === "tool") {
    // input/output are rebuilt objects on every transcript update, so identity
    // comparison would re-render every tool row per streaming tick. All visible
    // transitions (result arrival, failure) flip status and/or the derived
    // label/detail/metadata strings, so compare those instead.
    return (
      a.status === b.status &&
      a.toolName === b.toolName &&
      a.label === b.label &&
      a.detail === b.detail &&
      a.metadata === b.metadata &&
      a.argumentsComplete === b.argumentsComplete &&
      a.executionStarted === b.executionStarted &&
      a.partial === b.partial &&
      a.output === b.output
    );
  }
  if (a.kind === "activity" && b.kind === "activity") {
    return (
      a.label === b.label &&
      a.detail === b.detail &&
      a.metadata === b.metadata &&
      a.tone === b.tone &&
      a.source === b.source
    );
  }
  if (a.kind === "summary" && b.kind === "summary") {
    return a.label === b.label && a.metadata === b.metadata && a.presentation === b.presentation;
  }
  if (a.kind === "turn-marker" && b.kind === "turn-marker") {
    return a.durationMs === b.durationMs;
  }
  if (a.kind === "turn-changes" && b.kind === "turn-changes") {
    // A card's id is its checkpoint, and a captured turn's files never change.
    return true;
  }
  return false;
}

function areMeasuredTimelineItemPropsEqual(
  prev: MeasuredTimelineItemProps,
  next: MeasuredTimelineItemProps,
): boolean {
  return (
    isSameDisplayItem(prev.item, next.item) &&
    prev.className === next.className &&
    prev.top === next.top &&
    prev.generation === next.generation &&
    prev.onHeightChange === next.onHeightChange &&
    prev.toggledToolCallIds === next.toggledToolCallIds &&
    isSameTimelineExtensionUi(prev.extensionUi, next.extensionUi) &&
    prev.richTools === next.richTools &&
    prev.onToggleToolCall === next.onToggleToolCall &&
    prev.onViewFileInDiff === next.onViewFileInDiff &&
    prev.onOpenTurnChange === next.onOpenTurnChange &&
    prev.sourceMessageIndex === next.sourceMessageIndex &&
    prev.onForkFromMessage === next.onForkFromMessage &&
    prev.onOpenWorkspaceFileLine === next.onOpenWorkspaceFileLine &&
    prev.workspacePath === next.workspacePath &&
    prev.annotationMarkers === next.annotationMarkers &&
    prev.onOpenAnnotation === next.onOpenAnnotation &&
    prev.scheduledOrigin?.taskId === next.scheduledOrigin?.taskId
  );
}

// The extension UI record is rebuilt with every app snapshot; compare the
// values rows actually render so streaming ticks don't re-render every row.
function isSameTimelineExtensionUi(a: TimelineExtensionUi, b: TimelineExtensionUi): boolean {
  if (a === b) return true;
  return (
    a.toolsExpanded === b.toolsExpanded &&
    a.hiddenThinkingLabel === b.hiddenThinkingLabel &&
    a.working.visible === b.working.visible &&
    a.working.message === b.working.message &&
    a.working.indicator?.intervalMs === b.working.indicator?.intervalMs &&
    (a.working.indicator?.frames === b.working.indicator?.frames ||
      (a.working.indicator?.frames.length === b.working.indicator?.frames.length &&
        (a.working.indicator?.frames ?? []).every(
          (frame, index) => frame === b.working.indicator?.frames[index],
        )))
  );
}

const MeasuredTimelineItem = memo(MeasuredTimelineItemBase, areMeasuredTimelineItemPropsEqual);

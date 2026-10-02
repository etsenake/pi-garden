import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WorkspaceRecord, WorktreeRecord } from "../../../contracts/desktop-state";
import type { PiDesktopApi, WorkspaceFilePreview } from "../../../contracts/ipc";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CloseIcon, CopyIcon, WorktreeIcon } from "../../ui/icons";
import { HighlightedLine } from "../../ui/highlighted-line";
import { MAX_HIGHLIGHTED_LINES, extensionToLanguage } from "../../ui/syntax-highlight";
import { Badge } from "@/ui/shadcn/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/ui/shadcn/breadcrumb";
import { Button } from "@/ui/shadcn/button";
import { Tabs, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";
import { Toggle } from "@/ui/shadcn/toggle";
import { PanelEmpty } from "./panel-empty";
import { WithTooltip } from "./workbench-tooltip";
import {
  breadcrumbSegments,
  fileNameFromPath,
  isMarkdownPath,
  type FileLineMark,
  type FileWorkbenchTabs,
} from "./file-workbench-state";

interface FileEditorPaneProps {
  readonly api: PiDesktopApi;
  readonly workspace: WorkspaceRecord;
  readonly worktree: WorktreeRecord | undefined;
  readonly tabs: FileWorkbenchTabs;
  readonly onActivate: (path: string) => void;
  readonly onClose: (path: string) => void;
}

const FILE_MARKDOWN_COMPONENTS = {
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const code = String(children).replace(/\n$/, "");
    return <code className={className}>{code}</code>;
  },
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="message__table-scroll">
      <table>{children}</table>
    </div>
  ),
  img: ({ alt }: { alt?: string }) => (
    <span className="file-editor__blocked-image">{alt ? `[image: ${alt}]` : "[image]"}</span>
  ),
};

const FILE_MARKDOWN_PLUGINS = [remarkGfm];

export function FileEditorPane({
  api,
  workspace,
  worktree,
  tabs,
  onActivate,
  onClose,
}: FileEditorPaneProps) {
  const activePath = tabs.active;
  const lineMark = tabs.line;
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [sourceMode, setSourceMode] = useState(() => tabs.line !== null);
  const [sourceKey, setSourceKey] = useState(() => `${tabs.active ?? ""}:${tabs.lineNonce}`);
  const nextSourceKey = `${activePath ?? ""}:${tabs.lineNonce}`;
  if (sourceKey !== nextSourceKey) {
    setSourceKey(nextSourceKey);
    setSourceMode(lineMark !== null);
  }
  const markdown = activePath ? isMarkdownPath(activePath) : false;
  const worktreeLabel =
    workspace.kind === "worktree"
      ? (worktree?.name ?? workspace.branchName ?? workspace.name)
      : null;

  useEffect(() => {
    let cancelled = false;
    if (!activePath) {
      setPreview(null);
      setViewerError(null);
      setViewerLoading(false);
      return;
    }
    setViewerLoading(true);
    setViewerError(null);
    void api
      .readWorkspaceFile(workspace.id, activePath)
      .then((result) => {
        if (!cancelled) {
          setPreview(result);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreview(null);
          setViewerError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setViewerLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, api, workspace.id]);

  const showSource = !markdown || sourceMode;

  return (
    <section className="file-editor" data-testid="file-editor" aria-label="Open file">
      <div className="file-editor__tab-strip">
        {worktreeLabel ? (
          <WithTooltip label={worktreeLabel}>
            <Badge className="max-w-35" data-testid="file-editor-worktree-chip" variant="outline">
              <WorktreeIcon />
              <span className="truncate">{worktreeLabel}</span>
            </Badge>
          </WithTooltip>
        ) : null}
        <Tabs
          className="min-w-0 flex-1"
          onValueChange={(path) => {
            if (typeof path === "string") onActivate(path);
          }}
          value={activePath}
        >
          <TabsList
            aria-label="Open files"
            className="w-full min-w-0 justify-start overflow-x-auto [scrollbar-width:none]"
            variant="line"
          >
            {tabs.tabs.map((path) => (
              <div
                className="flex max-w-45 min-w-24 flex-initial items-center"
                data-testid="file-workbench-tab"
                key={path}
              >
                <WithTooltip label={path}>
                  <TabsTrigger className="min-w-0" value={path}>
                    <span className="truncate">{fileNameFromPath(path)}</span>
                  </TabsTrigger>
                </WithTooltip>
                <Button
                  aria-label={`Close ${fileNameFromPath(path)}`}
                  onClick={() => onClose(path)}
                  size="icon-xs"
                  variant="ghost"
                >
                  <CloseIcon />
                </Button>
              </div>
            ))}
          </TabsList>
        </Tabs>
        {activePath ? (
          <div className="file-editor__actions">
            {markdown ? (
              <Toggle
                onPressedChange={() => setSourceMode((current) => !current)}
                pressed={showSource}
                size="sm"
              >
                View source
              </Toggle>
            ) : null}
            <WithTooltip label="Copy file">
              <Button
                aria-label="Copy file"
                disabled={!preview || preview.binary || Boolean(viewerError)}
                onClick={() => {
                  if (preview && !preview.binary) {
                    void navigator.clipboard.writeText(preview.content).catch((error: unknown) => {
                      console.error("[renderer] copy file failed", error);
                    });
                  }
                }}
                size="icon-sm"
                variant="ghost"
              >
                <CopyIcon />
              </Button>
            </WithTooltip>
            <Button
              disabled={!activePath}
              onClick={() => {
                void api.revealWorkspaceFile(workspace.id, activePath).catch((error: unknown) => {
                  setViewerError(error instanceof Error ? error.message : String(error));
                });
              }}
              size="sm"
              variant="ghost"
            >
              Open
            </Button>
          </div>
        ) : null}
      </div>
      {activePath ? (
        <Breadcrumb
          aria-label="File path"
          className="border-b px-3 py-1.5"
          data-testid="file-editor-breadcrumb"
        >
          <BreadcrumbList>
            {breadcrumbSegments(activePath).map((segment, index, segments) => (
              <Fragment key={`${segment}-${index}`}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {index === segments.length - 1 ? (
                    <BreadcrumbPage>{segment}</BreadcrumbPage>
                  ) : (
                    segment
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      <div className="file-editor__body">
        {renderEditorBody({
          activePath,
          lineMark: showSource ? lineMark : null,
          markdown,
          preview,
          showSource,
          viewerError,
          viewerLoading,
        })}
      </div>
    </section>
  );
}

function renderEditorBody({
  activePath,
  lineMark,
  markdown,
  preview,
  showSource,
  viewerError,
  viewerLoading,
}: {
  readonly activePath: string | null;
  readonly lineMark: FileLineMark | null;
  readonly markdown: boolean;
  readonly preview: WorkspaceFilePreview | null;
  readonly showSource: boolean;
  readonly viewerError: string | null;
  readonly viewerLoading: boolean;
}): ReactNode {
  if (!activePath) {
    return <PanelEmpty title="Select a file from the explorer." />;
  }
  if (viewerLoading) {
    return <PanelEmpty loading title="Loading file…" />;
  }
  if (viewerError) {
    return <PanelEmpty title={viewerError} />;
  }
  if (!preview) {
    return <PanelEmpty title="No preview available." />;
  }
  if (preview.binary) {
    return <PanelEmpty title="Binary or directory preview is not available." />;
  }
  return (
    <>
      {markdown && !showSource ? (
        <FileMarkdown text={preview.content} />
      ) : (
        <SourceView content={preview.content} lineMark={lineMark} path={activePath} />
      )}
      {preview.truncated ? (
        <div className="file-editor__truncated" role="status">
          Preview truncated
        </div>
      ) : null}
    </>
  );
}

function FileMarkdown({ text }: { readonly text: string }) {
  return (
    <div className="file-editor__markdown message__content" data-testid="file-workbench-preview">
      <ReactMarkdown remarkPlugins={FILE_MARKDOWN_PLUGINS} components={FILE_MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function SourceView({
  path,
  content,
  lineMark,
}: {
  readonly path: string;
  readonly content: string;
  readonly lineMark: FileLineMark | null;
}) {
  const language = extensionToLanguage(path);
  const lines = content.split("\n");
  const highlightActive = language !== undefined && lines.length <= MAX_HIGHLIGHTED_LINES;
  const firstMarkedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const line = firstMarkedRef.current;
    if (line) {
      scrollIntoContainer(line, ".file-editor__body");
    }
  }, [content, lineMark, path]);
  return (
    <pre
      className="file-editor__source file-workbench__preview"
      data-testid="file-workbench-preview"
    >
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const marked =
          lineMark !== null && lineNumber >= lineMark.start && lineNumber <= lineMark.end;
        return (
          <div
            className={marked ? "file-editor__line file-editor__line--marked" : "file-editor__line"}
            data-line={lineNumber}
            data-testid={marked ? "file-line-mark" : undefined}
            key={lineNumber}
            ref={marked && lineNumber === lineMark?.start ? firstMarkedRef : undefined}
          >
            {highlightActive ? <HighlightedLine content={line} language={language} /> : line || " "}
          </div>
        );
      })}
    </pre>
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

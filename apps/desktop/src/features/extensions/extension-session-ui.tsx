import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { HostUiResponse } from "@pi-garden/session-driver";
import { trapDialogFocus } from "../../ui/dialog-focus";
import {
  ansiStyleClassNames,
  hasAnsiStyle,
  parseAnsiText,
  plainText,
  type AnsiTextSegment,
} from "../../lib/ansi-text";
import type {
  SessionExtensionDialogRecord,
  SessionExtensionUiStateRecord,
  SessionExtensionWidgetRecord,
} from "../../../contracts/desktop-state";

/** Pi's TUI shows at most this many widget lines, then a muted truncation marker. */
export const MAX_WIDGET_LINES = 10;
const WIDGET_TRUNCATED_MARKER = "... (widget truncated)";

export interface ExtensionWidgetView {
  readonly key: string;
  /** Styled lines after Pi's line cap; each line is a run of ANSI-styled segments. */
  readonly lines: readonly (readonly AnsiTextSegment[])[];
  /** Whether Pi's line cap dropped trailing lines. */
  readonly truncated: boolean;
}

export interface ExtensionStatusView {
  readonly key: string;
  readonly segments: readonly AnsiTextSegment[];
}

export function widgetsForPlacement(
  uiState: SessionExtensionUiStateRecord | undefined,
  placement: SessionExtensionWidgetRecord["placement"],
): readonly ExtensionWidgetView[] {
  if (!uiState) {
    return [];
  }

  return uiState.widgets.flatMap((widget) => {
    if (widget.placement !== placement) {
      return [];
    }
    const lines = widget.lines.flatMap((line) =>
      line
        .replaceAll("\r\n", "\n")
        .replaceAll("\r", "\n")
        .split("\n")
        .map((part) => parseAnsiText(part)),
    );
    if (!lines.some((line) => plainText(line).trim().length > 0)) {
      return [];
    }
    return [
      {
        key: widget.key,
        lines: lines.slice(0, MAX_WIDGET_LINES),
        truncated: lines.length > MAX_WIDGET_LINES,
      },
    ];
  });
}

export function statusesForDisplay(
  uiState: SessionExtensionUiStateRecord | undefined,
): readonly ExtensionStatusView[] {
  if (!uiState) {
    return [];
  }

  return uiState.statuses
    .map((status) => ({ key: status.key, segments: statusSegments(status.text) }))
    .filter((status) => plainText(status.segments).length > 0)
    .sort((left, right) => left.key.localeCompare(right.key));
}

/** Flatten a status to one line while keeping its styling. */
function statusSegments(text: string): readonly AnsiTextSegment[] {
  const segments = parseAnsiText(text.replace(/[\r\n\t]/g, " ")).map((segment) => ({
    ...segment,
    text: segment.text.replace(/ +/g, " "),
  }));
  // Trim leading/trailing whitespace across segment boundaries.
  let start = 0;
  while (start < segments.length && segments[start]!.text.trim().length === 0) start += 1;
  let end = segments.length;
  while (end > start && segments[end - 1]!.text.trim().length === 0) end -= 1;
  const trimmed = segments.slice(start, end);
  if (trimmed.length === 0) {
    return [];
  }
  const lastIndex = trimmed.length - 1;
  trimmed[0] = { ...trimmed[0]!, text: trimmed[0]!.text.trimStart() };
  trimmed[lastIndex] = { ...trimmed[lastIndex]!, text: trimmed[lastIndex]!.text.trimEnd() };
  return trimmed.filter((segment) => segment.text.length > 0);
}

/** Render styled segments as spans; unstyled runs stay bare text nodes. */
export function AnsiText({ segments }: { readonly segments: readonly AnsiTextSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        hasAnsiStyle(segment.style) ? (
          <span className={`ansi ${ansiStyleClassNames(segment.style)}`} key={index}>
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

export function ExtensionWidgets({
  placement,
  widgets,
}: {
  readonly placement: "above" | "below";
  readonly widgets: readonly ExtensionWidgetView[];
}) {
  if (widgets.length === 0) {
    return null;
  }

  const piPlacement = placement === "above" ? "aboveEditor" : "belowEditor";

  return (
    <div
      aria-label={
        placement === "above"
          ? "Extension widgets above the editor"
          : "Extension widgets below the editor"
      }
      className={`extension-widgets extension-widgets--${placement}`}
      data-placement={piPlacement}
      data-testid={`extension-widgets-${placement}`}
    >
      {widgets.map((widget) => (
        <pre className="extension-widgets__item" data-widget-key={widget.key} key={widget.key}>
          {widget.lines.map((line, index) => (
            <Fragment key={index}>
              {index > 0 ? "\n" : null}
              <AnsiText segments={line} />
            </Fragment>
          ))}
          {widget.truncated ? (
            <span className="extension-widgets__truncated" data-testid="extension-widget-truncated">
              {"\n"}
              {WIDGET_TRUNCATED_MARKER}
            </span>
          ) : null}
        </pre>
      ))}
    </div>
  );
}

export function ExtensionStatusLine({
  statuses,
}: {
  readonly statuses: readonly ExtensionStatusView[];
}) {
  if (statuses.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Extension status"
      className="extension-status-line"
      data-testid="extension-status-line"
    >
      {statuses.map((status) => (
        <span className="extension-status-line__item" data-status-key={status.key} key={status.key}>
          <AnsiText segments={status.segments} />
        </span>
      ))}
    </div>
  );
}

export function ExtensionDialog({
  dialog,
  onRespond,
}: {
  readonly dialog: SessionExtensionDialogRecord;
  readonly onRespond: (response: HostUiResponse) => void;
}) {
  const [draft, setDraft] = useState("");
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstOptionButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (dialog.kind === "input") {
      setDraft(dialog.initialValue ?? "");
      return;
    }
    if (dialog.kind === "editor") {
      setDraft(dialog.initialValue ?? "");
      return;
    }
    setDraft("");
  }, [dialog]);

  useEffect(() => {
    if (dialog.kind === "confirm") {
      cancelButtonRef.current?.focus();
      return;
    }
    if (dialog.kind === "select") {
      firstOptionButtonRef.current?.focus();
    }
  }, [dialog]);

  const respondWithCancel = () => onRespond({ requestId: dialog.requestId, cancelled: true });
  const respondWithSubmit = () => {
    if (dialog.kind === "confirm") {
      onRespond({ requestId: dialog.requestId, confirmed: true });
      return;
    }
    if (dialog.kind === "input" || dialog.kind === "editor") {
      onRespond({ requestId: dialog.requestId, value: draft });
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      trapDialogFocus(event, dialogRef.current);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      respondWithCancel();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      if (dialog.kind === "confirm" || dialog.kind === "input" || dialog.kind === "editor") {
        event.preventDefault();
        respondWithSubmit();
      }
    }
  };

  return (
    <div className="extension-dialog-backdrop">
      <div
        aria-describedby={dialog.kind === "confirm" ? bodyId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="extension-dialog"
        data-testid="extension-dialog"
        ref={dialogRef}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="extension-dialog__title" id={titleId}>
          {dialog.title}
        </div>
        {dialog.kind === "confirm" ? (
          <p className="extension-dialog__body" id={bodyId}>
            {dialog.message}
          </p>
        ) : null}

        {dialog.kind === "select" ? (
          <div className="extension-dialog__options">
            {dialog.options.map((option, index) => (
              <button
                className="extension-dialog__option"
                key={option}
                ref={index === 0 ? firstOptionButtonRef : undefined}
                type="button"
                onClick={() => onRespond({ requestId: dialog.requestId, value: option })}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {dialog.kind === "input" ? (
          <input
            autoFocus
            className="skills-search"
            placeholder={dialog.placeholder ?? "Enter a value"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}

        {dialog.kind === "editor" ? (
          <textarea
            autoFocus
            className="extension-dialog__editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}

        <div className="extension-dialog__actions">
          <button
            ref={cancelButtonRef}
            className="button button--secondary"
            data-testid="extension-dialog-cancel"
            type="button"
            onClick={respondWithCancel}
          >
            Cancel
          </button>
          {dialog.kind === "confirm" ? (
            <button
              className="button button--primary"
              data-testid="extension-dialog-confirm"
              type="button"
              onClick={respondWithSubmit}
            >
              Confirm
            </button>
          ) : null}
          {dialog.kind === "input" || dialog.kind === "editor" ? (
            <button
              className="button button--primary"
              data-testid="extension-dialog-submit"
              type="button"
              onClick={respondWithSubmit}
            >
              Submit
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

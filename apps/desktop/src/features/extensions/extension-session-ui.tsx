import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { HostUiResponse } from "@pi-garden/session-driver";
import { trapDialogFocus } from "../../ui/dialog-focus";
import type {
  SessionExtensionDialogRecord,
  SessionExtensionUiStateRecord,
  SessionExtensionWidgetRecord,
} from "../../../contracts/desktop-state";

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export interface ExtensionWidgetView {
  readonly key: string;
  readonly lines: readonly string[];
}

export interface ExtensionStatusView {
  readonly key: string;
  readonly text: string;
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
    const lines = visibleWidgetLines(widget.lines);
    return lines ? [{ key: widget.key, lines }] : [];
  });
}

export function statusesForDisplay(
  uiState: SessionExtensionUiStateRecord | undefined,
): readonly ExtensionStatusView[] {
  if (!uiState) {
    return [];
  }

  return uiState.statuses
    .map((status) => ({
      key: status.key,
      text: sanitizeStatusText(status.text),
    }))
    .filter((status) => status.text.length > 0)
    .sort((left, right) => left.key.localeCompare(right.key));
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
          {widget.lines.join("\n")}
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
          {status.text}
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

function visibleWidgetLines(lines: readonly string[]): readonly string[] | undefined {
  const sanitized = lines.map((line) => stripAnsi(line));
  if (!sanitized.some((line) => line.trim().length > 0)) {
    return undefined;
  }
  return sanitized;
}

function sanitizeStatusText(text: string): string {
  return stripAnsi(text)
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function stripAnsi(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(ANSI_ESCAPE_PATTERN, "");
}

import type { DesktopToolPresentation } from "@pi-garden/extension-ui/browser";
import type { TimelineToolCall } from "../../../contracts/timeline-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Maps a timeline tool row onto the graphical state a sandboxed renderer receives. */
export function desktopToolPresentation(
  item: TimelineToolCall,
  expanded: boolean,
): DesktopToolPresentation {
  const output = isRecord(item.output) ? item.output : undefined;
  const isError = item.status === "error" || output?.isError === true;
  const executionStarted = item.executionStarted ?? true;
  const argumentsComplete = item.argumentsComplete ?? executionStarted;
  let phase: DesktopToolPresentation["phase"];
  if (isError) phase = "error";
  else if (item.status === "success") phase = "complete";
  else if (!executionStarted) phase = "pending";
  else if (item.partial !== undefined || item.detail) phase = "partial";
  else phase = "running";
  const error = isError
    ? item.detail || (typeof output?.error === "string" ? output.error : "Tool failed")
    : undefined;
  return {
    toolName: item.toolName,
    toolCallId: item.callId,
    arguments: item.input,
    argumentsComplete,
    executionStarted,
    phase,
    ...(item.partial !== undefined ? { partial: item.partial } : {}),
    ...(item.output !== undefined
      ? {
          result: {
            content: output && "content" in output ? output.content : item.output,
            ...(output && "details" in output ? { details: output.details } : {}),
            isError,
          },
        }
      : {}),
    ...(error ? { error } : {}),
    expanded,
  };
}

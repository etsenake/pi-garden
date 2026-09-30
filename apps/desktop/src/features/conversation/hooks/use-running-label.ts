import { useEffect, useState } from "react";

/**
 * Header status while a run is active. `workingMessage` is Pi's
 * `setWorkingMessage` text; it replaces the default "Working" wording and the
 * elapsed time keeps ticking after it.
 */
export function useRunningLabel(startedAt: string | undefined, workingMessage?: string) {
  const [label, setLabel] = useState(() => formatRunningLabel(startedAt, workingMessage));

  useEffect(() => {
    setLabel(formatRunningLabel(startedAt, workingMessage));
    if (!startedAt) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setLabel(formatRunningLabel(startedAt, workingMessage));
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [startedAt, workingMessage]);

  return label;
}

function formatRunningLabel(
  startedAt: string | undefined,
  workingMessage: string | undefined,
): string {
  const message = workingMessage?.trim() || "Working";
  if (!startedAt) {
    return `${message}…`;
  }

  const diffMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const seconds = Math.max(1, Math.floor(diffMs / 1000));
  if (seconds < 60) {
    return `${message} for ${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining === 0
    ? `${message} for ${minutes}m`
    : `${message} for ${minutes}m ${remaining}s`;
}

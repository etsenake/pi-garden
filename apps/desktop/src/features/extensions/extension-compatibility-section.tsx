import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExtensionCompatibilityEvidence,
  ExtensionCompatibilityFinding,
  ExtensionCompatibilityInventory,
  ExtensionCompatibilityStatus,
} from "../../../contracts/extension-compatibility";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { SettingsGroup } from "../settings/settings-utils";
import { displayPath } from "./resource-detail";

type CompatibilityApi = Pick<
  PiDesktopApi,
  "getExtensionCompatibility" | "onExtensionCompatibilityChanged"
>;

interface CompatibilityState {
  readonly inventory: ExtensionCompatibilityInventory | null;
  readonly loading: boolean;
  readonly error: string;
}

/**
 * Loads the extension-level inventory for one detail page and re-requests it
 * when main reports new runtime evidence for the workspace. Runtime evidence
 * is generation-bound on the main side; the renderer only mirrors it.
 */
export function useExtensionCompatibility({
  api,
  workspaceId,
  extensionPath,
}: {
  readonly api: CompatibilityApi | undefined;
  readonly workspaceId: string;
  readonly extensionPath: string;
}) {
  const [state, setState] = useState<CompatibilityState>({
    inventory: null,
    loading: true,
    error: "",
  });
  const [nonce, setNonce] = useState(0);
  // A user-requested re-inspection bypasses the source cache; pushes from main do not.
  const refreshRequested = useRef(false);
  const refresh = useCallback(() => {
    refreshRequested.current = true;
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!api) {
      setState({ inventory: null, loading: false, error: "" });
      return;
    }
    let disposed = false;
    const refreshSource = refreshRequested.current;
    refreshRequested.current = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    api
      .getExtensionCompatibility({
        workspaceId,
        extensionPath,
        ...(refreshSource ? { refresh: true } : {}),
      })
      .then((inventory) => {
        if (!disposed) setState({ inventory, loading: false, error: "" });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        setState((current) => ({ ...current, loading: false, error: message }));
      });
    return () => {
      disposed = true;
    };
  }, [api, workspaceId, extensionPath, nonce]);

  useEffect(() => {
    if (!api) return;
    return api.onExtensionCompatibilityChanged((event) => {
      if (event.workspaceId === workspaceId) setNonce((value) => value + 1);
    });
  }, [api, workspaceId]);

  return { ...state, refresh };
}

/** The detail-page section: loads the inventory for one extension and renders it. */
export function ExtensionDesktopCompatibility({
  api,
  workspaceId,
  workspacePath,
  extensionPath,
  onAdapt,
}: {
  readonly api: CompatibilityApi | undefined;
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly extensionPath: string;
  readonly onAdapt?: (extensionPath: string) => void;
}) {
  const { inventory, loading, error, refresh } = useExtensionCompatibility({
    api,
    workspaceId,
    extensionPath,
  });
  return (
    <ExtensionCompatibilitySectionView
      error={error}
      inventory={inventory}
      loading={loading}
      workspacePath={workspacePath}
      onAdapt={onAdapt ? () => onAdapt(extensionPath) : undefined}
      onRefresh={refresh}
    />
  );
}

const STATUS_LABEL: Readonly<Record<ExtensionCompatibilityStatus, string>> = {
  adaptable: "Adaptable",
  adapted: "Adapted",
  unsupported: "Unsupported",
  unknown: "Unknown",
  "desktop-native": "Desktop-native",
  supported: "Supported",
};

const STATUS_DESCRIPTION: Readonly<Record<ExtensionCompatibilityStatus, string>> = {
  adaptable: "Terminal-specific. Adapt for Desktop maps it to the target shown.",
  adapted:
    "The terminal call remains for ordinary Pi and is paired with this desktop registration.",
  unsupported: "Not served or adapted in this version.",
  unknown: "Seen in source, but the shape could not be classified.",
  "desktop-native": "A pi-garden presentation this extension already supplies.",
  supported: "Pi API pi-garden serves directly; nothing to change.",
};

export function ExtensionCompatibilitySectionView({
  inventory,
  loading,
  error,
  workspacePath,
  onRefresh,
  onAdapt,
}: {
  readonly inventory: ExtensionCompatibilityInventory | null;
  readonly loading: boolean;
  readonly error: string;
  readonly workspacePath: string;
  readonly onRefresh: () => void;
  readonly onAdapt?: () => void;
}) {
  const adaptable = inventory?.findings.filter((finding) => finding.status === "adaptable") ?? [];
  const adaptation = inventory?.adaptation;
  return (
    <SettingsGroup
      title="Desktop compatibility"
      description="What this extension asks its host for, and what pi-garden does with it. Source means the code references an API; runtime means it was observed in this app's current session generation."
    >
      <div className="extension-compat" data-testid="extension-compatibility">
        <div className="extension-compat__toolbar">
          <span className="extension-compat__summary" data-testid="extension-compatibility-summary">
            {summaryText(inventory, loading, error)}
          </span>
          <div className="extension-compat__actions">
            <button
              className="button button--secondary"
              disabled={loading}
              type="button"
              onClick={onRefresh}
            >
              Re-inspect
            </button>
            {adaptation ? (
              <button
                className="button button--primary"
                data-testid="adapt-for-desktop"
                disabled={!adaptation.available || loading || !onAdapt}
                title={adaptation.message}
                type="button"
                onClick={onAdapt}
              >
                Adapt for Desktop
              </button>
            ) : null}
          </div>
        </div>
        {adaptation && !adaptation.available ? (
          <p
            className="extension-compat__note"
            data-testid="adapt-for-desktop-unavailable"
            data-reason={adaptation.reason}
          >
            {adaptation.message}
          </p>
        ) : adaptation?.available ? (
          <p className="extension-compat__note">
            {adaptable.length} terminal-specific{" "}
            {adaptable.length === 1 ? "capability" : "capabilities"} can be adapted. This starts an
            ordinary Pi thread with the adapt-for-desktop skill.
          </p>
        ) : null}
        {error ? (
          <p className="extension-compat__note extension-compat__note--error">{error}</p>
        ) : null}
        {inventory ? (
          <ul className="extension-compat__list" data-testid="extension-compatibility-findings">
            {inventory.findings.map((finding) => (
              <FindingRow
                finding={finding}
                key={finding.capability}
                workspacePath={workspacePath}
              />
            ))}
            {inventory.findings.length === 0 ? (
              <li className="extension-compat__empty">
                {inventory.source.status === "skipped"
                  ? "No source was inspected and no runtime evidence has been observed."
                  : "No host UI or desktop registrations were found."}
              </li>
            ) : null}
          </ul>
        ) : null}
        {inventory && inventory.source.skipped.filter((entry) => entry.file).length > 0 ? (
          <details className="extension-compat__skipped">
            <summary>
              {inventory.source.skipped.filter((entry) => entry.file).length} file(s) not inspected
            </summary>
            <ul>
              {inventory.source.skipped
                .filter((entry) => entry.file)
                .map((entry) => (
                  <li key={`${entry.file}:${entry.reason}`}>
                    <code>{displayPath(entry.file, workspacePath)}</code> · {entry.reason}
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
      </div>
    </SettingsGroup>
  );
}

function summaryText(
  inventory: ExtensionCompatibilityInventory | null,
  loading: boolean,
  error: string,
): string {
  if (loading && !inventory) return "Inspecting…";
  if (!inventory) return error ? "Inspection failed" : "Not inspected";
  const counts = new Map<ExtensionCompatibilityStatus, number>();
  for (const finding of inventory.findings) {
    counts.set(finding.status, (counts.get(finding.status) ?? 0) + 1);
  }
  const parts = (
    ["adaptable", "adapted", "unsupported", "unknown", "desktop-native", "supported"] as const
  )
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${counts.get(status)} ${STATUS_LABEL[status].toLowerCase()}`);
  const source =
    inventory.source.status === "complete"
      ? `source inspected (${inventory.source.files.length} file${inventory.source.files.length === 1 ? "" : "s"})`
      : inventory.source.status === "partial"
        ? "source partially inspected"
        : "source not inspected";
  const runtime =
    inventory.runtime.generations.length > 0
      ? `runtime evidence from ${inventory.runtime.generations.length} live generation${inventory.runtime.generations.length === 1 ? "" : "s"}`
      : "no runtime evidence yet";
  return `${parts.length > 0 ? parts.join(" · ") : "nothing found"} — ${source}, ${runtime}`;
}

function FindingRow({
  finding,
  workspacePath,
}: {
  readonly finding: ExtensionCompatibilityFinding;
  readonly workspacePath: string;
}) {
  const sourceEvidence = finding.evidence.filter(
    (item): item is Extract<ExtensionCompatibilityEvidence, { kind: "source" }> =>
      item.kind === "source",
  );
  const runtimeEvidence = finding.evidence.filter(
    (item): item is Extract<ExtensionCompatibilityEvidence, { kind: "runtime" }> =>
      item.kind === "runtime",
  );
  return (
    <li
      className={`extension-compat__finding extension-compat__finding--${finding.status}`}
      data-adapted-by={
        finding.adaptedBy ? `${finding.adaptedBy.api}:${finding.adaptedBy.id}` : undefined
      }
      data-capability={finding.capability}
      data-status={finding.status}
      data-testid="extension-compatibility-finding"
    >
      <div className="extension-compat__finding-head">
        <span className={`extension-compat__status extension-compat__status--${finding.status}`}>
          {STATUS_LABEL[finding.status]}
        </span>
        <span className="extension-compat__label">{finding.label}</span>
        <code className="extension-compat__capability">{finding.capability}</code>
      </div>
      <div className="extension-compat__finding-body">
        <span>{STATUS_DESCRIPTION[finding.status]}</span>
        {finding.adaptedBy ? (
          <span>
            {" "}
            Paired with <code>{finding.adaptedBy.api}</code>
            {finding.adaptedBy.surface ? (
              <>
                {" "}
                <code>{finding.adaptedBy.surface}</code>
              </>
            ) : null}{" "}
            <code>{finding.adaptedBy.id}</code>
          </span>
        ) : null}
        {finding.adaptationTarget ? (
          <span>
            {" "}
            Target: <code>{finding.adaptationTarget}</code>
          </span>
        ) : null}
        {finding.desktopAnalogue ? (
          <span>
            {" "}
            Via <code>{finding.desktopAnalogue}</code>
          </span>
        ) : null}
        {finding.unsupportedReason ? <span> {finding.unsupportedReason}</span> : null}
      </div>
      <div className="extension-compat__evidence">
        {sourceEvidence.map((item) => (
          <span
            className="extension-compat__evidence-item extension-compat__evidence-item--source"
            data-evidence="source"
            key={`${item.file}:${item.line}:${item.column}`}
            title={item.snippet}
          >
            source · {displayPath(item.file, workspacePath)}:{item.line}
            {item.partial ? " (uncertain)" : ""}
          </span>
        ))}
        {runtimeEvidence.map((item, index) => (
          <span
            className="extension-compat__evidence-item extension-compat__evidence-item--runtime"
            data-evidence="runtime"
            key={`${item.generation}:${item.attribution}:${index}`}
            title={`generation ${item.generation} · ${item.observedAt}`}
          >
            runtime · {item.detail ?? item.attribution} · {item.attribution}
          </span>
        ))}
      </div>
    </li>
  );
}

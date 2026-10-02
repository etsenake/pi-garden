import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type {
  ExtensionCompatibilityEvidence,
  ExtensionCompatibilityFinding,
  ExtensionCompatibilityInventory,
  ExtensionCompatibilityStatus,
} from "../../../contracts/extension-compatibility";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/shadcn/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
} from "@/ui/shadcn/item";
import { SettingsGroup } from "../settings/settings-utils";
import { displayPath } from "./resource-detail";
import { toneBadge, type HostTone } from "./tone-badge";

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

const STATUS_TONE: Readonly<Record<ExtensionCompatibilityStatus, HostTone>> = {
  adaptable: "accent",
  adapted: "success",
  unsupported: "error",
  unknown: "muted",
  "desktop-native": "success",
  supported: "default",
};

const RUNTIME_BADGE = toneBadge("accent");

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
  const skippedFiles = inventory?.source.skipped.filter((entry) => entry.file) ?? [];
  return (
    <SettingsGroup
      plain
      title="Desktop compatibility"
      description="What this extension asks its host for, and what pi-garden does with it. Source means the code references an API; runtime means it was observed in this app's current session generation."
    >
      <div className="extension-compat" data-testid="extension-compatibility">
        <div className="extension-compat__toolbar">
          <span className="extension-compat__summary" data-testid="extension-compatibility-summary">
            {summaryText(inventory, loading, error)}
          </span>
          <div className="extension-compat__actions">
            <Button disabled={loading} size="sm" variant="outline" onClick={onRefresh}>
              Re-inspect
            </Button>
            {adaptation ? (
              <Tooltip disabled={!adaptation.message}>
                {/* A span trigger, so the reason still shows while the button is disabled. */}
                <TooltipTrigger render={<span />}>
                  <Button
                    data-testid="adapt-for-desktop"
                    disabled={!adaptation.available || loading || !onAdapt}
                    size="sm"
                    onClick={onAdapt}
                  >
                    Adapt for Desktop
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{adaptation.message}</TooltipContent>
              </Tooltip>
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
          <ItemGroup className="gap-2" data-testid="extension-compatibility-findings">
            {inventory.findings.map((finding) => (
              <FindingRow
                finding={finding}
                key={finding.capability}
                workspacePath={workspacePath}
              />
            ))}
            {inventory.findings.length === 0 ? (
              <p className="extension-compat__empty">
                {inventory.source.status === "skipped"
                  ? "No source was inspected and no runtime evidence has been observed."
                  : "No host UI or desktop registrations were found."}
              </p>
            ) : null}
          </ItemGroup>
        ) : null}
        {skippedFiles.length > 0 ? (
          <Collapsible className="extension-compat__skipped">
            <CollapsibleTrigger
              render={<Button className="group justify-self-start" size="sm" variant="ghost" />}
            >
              <ChevronRightIcon className="transition-transform group-data-panel-open:rotate-90" />
              {skippedFiles.length} file(s) not inspected
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul>
                {skippedFiles.map((entry) => (
                  <li key={`${entry.file}:${entry.reason}`}>
                    <code>{displayPath(entry.file, workspacePath)}</code> · {entry.reason}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
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
    <Item
      data-adapted-by={
        finding.adaptedBy ? `${finding.adaptedBy.api}:${finding.adaptedBy.id}` : undefined
      }
      data-capability={finding.capability}
      data-status={finding.status}
      data-testid="extension-compatibility-finding"
      role="listitem"
      size="sm"
      variant="outline"
    >
      <ItemHeader className="flex-wrap justify-start">
        <Badge {...toneBadge(STATUS_TONE[finding.status])}>{STATUS_LABEL[finding.status]}</Badge>
        <span className="font-medium">{finding.label}</span>
        <code className="text-xs text-muted-foreground">{finding.capability}</code>
      </ItemHeader>
      <ItemContent className="min-w-0">
        <ItemDescription className="line-clamp-none wrap-anywhere">
          {STATUS_DESCRIPTION[finding.status]}
          {finding.adaptedBy ? (
            <>
              {" "}
              Paired with <code>{finding.adaptedBy.api}</code>
              {finding.adaptedBy.surface ? (
                <>
                  {" "}
                  <code>{finding.adaptedBy.surface}</code>
                </>
              ) : null}{" "}
              <code>{finding.adaptedBy.id}</code>
            </>
          ) : null}
          {finding.adaptationTarget ? (
            <>
              {" "}
              Target: <code>{finding.adaptationTarget}</code>
            </>
          ) : null}
          {finding.desktopAnalogue ? (
            <>
              {" "}
              Via <code>{finding.desktopAnalogue}</code>
            </>
          ) : null}
          {finding.unsupportedReason ? <> {finding.unsupportedReason}</> : null}
        </ItemDescription>
      </ItemContent>
      {sourceEvidence.length + runtimeEvidence.length > 0 ? (
        <ItemFooter className="flex-wrap justify-start">
          {sourceEvidence.map((item) => (
            <Tooltip key={`${item.file}:${item.line}:${item.column}`}>
              <TooltipTrigger
                render={<Badge className="max-w-full" data-evidence="source" variant="secondary" />}
              >
                <span className="truncate">
                  source · {displayPath(item.file, workspacePath)}:{item.line}
                  {item.partial ? " (uncertain)" : ""}
                </span>
              </TooltipTrigger>
              <TooltipContent>{item.snippet}</TooltipContent>
            </Tooltip>
          ))}
          {runtimeEvidence.map((item, index) => (
            <Tooltip key={`${item.generation}:${item.attribution}:${index}`}>
              <TooltipTrigger
                render={
                  <Badge
                    {...RUNTIME_BADGE}
                    className={cn("max-w-full", RUNTIME_BADGE.className)}
                    data-evidence="runtime"
                  />
                }
              >
                <span className="truncate">
                  runtime · {item.detail ?? item.attribution} · {item.attribution}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                generation {item.generation} · {item.observedAt}
              </TooltipContent>
            </Tooltip>
          ))}
        </ItemFooter>
      ) : null}
    </Item>
  );
}

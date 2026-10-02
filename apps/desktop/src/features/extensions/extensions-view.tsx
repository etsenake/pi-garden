import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ExtensionActionConflict } from "../../../contracts/extension-actions";
import type { RuntimeExtensionRecord } from "@pi-garden/session-driver/runtime-types";
import type {
  ExtensionCommandCompatibilityRecord,
  WorkspaceRecord,
} from "../../../contracts/desktop-state";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/shadcn/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";
import { ExtensionIcon } from "../../ui/icons";
import { SettingsGroup, SettingsRow } from "../settings/settings-utils";
import {
  extensionGroupLabel,
  isPiGardenBuiltinExtension,
  PI_GARDEN_TOOLS_LABEL,
} from "./extension-display";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { ExtensionDesktopCompatibility } from "./extension-compatibility-section";
import { displayPath, ResourceDetail } from "./resource-detail";
import { ResourceEmptyState, ResourceList, type ResourceListGroup } from "./resource-list";
import { toneBadge, type HostTone } from "./tone-badge";

const GROUP_ORDER = ["Workspace", "User", "This session", PI_GARDEN_TOOLS_LABEL];

interface ExtensionsTabProps {
  readonly workspace: WorkspaceRecord;
  readonly extensions: readonly RuntimeExtensionRecord[];
  readonly commandCompatibility: readonly ExtensionCommandCompatibilityRecord[];
  readonly searching: boolean;
  /** The extension whose detail page is open, looked up in the unfiltered list. */
  readonly selected?: RuntimeExtensionRecord;
  readonly onSelect: (path: string | undefined) => void;
  readonly onToggleExtension: (path: string, enabled: boolean) => void;
  readonly onOpenExtensionFolder: (path: string) => void;
  readonly shortcutConflicts?: readonly ExtensionActionConflict[];
  /** Desktop compatibility inventory reads; absent in unit renders without a preload bridge. */
  readonly api?: Pick<
    PiDesktopApi,
    "getExtensionCompatibility" | "onExtensionCompatibilityChanged"
  >;
  readonly onAdaptForDesktop?: (path: string) => void;
}

export function ExtensionsTab({
  workspace,
  extensions,
  commandCompatibility,
  searching,
  selected,
  onSelect,
  onToggleExtension,
  onOpenExtensionFolder,
  shortcutConflicts = [],
  api,
  onAdaptForDesktop,
}: ExtensionsTabProps) {
  // The list stays mounted under an open detail so expanded groups, scroll and focus survive.
  const list =
    extensions.length === 0 ? (
      <ResourceEmptyState
        title={searching ? "No extensions match" : "No extensions yet"}
        body={
          searching
            ? "Try another name, command or tool."
            : "Extensions are discovered in this workspace and your user extension folders. Refresh after adding one."
        }
      />
    ) : (
      <ResourceList
        expanded={searching}
        groups={groupExtensions(extensions, onToggleExtension)}
        icon={<ExtensionIcon />}
        testId="extensions-list"
        onOpen={onSelect}
      />
    );

  return (
    <>
      {selected ? (
        <ExtensionDetail
          api={api}
          commandCompatibility={commandCompatibility}
          selected={selected}
          workspace={workspace}
          onAdaptForDesktop={onAdaptForDesktop}
          onOpenExtensionFolder={onOpenExtensionFolder}
          onSelect={onSelect}
          onToggleExtension={onToggleExtension}
          shortcutConflicts={shortcutConflicts}
        />
      ) : null}
      <div hidden={Boolean(selected)}>{list}</div>
    </>
  );
}

function ExtensionDetail({
  selected,
  workspace,
  commandCompatibility,
  onSelect,
  onToggleExtension,
  onOpenExtensionFolder,
  shortcutConflicts = [],
  api,
  onAdaptForDesktop,
}: Omit<ExtensionsTabProps, "extensions" | "searching" | "selected"> & {
  readonly selected: RuntimeExtensionRecord;
}) {
  const hasFolder = isFolderExtension(selected);
  const compatibilityRecords = commandCompatibility
    .filter((record) => record.extensionPath === selected.path)
    .sort((left, right) => left.commandName.localeCompare(right.commandName));
  return (
    <ResourceDetail
      actions={
        hasFolder ? (
          <Button variant="outline" onClick={() => onOpenExtensionFolder(selected.path)}>
            Open folder
          </Button>
        ) : null
      }
      backLabel="All extensions"
      enabled={selected.enabled}
      icon={<ExtensionIcon />}
      subtitle={selected.sourceInfo.source}
      title={selected.displayName}
      onBack={() => onSelect(undefined)}
      onToggle={
        isToggleableExtension(selected)
          ? (enabled) => onToggleExtension(selected.path, enabled)
          : undefined
      }
    >
      {selected.description ? (
        <p className="resource-detail__description">{selected.description}</p>
      ) : null}
      <SettingsGroup>
        <SettingsRow
          title="Source"
          description={
            selected.sourceInfo.origin === "package"
              ? "Installed as a package"
              : "Loaded from a file"
          }
        >
          <span className="settings-row__value">{extensionGroupLabel(selected)}</span>
        </SettingsRow>
        {isPiGardenBuiltinExtension(selected) ? null : (
          <SettingsRow title="Location">
            <Tooltip>
              <TooltipTrigger render={<code className="resource-detail__code" />}>
                {displayPath(selected.path, workspace.path)}
              </TooltipTrigger>
              <TooltipContent>{selected.path}</TooltipContent>
            </Tooltip>
          </SettingsRow>
        )}
      </SettingsGroup>
      <ExtensionContributionSection title="Tools" items={selected.tools} />
      {selected.commands.length > 0 ? (
        <ExtensionCompatibilitySection
          commands={selected.commands}
          compatibilityRecords={compatibilityRecords}
        />
      ) : null}
      <ExtensionDesktopCompatibility
        api={api}
        extensionPath={selected.path}
        workspaceId={workspace.id}
        workspacePath={workspace.path}
        onAdapt={onAdaptForDesktop}
      />
      <ExtensionContributionSection title="Flags" items={selected.flags} />
      <ExtensionContributionSection title="Shortcuts" items={selected.shortcuts} />
      <ExtensionDiagnostics
        diagnostics={[
          ...selected.diagnostics,
          ...shortcutConflicts
            .filter((conflict) => conflict.extensionPath === selected.path)
            .map((conflict) => ({ type: "warning" as const, message: conflict.message })),
        ]}
      />
    </ResourceDetail>
  );
}

function groupExtensions(
  extensions: readonly RuntimeExtensionRecord[],
  onToggleExtension: (path: string, enabled: boolean) => void,
): readonly ResourceListGroup[] {
  return GROUP_ORDER.map((label) => ({
    label,
    items: extensions
      .filter((extension) => extensionGroupLabel(extension) === label)
      .map((extension) => ({
        id: extension.path,
        title: extension.displayName,
        description: describeExtension(extension),
        enabled: extension.enabled,
        onToggle: isToggleableExtension(extension)
          ? (enabled: boolean) => onToggleExtension(extension.path, enabled)
          : undefined,
      })),
  })).filter((group) => group.items.length > 0);
}

/** One line for the list: the extension's own description, else what it contributes. */
function describeExtension(extension: RuntimeExtensionRecord): string {
  if (extension.description) return extension.description;
  const parts = [
    countLabel(extension.tools.length, "tool"),
    countLabel(extension.commands.length, "command"),
    countLabel(extension.diagnostics.length, "issue"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : extension.sourceInfo.source;
}

function countLabel(count: number, noun: string): string {
  return count === 0 ? "" : `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isFolderExtension(extension: RuntimeExtensionRecord): boolean {
  return extension.sourceInfo.scope === "project" || extension.sourceInfo.scope === "user";
}

function isToggleableExtension(extension: RuntimeExtensionRecord): boolean {
  return isFolderExtension(extension) || isPiGardenBuiltinExtension(extension);
}

function ExtensionContributionSection({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}) {
  if (items.length === 0) return null;
  return (
    <SettingsGroup title={title}>
      <ResourceTokens>
        {items.map((item) => (
          <ResourceToken key={item}>{item}</ResourceToken>
        ))}
      </ResourceTokens>
    </SettingsGroup>
  );
}

function ExtensionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: RuntimeExtensionRecord["diagnostics"];
}) {
  if (diagnostics.length === 0) return null;
  return (
    <SettingsGroup title="Diagnostics">
      {diagnostics.map((diagnostic, index) => (
        <Item
          data-diagnostic-type={diagnostic.type}
          key={`${diagnostic.message}:${index}`}
          size="sm"
        >
          <ItemMedia>
            <Badge {...toneBadge(diagnostic.type === "error" ? "error" : "warning")}>
              {diagnostic.type === "error" ? "Error" : "Warning"}
            </Badge>
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="line-clamp-none wrap-anywhere">{diagnostic.message}</ItemTitle>
            {diagnostic.path ? (
              <ItemDescription className="line-clamp-none font-mono wrap-anywhere">
                {diagnostic.path}
              </ItemDescription>
            ) : null}
          </ItemContent>
        </Item>
      ))}
    </SettingsGroup>
  );
}

function ExtensionCompatibilitySection({
  commands,
  compatibilityRecords,
}: {
  readonly commands: readonly string[];
  readonly compatibilityRecords: readonly ExtensionCommandCompatibilityRecord[];
}) {
  const supported = compatibilityRecords.filter((record) => record.status === "supported");
  const terminalOnly = compatibilityRecords.filter((record) => record.status === "terminal-only");
  const unknown = commands.filter((commandName) =>
    compatibilityRecords.every(
      (record) =>
        record.commandName !== commandName && !record.commandName.startsWith(`${commandName}:`),
    ),
  );

  return (
    <SettingsGroup
      title="Commands"
      description="Whether each command works in the app is learned the first time it runs here."
    >
      <ResourceTokens>
        {supported.map((record) => (
          <ResourceToken key={`supported:${record.commandName}`}>
            {record.commandName} · GUI-compatible
          </ResourceToken>
        ))}
        {terminalOnly.map((record) => (
          <ResourceToken key={`terminal:${record.commandName}`} tone="error">
            {record.commandName} · Terminal-only
          </ResourceToken>
        ))}
        {unknown.map((commandName) => (
          <ResourceToken key={`unknown:${commandName}`}>{commandName} · Unknown</ResourceToken>
        ))}
      </ResourceTokens>
    </SettingsGroup>
  );
}

function ResourceTokens({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 px-4 py-3">{children}</div>;
}

function ResourceToken({
  tone,
  children,
}: {
  readonly tone?: HostTone;
  readonly children: ReactNode;
}) {
  const badge = tone ? toneBadge(tone) : { variant: "outline" as const };
  return (
    <Badge {...badge} className={cn("max-w-full font-mono", badge.className)} render={<code />}>
      <span className="truncate">{children}</span>
    </Badge>
  );
}

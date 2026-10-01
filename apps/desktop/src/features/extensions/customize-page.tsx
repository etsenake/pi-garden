import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  RuntimeExtensionRecord,
  RuntimeSkillRecord,
  RuntimeSnapshot,
} from "@pi-garden/session-driver/runtime-types";
import type { ExtensionActionConflict } from "../../../contracts/extension-actions";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type {
  ExtensionCommandCompatibilityRecord,
  WorkspaceRecord,
} from "../../../contracts/desktop-state";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/shadcn/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/shadcn/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";
import { RefreshIcon, SearchIcon } from "../../ui/icons";
import { extensionScopeLabel } from "./extension-display";
import { ExtensionsTab } from "./extensions-view";
import { SkillsTab } from "./skills-view";

export type CustomizeTab = "skills" | "extensions";

interface CustomizePageProps {
  readonly tab: CustomizeTab;
  readonly onSelectTab: (tab: CustomizeTab) => void;
  /** The workspace the current tab lists; each tab remembers its own. */
  readonly workspace?: WorkspaceRecord;
  readonly workspacePicker: ReactNode;
  readonly skillsRuntime?: RuntimeSnapshot;
  readonly extensionsRuntime?: RuntimeSnapshot;
  readonly commandCompatibility: readonly ExtensionCommandCompatibilityRecord[];
  readonly onRefresh: () => void;
  readonly onToggleSkill: (filePath: string, enabled: boolean) => void;
  readonly onOpenSkillFolder: (filePath: string) => void;
  readonly onTryCommand: (command: string) => void;
  readonly onToggleExtension: (path: string, enabled: boolean) => void;
  readonly onOpenExtensionFolder: (path: string) => void;
  readonly shortcutConflicts?: readonly ExtensionActionConflict[];
  readonly api?: Pick<
    PiDesktopApi,
    "getExtensionCompatibility" | "onExtensionCompatibilityChanged"
  >;
  readonly onAdaptForDesktop?: (path: string) => void;
  readonly onStartAuthoring?: (kind: "host-contribution" | "rich-surface" | "desktop-view") => void;
}

const NEW_SKILL_PROMPT =
  "Create a new skill for this workspace and explain which files you will add.";

/** Codex's Plugins page: tabs with counts over one searchable, grouped list per tab. */
export function CustomizePage({
  tab,
  onSelectTab,
  workspace,
  workspacePicker,
  skillsRuntime,
  extensionsRuntime,
  commandCompatibility,
  onRefresh,
  onToggleSkill,
  onOpenSkillFolder,
  onTryCommand,
  onToggleExtension,
  onOpenExtensionFolder,
  shortcutConflicts = [],
  api,
  onAdaptForDesktop,
  onStartAuthoring,
}: CustomizePageProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  // The palette and the workspace picker change what is listed without going through the tabs,
  // so a search or open detail from the previous list must not carry over.
  const listKey = `${tab}:${workspace?.id ?? ""}`;
  const [shownListKey, setShownListKey] = useState(listKey);
  if (shownListKey !== listKey) {
    setShownListKey(listKey);
    setQuery("");
    setSelectedId(undefined);
  }
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectedId || !returnFocusId.current) return;
    const id = returnFocusId.current;
    returnFocusId.current = undefined;
    panelRef.current?.querySelector<HTMLElement>(`[data-resource-id="${CSS.escape(id)}"]`)?.focus();
  }, [selectedId]);
  const selectItem = (id: string | undefined) => {
    if (id === undefined) returnFocusId.current = selectedId;
    setSelectedId(id);
  };
  const skills = skillsRuntime?.skills ?? [];
  const extensions = extensionsRuntime?.extensions ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSkills = useMemo(
    () => skills.filter((skill) => matchesQuery(skillSearchText(skill), normalizedQuery)),
    [skills, normalizedQuery],
  );
  const filteredExtensions = useMemo(
    () =>
      extensions.filter((extension) =>
        matchesQuery(extensionSearchText(extension), normalizedQuery),
      ),
    [extensions, normalizedQuery],
  );

  return (
    <section className="canvas">
      <div className="conversation settings-view">
        <header className="view-header">
          <div>
            <h1 className="view-header__title">Skills and extensions</h1>
            <p className="view-header__body">
              Reusable workflows and runtime add-ons pi loads for{" "}
              {workspace?.name ?? "this workspace"}.
            </p>
          </div>
          <div className="view-header__actions">
            {workspacePicker}
            <Button
              aria-label="Refresh"
              size="icon"
              title="Refresh"
              variant="ghost"
              onClick={onRefresh}
            >
              <RefreshIcon />
            </Button>
            {tab === "skills" && workspace ? (
              <Button onClick={() => onTryCommand(NEW_SKILL_PROMPT)}>New skill</Button>
            ) : null}
            {tab === "extensions" && workspace && onStartAuthoring ? (
              <>
                <Button
                  data-testid="new-host-contribution"
                  variant="outline"
                  onClick={() => onStartAuthoring("host-contribution")}
                >
                  New badge
                </Button>
                <Button
                  data-testid="new-rich-surface"
                  variant="outline"
                  onClick={() => onStartAuthoring("rich-surface")}
                >
                  New widget
                </Button>
                <Button
                  data-testid="new-desktop-view"
                  onClick={() => onStartAuthoring("desktop-view")}
                >
                  New desktop view
                </Button>
              </>
            ) : null}
          </div>
        </header>

        <Tabs
          value={tab}
          onValueChange={(next: unknown) => {
            if (next === "skills" || next === "extensions") onSelectTab(next);
          }}
        >
          <div className="resource-toolbar">
            <TabsList activateOnFocus aria-label="Skills and extensions" variant="line">
              <ResourceTab count={skills.length} label="Skills" tab="skills" />
              <ResourceTab count={extensions.length} label="Extensions" tab="extensions" />
            </TabsList>
            <InputGroup className="max-w-xs">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={`Search ${tab}`}
                placeholder={`Search ${tab}`}
                spellCheck={false}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setSelectedId(undefined);
                }}
              />
            </InputGroup>
          </div>

          <TabsContent className="settings-grid" ref={panelRef} value={tab}>
            {!workspace ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Open a folder first</EmptyTitle>
                  <EmptyDescription>
                    Skills and extensions are discovered per workspace, plus your user folders.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : tab === "skills" ? (
              <SkillsTab
                searching={normalizedQuery.length > 0}
                selected={skills.find((skill) => skill.filePath === selectedId)}
                skills={filteredSkills}
                workspace={workspace}
                onOpenSkillFolder={onOpenSkillFolder}
                onSelect={selectItem}
                onToggleSkill={onToggleSkill}
                onTrySkill={(skill) => onTryCommand(`${skill.slashCommand} `)}
              />
            ) : (
              <ExtensionsTab
                api={api}
                commandCompatibility={commandCompatibility}
                extensions={filteredExtensions}
                searching={normalizedQuery.length > 0}
                selected={extensions.find((extension) => extension.path === selectedId)}
                workspace={workspace}
                onAdaptForDesktop={onAdaptForDesktop}
                onOpenExtensionFolder={onOpenExtensionFolder}
                onSelect={selectItem}
                onToggleExtension={onToggleExtension}
                shortcutConflicts={shortcutConflicts}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}

function ResourceTab({
  tab,
  label,
  count,
}: {
  readonly tab: CustomizeTab;
  readonly label: string;
  readonly count: number;
}) {
  return (
    <TabsTrigger value={tab}>
      {label}
      <Badge variant="secondary">{count}</Badge>
    </TabsTrigger>
  );
}

function matchesQuery(text: string, normalizedQuery: string): boolean {
  return !normalizedQuery || text.includes(normalizedQuery);
}

function skillSearchText(skill: RuntimeSkillRecord): string {
  return [skill.name, skill.description, skill.source, skill.slashCommand].join(" ").toLowerCase();
}

function extensionSearchText(extension: RuntimeExtensionRecord): string {
  return [
    extension.displayName,
    extension.description ?? "",
    extension.path,
    extension.sourceInfo.source,
    extensionScopeLabel(extension),
    ...extension.commands,
    ...extension.tools,
    ...extension.flags,
    ...extension.shortcuts,
    ...extension.diagnostics.map((diagnostic) => diagnostic.message),
  ]
    .join(" ")
    .toLowerCase();
}

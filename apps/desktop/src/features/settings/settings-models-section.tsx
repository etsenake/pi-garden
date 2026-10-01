import { useMemo, useState, type ReactNode } from "react";
import type {
  RuntimeModelKind,
  RuntimeModelRecord,
  RuntimeSettingsSnapshot,
  RuntimeSnapshot,
} from "@pi-garden/session-driver/runtime-types";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/ui/shadcn/item";
import { Tabs, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";
import { SettingsSelect, SettingsSwitch } from "./settings-controls";
import {
  filterModels,
  labelForThinking,
  SearchField,
  SettingsCard,
  SettingsGroup,
  SettingsNote,
  SettingsRow,
  THINKING_LEVELS,
} from "./settings-utils";

interface SettingsModelsSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly onSetDefaultModel: (provider: string, modelId: string) => void;
  readonly onSetThinkingLevel: (
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ) => void;
  readonly onSetScopedModelPatterns: (patterns: readonly string[]) => void;
  readonly onOpenProviders: () => void;
}

const THINKING_OPTIONS = THINKING_LEVELS.map((level) => ({
  value: level,
  label: labelForThinking(level),
}));

const KIND_FILTERS: readonly { readonly id: "all" | RuntimeModelKind; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "chat", label: "Chat" },
  { id: "virtual", label: "Virtual" },
  { id: "image", label: "Image" },
  { id: "classifier", label: "Classifier" },
];

const KIND_SECTIONS: readonly {
  readonly kind: RuntimeModelKind;
  readonly title: string;
  readonly description: string;
  readonly enableable: boolean;
}[] = [
  {
    kind: "chat",
    title: "Chat",
    description: "Models available for ordinary threads and the model picker.",
    enableable: true,
  },
  {
    kind: "virtual",
    title: "Virtual",
    description: "Router models that pick a physical model per request.",
    enableable: true,
  },
  {
    kind: "image",
    title: "Image",
    description: "Image-generation models (extensions / codemode).",
    enableable: false,
  },
  {
    kind: "classifier",
    title: "Classifier",
    description: "Classifier models used by routing and codemode scripts.",
    enableable: false,
  },
];

function modelPattern(model: RuntimeModelRecord): string {
  return `${model.providerId}/${model.modelId}`;
}

function isPickerKind(kind: RuntimeModelKind): boolean {
  return kind === "chat" || kind === "virtual";
}

/** Cursor's Models page: defaults on top, then searchable kind sections. */
export function SettingsModelsSection({
  runtime,
  onSetDefaultModel,
  onSetThinkingLevel,
  onSetScopedModelPatterns,
  onOpenProviders,
}: SettingsModelsSectionProps) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | RuntimeModelKind>("all");
  const [showUnconnected, setShowUnconnected] = useState(false);

  const models = runtime?.models ?? [];
  const availableModels = models.filter((model) => model.available);
  const unconnectedModels = models.filter((model) => !model.available);
  const pickerModels = availableModels.filter((model) => isPickerKind(model.kind));

  // No saved patterns means pi enables every available chat/virtual model.
  const savedPatterns = runtime?.settings.enabledModelPatterns ?? [];
  const activePatterns =
    savedPatterns.length === 0 ? pickerModels.map(modelPattern) : savedPatterns;
  const activeSet = new Set(activePatterns);
  const enabledModels = pickerModels.filter((model) => activeSet.has(modelPattern(model)));

  const defaultProvider = runtime?.settings.defaultProvider;
  const defaultModelId = runtime?.settings.defaultModelId;
  const defaultValue =
    defaultProvider && defaultModelId ? `${defaultProvider}:${defaultModelId}` : undefined;
  const defaultIsEnabled = enabledModels.some(
    (model) => model.providerId === defaultProvider && model.modelId === defaultModelId,
  );

  const searching = query.trim().length > 0;
  const kindMatched = useMemo(
    () => (kindFilter === "all" ? models : models.filter((model) => model.kind === kindFilter)),
    [kindFilter, models],
  );
  const visibleAvailable = filterModels(
    kindMatched.filter((model) => model.available),
    query,
  );
  const visibleUnconnected = filterModels(
    kindMatched.filter((model) => !model.available),
    query,
  );

  const setEnabled = (pattern: string, enabled: boolean) => {
    const next = enabled
      ? [...activePatterns, pattern]
      : activePatterns.filter((entry) => entry !== pattern);
    if (next.length > 0) onSetScopedModelPatterns(next);
  };

  const visibleByKind = (kind: RuntimeModelKind, list: readonly RuntimeModelRecord[]) =>
    list.filter((model) => model.kind === kind);

  return (
    <>
      <SettingsGroup>
        <SettingsRow title="Default model" description="Used for new threads.">
          <SettingsSelect
            label="Default model"
            options={enabledModels.map((model) => ({
              value: `${model.providerId}:${model.modelId}`,
              label: `${model.providerName} · ${model.label}`,
            }))}
            value={defaultIsEnabled ? defaultValue : undefined}
            onChange={(value) => {
              const [provider = "", ...modelParts] = value.split(":");
              onSetDefaultModel(provider, modelParts.join(":"));
            }}
          />
        </SettingsRow>
        <SettingsRow title="Reasoning" description="Default reasoning effort for new threads.">
          <SettingsSelect
            label="Reasoning"
            options={THINKING_OPTIONS}
            value={runtime?.settings.defaultThinkingLevel ?? undefined}
            onChange={onSetThinkingLevel}
          />
        </SettingsRow>
        {defaultValue && !defaultIsEnabled ? (
          <SettingsNote tone="warning">
            Your default model ({defaultProvider}/{defaultModelId}) is turned off or its provider is
            not connected. Choose a new default.
          </SettingsNote>
        ) : null}
      </SettingsGroup>

      <section className="settings-section">
        <div className="flex items-center justify-between gap-3">
          <h3 className="settings-section__title flex items-center gap-2">
            Models
            <Badge variant="secondary">
              {enabledModels.length} of {pickerModels.length} enabled for chat
            </Badge>
          </h3>
          <SearchField label="Search models" value={query} onChange={setQuery} />
        </div>
        <p className="settings-section__description">
          Only enabled chat and virtual models appear in model pickers. Image and classifier models
          stay listed for discovery and auth.
        </p>
        <Tabs
          value={kindFilter}
          onValueChange={(value: "all" | RuntimeModelKind) => setKindFilter(value)}
        >
          <TabsList aria-label="Filter models by kind">
            {KIND_FILTERS.map((filter) => (
              <TabsTrigger
                data-testid={`settings-model-kind-${filter.id}`}
                key={filter.id}
                value={filter.id}
              >
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {KIND_SECTIONS.filter((section) => kindFilter === "all" || kindFilter === section.kind).map(
          (section) => {
            const sectionModels = visibleByKind(section.kind, visibleAvailable);
            if (sectionModels.length === 0 && searching) return null;
            if (
              sectionModels.length === 0 &&
              availableModels.every((m) => m.kind !== section.kind)
            ) {
              return null;
            }
            return (
              <div
                key={section.kind}
                className="flex flex-col gap-2.5"
                data-testid={`settings-model-kind-section-${section.kind}`}
              >
                <h4 className="settings-section__title flex items-center gap-2">
                  {section.title}
                  <Badge variant="secondary">{sectionModels.length}</Badge>
                </h4>
                <p className="settings-section__description">{section.description}</p>
                <SettingsCard data-testid={`settings-model-list-${section.kind}`}>
                  {sectionModels.length === 0 ? (
                    <SettingsNote>
                      {availableModels.some((model) => model.kind === section.kind)
                        ? `No ${section.title.toLowerCase()} models match “${query.trim()}”.`
                        : `No connected ${section.title.toLowerCase()} models yet.`}
                    </SettingsNote>
                  ) : (
                    sectionModels.map((model) => {
                      const pattern = modelPattern(model);
                      const enabled = activeSet.has(pattern);
                      return (
                        <ModelRow
                          isDefault={
                            model.providerId === defaultProvider && model.modelId === defaultModelId
                          }
                          key={`${model.kind}:${pattern}`}
                          model={model}
                        >
                          {section.enableable ? (
                            <SettingsSwitch
                              checked={enabled}
                              disabled={enabled && activePatterns.length <= 1}
                              label={`Enable ${pattern}`}
                              onChange={(next) => setEnabled(pattern, next)}
                            />
                          ) : null}
                        </ModelRow>
                      );
                    })
                  )}
                </SettingsCard>
              </div>
            );
          },
        )}

        {visibleAvailable.length === 0 && availableModels.length === 0 ? (
          <SettingsCard data-testid="settings-model-list">
            <SettingsNote>
              No connected models available yet. Connect a provider to add models.
            </SettingsNote>
          </SettingsCard>
        ) : null}
      </section>

      {unconnectedModels.length > 0 && (!searching || visibleUnconnected.length > 0) ? (
        <SettingsGroup
          title="Not connected"
          count={visibleUnconnected.length}
          description="Models from providers you have not signed in to."
          actions={
            <Button size="sm" variant="secondary" onClick={onOpenProviders}>
              Connect a provider
            </Button>
          }
          plain
        >
          {searching || showUnconnected ? (
            <SettingsCard data-testid="settings-unconnected-model-list">
              {visibleUnconnected.map((model) => (
                <ModelRow
                  isDefault={false}
                  key={`${model.kind}:${modelPattern(model)}`}
                  model={model}
                />
              ))}
            </SettingsCard>
          ) : (
            <Button
              className="justify-self-start"
              size="sm"
              variant="ghost"
              onClick={() => setShowUnconnected(true)}
            >
              Show {unconnectedModels.length} models
            </Button>
          )}
        </SettingsGroup>
      ) : null}
    </>
  );
}

function ModelRow({
  model,
  isDefault,
  children,
}: {
  readonly model: RuntimeModelRecord;
  readonly isDefault: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <Item className="settings-row model-row">
      <ItemContent className="min-w-0">
        <ItemTitle className="settings-row__title">
          {model.label}
          {isDefault ? <Badge variant="secondary">Default</Badge> : null}
          {model.kind !== "chat" ? (
            <Badge variant="secondary">{kindLabel(model.kind)}</Badge>
          ) : null}
        </ItemTitle>
        <ItemDescription className="line-clamp-none wrap-anywhere">
          {model.providerName} · {modelPattern(model)}
          {model.reasoning || model.supportsImages ? (
            <span className="ms-1.5 inline-flex gap-1 align-middle">
              {model.reasoning ? <Badge variant="outline">Reasoning</Badge> : null}
              {model.supportsImages ? <Badge variant="outline">Images</Badge> : null}
            </span>
          ) : null}
        </ItemDescription>
      </ItemContent>
      {children ? <ItemActions className="settings-row__control">{children}</ItemActions> : null}
    </Item>
  );
}

function kindLabel(kind: RuntimeModelKind): string {
  switch (kind) {
    case "virtual":
      return "Virtual";
    case "image":
      return "Image";
    case "classifier":
      return "Classifier";
    default:
      return "Chat";
  }
}

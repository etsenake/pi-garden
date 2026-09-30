import { useMemo, useState, type ReactNode } from "react";
import type {
  RuntimeModelKind,
  RuntimeModelRecord,
  RuntimeSettingsSnapshot,
  RuntimeSnapshot,
} from "@pi-garden/session-driver/runtime-types";
import { SearchIcon } from "../../ui/icons";
import { SettingsSelect, SettingsSwitch } from "./settings-controls";
import {
  filterModels,
  labelForThinking,
  SettingsGroup,
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
          <div className="settings-row">
            <span className="settings-warning">
              Your default model ({defaultProvider}/{defaultModelId}) is turned off or its provider
              is not connected. Choose a new default.
            </span>
          </div>
        ) : null}
      </SettingsGroup>

      <section className="settings-section">
        <div className="settings-section__header">
          <h3 className="settings-section__title">
            Models{" "}
            <span className="resource-list__count">
              {enabledModels.length} of {pickerModels.length} enabled for chat
            </span>
          </h3>
          <label className="resource-search">
            <SearchIcon />
            <input
              aria-label="Search models"
              placeholder="Search models"
              spellCheck={false}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>
        <p className="settings-section__description">
          Only enabled chat and virtual models appear in model pickers. Image and classifier models
          stay listed for discovery and auth.
        </p>
        <div className="settings-kind-filters" role="tablist" aria-label="Filter models by kind">
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={kindFilter === filter.id}
              className={
                kindFilter === filter.id ? "button button--primary" : "button button--secondary"
              }
              data-testid={`settings-model-kind-${filter.id}`}
              onClick={() => setKindFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {KIND_SECTIONS.filter(
          (section) => kindFilter === "all" || kindFilter === section.kind,
        ).map((section) => {
          const sectionModels = visibleByKind(section.kind, visibleAvailable);
          if (sectionModels.length === 0 && searching) return null;
          if (sectionModels.length === 0 && availableModels.every((m) => m.kind !== section.kind)) {
            return null;
          }
          return (
            <div key={section.kind} className="settings-model-kind" data-testid={`settings-model-kind-section-${section.kind}`}>
              <div className="settings-section__header">
                <h4 className="settings-section__title">
                  {section.title}{" "}
                  <span className="resource-list__count">{sectionModels.length}</span>
                </h4>
              </div>
              <p className="settings-section__description">{section.description}</p>
              <div className="settings-group" data-testid={`settings-model-list-${section.kind}`}>
                {sectionModels.length === 0 ? (
                  <div className="settings-row">
                    <span className="settings-row__description">
                      {availableModels.some((model) => model.kind === section.kind)
                        ? `No ${section.title.toLowerCase()} models match “${query.trim()}”.`
                        : `No connected ${section.title.toLowerCase()} models yet.`}
                    </span>
                  </div>
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
              </div>
            </div>
          );
        })}

        {visibleAvailable.length === 0 && availableModels.length === 0 ? (
          <div className="settings-group" data-testid="settings-model-list">
            <div className="settings-row">
              <span className="settings-row__description">
                No connected models available yet. Connect a provider to add models.
              </span>
            </div>
          </div>
        ) : null}
      </section>

      {unconnectedModels.length > 0 && (!searching || visibleUnconnected.length > 0) ? (
        <section className="settings-section">
          <div className="settings-section__header">
            <h3 className="settings-section__title">
              Not connected{" "}
              <span className="resource-list__count">{visibleUnconnected.length}</span>
            </h3>
            <button className="button button--secondary" type="button" onClick={onOpenProviders}>
              Connect a provider
            </button>
          </div>
          <p className="settings-section__description">
            Models from providers you have not signed in to.
          </p>
          {searching || showUnconnected ? (
            <div className="settings-group" data-testid="settings-unconnected-model-list">
              {visibleUnconnected.map((model) => (
                <ModelRow
                  isDefault={false}
                  key={`${model.kind}:${modelPattern(model)}`}
                  model={model}
                />
              ))}
            </div>
          ) : (
            <button
              className="resource-list__more"
              type="button"
              onClick={() => setShowUnconnected(true)}
            >
              Show {unconnectedModels.length} models
            </button>
          )}
        </section>
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
    <div className="settings-row model-row">
      <div className="settings-row__label">
        <div className="settings-row__title">
          {model.label}
          {isDefault ? <span className="model-row__badge">Default</span> : null}
          {model.kind !== "chat" ? (
            <span className="model-row__badge">{kindLabel(model.kind)}</span>
          ) : null}
        </div>
        <div className="settings-row__description">
          {model.providerName} · {modelPattern(model)}
          {model.reasoning ? <span className="model-row__tag">Reasoning</span> : null}
          {model.supportsImages ? <span className="model-row__tag">Images</span> : null}
        </div>
      </div>
      {children ? <div className="settings-row__control">{children}</div> : null}
    </div>
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

import { useMemo, useState } from "react";
import type { RuntimeSnapshot } from "@pi-garden/session-driver/runtime-types";
import {
  buildModelOptions,
  MODEL_OPTIONS_EMPTY_TITLE,
  THINKING_OPTIONS,
  type ComposerModelOption,
} from "./composer-commands";
import { Button } from "@/ui/shadcn/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from "@/ui/shadcn/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";

interface ModelSelectorProps {
  readonly runtime: RuntimeSnapshot | undefined;
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  /** Physical model under a virtual selection, when Pi reports one. */
  readonly routedModel?: { readonly provider: string; readonly model: string };
  readonly disabled?: boolean;
  readonly dropdownPlacement?: "above" | "below";
  readonly showEmptyModelControl?: boolean;
  readonly unselectedModelLabel?: string;
  readonly emptyModelLabel?: string;
  readonly emptyModelTitle?: string;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
}

export function ModelSelector({
  runtime,
  provider,
  modelId,
  thinkingLevel,
  routedModel,
  disabled,
  dropdownPlacement = "above",
  showEmptyModelControl = false,
  unselectedModelLabel = "Choose model",
  emptyModelLabel = "Choose model",
  emptyModelTitle = MODEL_OPTIONS_EMPTY_TITLE,
  onSetModel,
  onSetThinking,
}: ModelSelectorProps) {
  const [modelOpen, setModelOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const side = dropdownPlacement === "below" ? "bottom" : "top";

  const modelOptions = useMemo(() => {
    const options = buildModelOptions(runtime);
    const kindByKey = new Map(
      (runtime?.models ?? []).map((model) => [`${model.providerId}:${model.modelId}`, model.kind]),
    );
    // Thread picker stays chat/virtual; image + classifier belong in Settings.
    return options.filter((option) => {
      const kind = kindByKey.get(`${option.providerId}:${option.modelId}`) ?? "chat";
      return kind === "chat" || kind === "virtual";
    });
  }, [runtime]);
  const groupedModels = useMemo(() => groupByProvider(modelOptions), [modelOptions]);
  const hasMatchingModels = useMemo(
    () => modelOptions.some((option) => matchesModelFilter(option, modelFilter)),
    [modelOptions, modelFilter],
  );
  const hasAvailableModelOptions = modelOptions.length > 0;
  const hasModelControl = Boolean(provider && modelId) || hasAvailableModelOptions;
  const shouldRenderModelControl = hasModelControl || showEmptyModelControl;
  const selectionLabel = provider && modelId ? `${provider}:${modelId}` : undefined;
  const routedLabel =
    routedModel &&
    selectionLabel &&
    `${routedModel.provider}:${routedModel.model}` !== selectionLabel
      ? `${routedModel.provider}:${routedModel.model}`
      : undefined;
  const modelBadgeLabel = selectionLabel
    ? routedLabel
      ? `${selectionLabel} → ${routedLabel}`
      : selectionLabel
    : hasAvailableModelOptions
      ? unselectedModelLabel
      : emptyModelLabel;
  const noMatchingModels =
    hasAvailableModelOptions && modelFilter.trim().length > 0 && !hasMatchingModels;

  if (!shouldRenderModelControl && !thinkingLevel) {
    return null;
  }

  const activeKey = provider && modelId ? `${provider}:${modelId}` : undefined;
  const activeOption = modelOptions.find((option) => modelKey(option) === activeKey) ?? null;

  return (
    <span className="flex max-w-full min-w-0 flex-wrap items-center gap-1">
      {shouldRenderModelControl ? (
        <Combobox
          disabled={disabled}
          filter={matchesModelFilter}
          isItemEqualToValue={(item: ComposerModelOption, value: ComposerModelOption) =>
            modelKey(item) === modelKey(value)
          }
          itemToStringLabel={(option: ComposerModelOption) => option.label}
          items={groupedModels}
          open={modelOpen}
          value={activeOption}
          onInputValueChange={setModelFilter}
          onOpenChange={(next) => {
            setModelOpen(next);
            if (!next) setModelFilter("");
          }}
          onValueChange={(option: ComposerModelOption | null) => {
            if (option && modelKey(option) !== activeKey) {
              onSetModel(option.providerId, option.modelId);
            }
          }}
        >
          <ComboboxTrigger
            aria-label={modelBadgeLabel}
            render={
              <Button className="model-selector__badge max-w-full" size="sm" variant="secondary" />
            }
          >
            <span className="truncate">{modelBadgeLabel}</span>
          </ComboboxTrigger>
          <ComboboxContent
            className="model-selector__dropdown w-72"
            side={side}
            onWheel={(event) => event.stopPropagation()}
          >
            <ComboboxInput
              aria-label="Filter models"
              className="model-selector__filter-input"
              placeholder="Filter models..."
              showTrigger={false}
            />
            <ComboboxEmpty className="justify-start px-2 py-3 text-left">
              <div className="flex flex-col">
                <span className="font-medium">
                  {noMatchingModels ? "No matching models" : emptyModelTitle}
                </span>
                {noMatchingModels ? <span>Try a different filter.</span> : null}
              </div>
            </ComboboxEmpty>
            <ComboboxList>
              {(group: ModelGroup) => (
                <ComboboxGroup items={group.items} key={group.value}>
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(option: ComposerModelOption) => (
                      <ComboboxItem key={modelKey(option)} value={option}>
                        <span className="truncate">{option.label}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : null}
      {thinkingLevel ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            render={<Button className="model-selector__badge" size="sm" variant="secondary" />}
          >
            {thinkingLevel}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-80"
            side={side}
            onWheel={(event) => event.stopPropagation()}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Thinking level</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={thinkingLevel}
                onValueChange={(value: string) => {
                  if (value !== thinkingLevel) onSetThinking(value);
                }}
              >
                {THINKING_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem closeOnClick key={option.value} value={option.value}>
                    <span className="flex min-w-0 flex-col">
                      <span>{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </span>
  );
}

interface ModelGroup {
  readonly value: string;
  readonly items: readonly ComposerModelOption[];
}

function modelKey(option: ComposerModelOption): string {
  return `${option.providerId}:${option.modelId}`;
}

/** Matches the typed filter against the model label, description, or provider. */
function matchesModelFilter(option: ComposerModelOption, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    option.label.toLowerCase().includes(q) ||
    option.description.toLowerCase().includes(q) ||
    option.providerId.toLowerCase().includes(q)
  );
}

function groupByProvider(options: readonly ComposerModelOption[]): readonly ModelGroup[] {
  const groups = new Map<string, ComposerModelOption[]>();
  for (const option of options) {
    const existing = groups.get(option.providerId);
    if (existing) {
      existing.push(option);
    } else {
      groups.set(option.providerId, [option]);
    }
  }
  return Array.from(groups.entries()).map(([value, items]) => ({ value, items }));
}

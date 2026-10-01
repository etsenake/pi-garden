import { useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@pi-garden/session-driver/runtime-types";
import {
  buildModelOptions,
  MODEL_OPTIONS_EMPTY_TITLE,
  THINKING_OPTIONS,
  type ComposerModelOption,
} from "./composer-commands";
import { Button } from "@/ui/shadcn/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/shadcn/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";

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
  const filterRef = useRef<HTMLInputElement | null>(null);
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
  const filteredModels = useMemo(() => {
    if (!modelFilter) return modelOptions;
    const q = modelFilter.toLowerCase();
    return modelOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.description.toLowerCase().includes(q) ||
        opt.providerId.toLowerCase().includes(q),
    );
  }, [modelOptions, modelFilter]);

  const groupedModels = useMemo(() => groupByProvider(filteredModels), [filteredModels]);
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
    hasAvailableModelOptions && modelFilter.trim().length > 0 && groupedModels.length === 0;

  if (!shouldRenderModelControl && !thinkingLevel) {
    return null;
  }

  const activeKey = provider && modelId ? `${provider}:${modelId}` : undefined;

  return (
    <span className="flex max-w-full min-w-0 flex-wrap items-center gap-1">
      {shouldRenderModelControl ? (
        <Popover
          open={modelOpen}
          onOpenChange={(next) => {
            setModelOpen(next);
            if (!next) setModelFilter("");
          }}
        >
          <PopoverTrigger
            disabled={disabled}
            render={
              <Button className="model-selector__badge max-w-full" size="sm" variant="secondary" />
            }
          >
            <span className="truncate">{modelBadgeLabel}</span>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="model-selector__dropdown p-0"
            initialFocus={filterRef}
            side={side}
            onWheel={(event) => event.stopPropagation()}
          >
            <Command defaultValue={activeKey} label="Models" shouldFilter={false}>
              <CommandInput
                className="model-selector__filter-input"
                placeholder="Filter models..."
                ref={filterRef}
                value={modelFilter}
                onValueChange={setModelFilter}
              />
              <CommandList>
                <CommandEmpty className="px-2 py-3 text-left">
                  <div className="font-medium">
                    {noMatchingModels ? "No matching models" : emptyModelTitle}
                  </div>
                  {noMatchingModels ? (
                    <div className="text-muted-foreground">Try a different filter.</div>
                  ) : null}
                </CommandEmpty>
                {groupedModels.map((group) => (
                  <CommandGroup heading={group.provider} key={group.provider}>
                    {group.items.map((option) => {
                      const key = `${option.providerId}:${option.modelId}`;
                      const isActive = key === activeKey;
                      return (
                        <CommandItem
                          data-checked={isActive}
                          key={key}
                          value={key}
                          onSelect={() => {
                            if (!isActive) {
                              onSetModel(option.providerId, option.modelId);
                            }
                            setModelOpen(false);
                            setModelFilter("");
                          }}
                        >
                          <span className="truncate">{option.label}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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
  readonly provider: string;
  readonly items: readonly ComposerModelOption[];
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
  return Array.from(groups.entries()).map(([provider, items]) => ({ provider, items }));
}

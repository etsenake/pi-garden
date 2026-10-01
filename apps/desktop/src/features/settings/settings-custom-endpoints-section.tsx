import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  CUSTOM_PROVIDER_ID_PATTERN,
  isValidHttpBaseUrl,
} from "@pi-garden/pi-sdk-driver/custom-provider-types";
import type { CustomProviderConfig, CustomProviderModelConfig } from "../../../contracts/ipc";
import { Button } from "@/ui/shadcn/button";
import { Checkbox } from "@/ui/shadcn/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/ui/shadcn/field";
import { Input } from "@/ui/shadcn/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/ui/shadcn/input-group";
import { Item } from "@/ui/shadcn/item";
import { Label } from "@/ui/shadcn/label";
import { SettingsGroup, SettingsNote, SettingsRow } from "./settings-utils";

interface SettingsCustomEndpointsSectionProps {
  readonly existingProviderIds: readonly string[];
  readonly onSaveCustomProvider: (config: CustomProviderConfig) => Promise<string | undefined>;
  readonly onDeleteCustomProvider: (providerId: string) => Promise<string | undefined>;
}

type DialogMode =
  { kind: "closed" } | { kind: "create" } | { kind: "edit"; original: CustomProviderConfig };

export function SettingsCustomEndpointsSection({
  existingProviderIds,
  onSaveCustomProvider,
  onDeleteCustomProvider,
}: SettingsCustomEndpointsSectionProps) {
  const [entries, setEntries] = useState<readonly CustomProviderConfig[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [dialog, setDialog] = useState<DialogMode>({ kind: "closed" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const api = window.piApp;
    if (!api) {
      return;
    }
    let cancelled = false;
    void api
      .listCustomProviders()
      .then((list) => {
        if (!cancelled) {
          setEntries(list);
          setLoadError(undefined);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const handleSave = useCallback(
    async (config: CustomProviderConfig): Promise<string | undefined> => {
      const error = await onSaveCustomProvider(config);
      if (!error) {
        reload();
      }
      return error;
    },
    [onSaveCustomProvider, reload],
  );

  const handleDelete = useCallback(
    async (providerId: string) => {
      const error = await onDeleteCustomProvider(providerId);
      if (error) {
        setLoadError(error);
        return;
      }
      reload();
    },
    [onDeleteCustomProvider, reload],
  );

  return (
    <>
      <SettingsGroup
        title="Custom endpoints"
        description="Add OpenAI-compatible endpoints (Ollama, vLLM, or your own server). Stored in ~/.pi/agent/models.json."
      >
        {loadError ? <SettingsNote tone="warning">{loadError}</SettingsNote> : null}
        {entries.length === 0 ? (
          <SettingsNote>No custom endpoints yet.</SettingsNote>
        ) : (
          entries.map((entry) => (
            <SettingsRow
              key={entry.providerId}
              title={entry.providerId}
              description={`${entry.baseUrl} · ${entry.models.length} model${
                entry.models.length === 1 ? "" : "s"
              }`}
            >
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDialog({ kind: "edit", original: entry })}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void handleDelete(entry.providerId).catch((error: unknown) => {
                    setLoadError(error instanceof Error ? error.message : String(error));
                  })
                }
              >
                Remove
              </Button>
            </SettingsRow>
          ))
        )}
        <SettingsRow
          title="Add endpoint"
          description="Register a local or custom OpenAI-compatible server."
        >
          <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "create" })}>
            Add endpoint
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {dialog.kind !== "closed" ? (
        <CustomEndpointDialog
          mode={dialog}
          existingProviderIds={existingProviderIds}
          onClose={() => setDialog({ kind: "closed" })}
          onSave={handleSave}
        />
      ) : null}
    </>
  );
}

interface CustomEndpointDialogProps {
  readonly mode: Exclude<DialogMode, { kind: "closed" }>;
  readonly existingProviderIds: readonly string[];
  readonly onClose: () => void;
  readonly onSave: (config: CustomProviderConfig) => Promise<string | undefined>;
}

function CustomEndpointDialog({
  mode,
  existingProviderIds,
  onClose,
  onSave,
}: CustomEndpointDialogProps) {
  const initial = mode.kind === "edit" ? mode.original : undefined;
  const [providerId, setProviderId] = useState(initial?.providerId ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [models, setModels] = useState<CustomProviderModelConfig[]>(
    initial ? [...initial.models] : [],
  );
  const [probeCandidates, setProbeCandidates] = useState<readonly string[]>([]);
  const [probeError, setProbeError] = useState<string | undefined>();
  const [probePending, setProbePending] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();
  const [savePending, setSavePending] = useState(false);
  const providerIdInputId = useId();
  const baseUrlInputId = useId();
  const apiKeyInputId = useId();

  const selectedModelIds = useMemo(() => new Set(models.map((model) => model.id)), [models]);
  const isEdit = mode.kind === "edit";

  const idValidationError = useMemo(
    () => validateProviderId(providerId, existingProviderIds, initial?.providerId),
    [providerId, existingProviderIds, initial?.providerId],
  );

  const handleProbe = async () => {
    const api = window.piApp;
    if (!api) {
      setProbeError("Desktop bridge is not available.");
      return;
    }
    if (!isValidHttpBaseUrl(baseUrl)) {
      setProbeError("Base URL must start with http:// or https://");
      return;
    }
    setProbePending(true);
    setProbeError(undefined);
    const result = await api.probeCustomProviderModels({
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() ? apiKey.trim() : undefined,
    });
    setProbePending(false);
    if (!result.ok) {
      setProbeError(result.error);
      setProbeCandidates([]);
      return;
    }
    setProbeCandidates(result.models);
  };

  const toggleModel = (id: string, contextWindow?: number) => {
    setModels((current) => {
      const existing = current.find((model) => model.id === id);
      if (existing) {
        return current.filter((model) => model.id !== id);
      }
      return [...current, contextWindow !== undefined ? { id, contextWindow } : { id }];
    });
  };

  const handleManualAdd = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) {
      return;
    }
    if (selectedModelIds.has(trimmed)) {
      return;
    }
    setModels((current) => [...current, { id: trimmed }]);
  };

  const handleSave = async () => {
    if (idValidationError) {
      setFormError(idValidationError);
      return;
    }
    if (!isValidHttpBaseUrl(baseUrl)) {
      setFormError("Base URL must start with http:// or https://");
      return;
    }
    if (models.length === 0) {
      setFormError("Select at least one model.");
      return;
    }
    setSavePending(true);
    setFormError(undefined);
    const error = await onSave({
      providerId: providerId.trim(),
      baseUrl: baseUrl.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      models,
    });
    if (error) {
      setSavePending(false);
      setFormError(error);
      return;
    }
    onClose();
  };

  const showIdError = Boolean(idValidationError) && providerId.length > 0;

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !savePending) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden sm:max-w-xl"
        data-testid="custom-endpoint-dialog"
        showCloseButton={false}
      >
        <div
          className="custom-endpoint-dialog__content -mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-1"
          data-testid="custom-endpoint-dialog-content"
        >
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit custom endpoint" : "Add custom endpoint"}</DialogTitle>
            <DialogDescription>
              Configure an OpenAI-compatible server. The endpoint and API key are stored in
              plaintext at <code>~/.pi/agent/models.json</code>.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={showIdError ? true : undefined}>
              <FieldLabel htmlFor={providerIdInputId}>Provider ID</FieldLabel>
              <Input
                aria-invalid={showIdError ? true : undefined}
                disabled={isEdit || savePending}
                id={providerIdInputId}
                placeholder="ollama-local"
                value={providerId}
                onChange={(event) => setProviderId(event.target.value.trim().toLowerCase())}
              />
              {showIdError ? (
                <FieldError>{idValidationError}</FieldError>
              ) : (
                <FieldDescription>
                  Lowercase letters, digits, and dashes. Cannot be changed later.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor={baseUrlInputId}>Base URL</FieldLabel>
              <Input
                disabled={savePending}
                id={baseUrlInputId}
                placeholder="http://localhost:11434/v1"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
              <FieldDescription>
                Include the <code>/v1</code> suffix. Ollama: <code>http://localhost:11434/v1</code>.
                vLLM: <code>http://localhost:8000/v1</code>.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={apiKeyInputId}>API key</FieldLabel>
              <Input
                disabled={savePending}
                id={apiKeyInputId}
                placeholder="vLLM: pass through; Ollama: leave blank"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <FieldDescription>
                Required by the storage format. For vLLM started with <code>--api-key</code>, enter
                that key. For Ollama or other servers without auth, leave blank and a placeholder is
                saved.
              </FieldDescription>
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldTitle>Models</FieldTitle>
                <Button
                  disabled={probePending || savePending}
                  focusableWhenDisabled
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void handleProbe().catch((error: unknown) => {
                      setProbePending(false);
                      setProbeError(error instanceof Error ? error.message : String(error));
                    })
                  }
                >
                  {probePending ? "Detecting…" : "Detect models"}
                </Button>
              </div>
              {probeError ? <FieldError>{probeError}</FieldError> : null}
              <ModelChecklist
                probed={probeCandidates}
                selected={models}
                onToggle={toggleModel}
                onManualAdd={handleManualAdd}
                disabled={savePending}
              />
              <FieldDescription>
                Tool calling is required. Smaller models (&lt; 7B) often do not emit OpenAI-style
                function calls cleanly.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </div>

        <DialogFooter
          className="custom-endpoint-dialog__footer sm:items-center"
          data-testid="custom-endpoint-dialog-footer"
        >
          {formError ? <FieldError className="sm:mr-auto">{formError}</FieldError> : null}
          <Button disabled={savePending} variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              savePending || Boolean(idValidationError) || models.length === 0 || !baseUrl.trim()
            }
            onClick={() =>
              void handleSave().catch((error: unknown) => {
                setSavePending(false);
                setFormError(error instanceof Error ? error.message : String(error));
              })
            }
          >
            {isEdit ? "Save changes" : "Add endpoint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ModelChecklistProps {
  readonly probed: readonly string[];
  readonly selected: readonly CustomProviderModelConfig[];
  readonly onToggle: (id: string, contextWindow?: number) => void;
  readonly onManualAdd: (id: string) => void;
  readonly disabled: boolean;
}

function ModelChecklist({
  probed,
  selected,
  onToggle,
  onManualAdd,
  disabled,
}: ModelChecklistProps) {
  const [manualDraft, setManualDraft] = useState("");
  const selectedIds = useMemo(() => new Set(selected.map((model) => model.id)), [selected]);
  const knownIds = useMemo(
    () => new Set([...probed, ...selected.map((model) => model.id)]),
    [probed, selected],
  );

  const submitManual = () => {
    onManualAdd(manualDraft);
    setManualDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      {knownIds.size === 0 ? (
        <FieldDescription>
          Click &ldquo;Detect models&rdquo; or type a model ID below to add one manually.
        </FieldDescription>
      ) : (
        <ul className="custom-endpoint-model-list flex flex-col">
          {[...knownIds]
            .sort((a, b) => a.localeCompare(b))
            .map((id) => (
              <Item key={id} render={<li />} size="xs">
                {/* A native button keeps the explicit "Enable <id>" name; Base UI would
                    otherwise name a span checkbox from its wrapping label. */}
                <Label>
                  <Checkbox
                    aria-label={`Enable ${id}`}
                    checked={selectedIds.has(id)}
                    disabled={disabled}
                    nativeButton
                    onCheckedChange={() => onToggle(id)}
                    render={<button type="button" />}
                  />
                  {id}
                </Label>
              </Item>
            ))}
        </ul>
      )}
      <InputGroup>
        <InputGroupInput
          aria-label="Add model ID manually"
          disabled={disabled}
          placeholder="Add model ID manually"
          value={manualDraft}
          onChange={(event) => setManualDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitManual();
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            disabled={disabled || manualDraft.trim().length === 0}
            onClick={submitManual}
          >
            Add
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function validateProviderId(
  candidate: string,
  existing: readonly string[],
  editing?: string,
): string | undefined {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return "Provider ID is required.";
  }
  if (!CUSTOM_PROVIDER_ID_PATTERN.test(trimmed)) {
    return "Use lowercase letters, digits, and dashes (max 64 chars).";
  }
  if (trimmed !== editing && existing.includes(trimmed)) {
    return `Provider ID "${trimmed}" is already in use.`;
  }
  return undefined;
}

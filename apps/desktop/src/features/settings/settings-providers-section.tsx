import { useEffect, useMemo, useState } from "react";
import type {
  RuntimeProviderRecord,
  RuntimeSnapshot,
} from "@pi-garden/session-driver/runtime-types";
import type { CustomProviderConfig } from "../../../contracts/ipc";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Field, FieldError } from "@/ui/shadcn/field";
import { Input } from "@/ui/shadcn/input";
import { SettingsCustomEndpointsSection } from "./settings-custom-endpoints-section";
import {
  filterProviders,
  ProviderRow,
  SearchField,
  SettingsGroup,
  SettingsNote,
} from "./settings-utils";

interface SettingsProvidersSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onSetProviderApiKey: (providerId: string, apiKey: string) => Promise<string | undefined>;
  readonly onRemoveProviderApiKey: (providerId: string) => Promise<string | undefined>;
  readonly onSaveCustomProvider: (config: CustomProviderConfig) => Promise<string | undefined>;
  readonly onDeleteCustomProvider: (providerId: string) => Promise<string | undefined>;
}

const COLLAPSED_AVAILABLE_COUNT = 8;

/** Sign-in providers first, then API key providers, then the rest, each alphabetical. */
function compareAvailableProviders(left: RuntimeProviderRecord, right: RuntimeProviderRecord) {
  const rank = (provider: RuntimeProviderRecord) =>
    provider.oauthSupported ? 0 : provider.apiKeySetupSupported ? 1 : 2;
  return rank(left) - rank(right) || left.name.localeCompare(right.name);
}

export function SettingsProvidersSection({
  runtime,
  onLoginProvider,
  onLogoutProvider,
  onSetProviderApiKey,
  onRemoveProviderApiKey,
  onSaveCustomProvider,
  onDeleteCustomProvider,
}: SettingsProvidersSectionProps) {
  const [providerQuery, setProviderQuery] = useState("");
  const [showAllAvailable, setShowAllAvailable] = useState(false);
  const [apiKeyProviderId, setApiKeyProviderId] = useState<string | undefined>();
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | undefined>();
  const [apiKeyPending, setApiKeyPending] = useState(false);

  const providers = runtime?.providers ?? [];
  const connectedProviders = providers.filter((provider) => provider.hasAuth);
  const defaultProviderId = runtime?.settings.defaultProvider;
  const attentionProviders = providers.filter(
    (provider) => provider.id === defaultProviderId && !provider.hasAuth,
  );
  const availableProviders = providers
    .filter((provider) => !provider.hasAuth && provider.id !== defaultProviderId)
    .sort(compareAvailableProviders);
  const filteredAvailable = filterProviders(availableProviders, providerQuery);
  const expandAvailable = showAllAvailable || providerQuery.trim().length > 0;
  const shownAvailable = expandAvailable
    ? filteredAvailable
    : filteredAvailable.slice(0, COLLAPSED_AVAILABLE_COUNT);
  const hiddenAvailableCount = filteredAvailable.length - shownAvailable.length;
  const rowHandlers = {
    onLoginProvider,
    onLogoutProvider,
    onConfigureApiKey: (entry: RuntimeProviderRecord) => setApiKeyProviderId(entry.id),
  };
  const apiKeyProvider = apiKeyProviderId
    ? providers.find((provider) => provider.id === apiKeyProviderId)
    : undefined;
  const existingProviderIds = useMemo(() => providers.map((provider) => provider.id), [providers]);

  useEffect(() => {
    setApiKeyDraft("");
    setApiKeyError(undefined);
    setApiKeyPending(false);
  }, [apiKeyProviderId]);

  const closeApiKeyDialog = () => {
    if (apiKeyPending) {
      return;
    }
    setApiKeyProviderId(undefined);
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyProvider) {
      return;
    }
    setApiKeyPending(true);
    setApiKeyError(undefined);
    const nextError = await onSetProviderApiKey(apiKeyProvider.id, apiKeyDraft.trim());
    if (nextError) {
      setApiKeyPending(false);
      setApiKeyError(nextError);
      return;
    }
    setApiKeyProviderId(undefined);
  };

  const handleRemoveApiKey = async () => {
    if (!apiKeyProvider) {
      return;
    }
    setApiKeyPending(true);
    setApiKeyError(undefined);
    const nextError = await onRemoveProviderApiKey(apiKeyProvider.id);
    if (nextError) {
      setApiKeyPending(false);
      setApiKeyError(nextError);
      return;
    }
    setApiKeyProviderId(undefined);
  };

  return (
    <>
      {attentionProviders.length > 0 ? (
        <SettingsGroup
          title="Needs attention"
          description="Your default model uses this provider, but it is not connected."
        >
          {attentionProviders.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} {...rowHandlers} />
          ))}
        </SettingsGroup>
      ) : null}

      <SettingsGroup
        title="Connected"
        count={connectedProviders.length}
        description="pi picks models from connected providers first."
      >
        {connectedProviders.length > 0 ? (
          connectedProviders.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} {...rowHandlers} />
          ))
        ) : (
          <SettingsNote>No providers connected yet. Sign in or add an API key below.</SettingsNote>
        )}
      </SettingsGroup>

      <SettingsCustomEndpointsSection
        existingProviderIds={existingProviderIds}
        onSaveCustomProvider={onSaveCustomProvider}
        onDeleteCustomProvider={onDeleteCustomProvider}
      />

      <SettingsGroup
        title="Available"
        count={availableProviders.length}
        description="Sign in with OAuth or save an API key to connect a provider."
        actions={
          <SearchField label="Search providers" value={providerQuery} onChange={setProviderQuery} />
        }
        listTestId="settings-available-providers"
        footer={
          hiddenAvailableCount > 0 ? (
            <Button
              className="justify-self-start"
              size="sm"
              variant="ghost"
              onClick={() => setShowAllAvailable(true)}
            >
              Show {hiddenAvailableCount} more
            </Button>
          ) : null
        }
      >
        {shownAvailable.length > 0 ? (
          shownAvailable.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} {...rowHandlers} />
          ))
        ) : (
          <SettingsNote>
            {providerQuery.trim()
              ? `No providers match “${providerQuery.trim()}”.`
              : "Every provider is connected."}
          </SettingsNote>
        )}
      </SettingsGroup>

      {apiKeyProvider ? (
        <ProviderApiKeyDialog
          provider={apiKeyProvider}
          draft={apiKeyDraft}
          error={apiKeyError}
          pending={apiKeyPending}
          onChangeDraft={setApiKeyDraft}
          onClose={closeApiKeyDialog}
          onRemove={apiKeyProvider.authSource === "auth_file" ? handleRemoveApiKey : undefined}
          onSave={handleSaveApiKey}
        />
      ) : null}
    </>
  );
}

function ProviderApiKeyDialog({
  provider,
  draft,
  error,
  pending,
  onChangeDraft,
  onClose,
  onRemove,
  onSave,
}: {
  readonly provider: RuntimeSnapshot["providers"][number];
  readonly draft: string;
  readonly error?: string;
  readonly pending: boolean;
  readonly onChangeDraft: (value: string) => void;
  readonly onClose: () => void;
  readonly onRemove?: () => Promise<void>;
  readonly onSave: () => Promise<void>;
}) {
  const title = provider.authSource === "auth_file" ? "Manage API key" : "Set API key";
  const body =
    provider.authSource === "auth_file"
      ? `Replace or remove the saved API key for ${provider.name}.`
      : `Save an API key locally for ${provider.name}.`;

  const save = () =>
    void onSave().catch((error: unknown) => {
      console.error("[renderer] onSave failed", error);
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="provider-api-key-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <Field data-invalid={error ? true : undefined}>
          <Input
            aria-invalid={error ? true : undefined}
            aria-label={`${provider.name} API key`}
            disabled={pending}
            placeholder="Enter API key"
            type="password"
            value={draft}
            onChange={(event) => onChangeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim()) {
                event.preventDefault();
                save();
              }
            }}
          />
          {error ? <FieldError className="settings-warning">{error}</FieldError> : null}
        </Field>
        <DialogFooter>
          <Button disabled={pending} variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {onRemove ? (
            <Button
              disabled={pending}
              variant="destructive"
              onClick={() =>
                void onRemove().catch((error: unknown) => {
                  console.error("[renderer] onRemove failed", error);
                })
              }
            >
              Remove saved key
            </Button>
          ) : null}
          <Button disabled={pending || draft.trim().length === 0} onClick={save}>
            {provider.authSource === "auth_file" ? "Save key" : "Set API key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

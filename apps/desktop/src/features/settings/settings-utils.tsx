import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";
import type {
  RuntimeSettingsSnapshot,
  RuntimeSnapshot,
} from "@pi-garden/session-driver/runtime-types";
import { CircleAlertIcon, SearchIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/ui/shadcn/alert";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card } from "@/ui/shadcn/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/shadcn/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemSeparator,
  ItemTitle,
} from "@/ui/shadcn/item";

/** Run a settings action that resolves to an error message; rejections surface the same way. */
export function runSettingsAction(
  task: Promise<string | undefined>,
  onError: (message: string) => void,
): void {
  task.then(
    (message) => {
      if (message) onError(message);
    },
    (error: unknown) => onError(error instanceof Error ? error.message : String(error)),
  );
}

export const THINKING_LEVELS: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function labelForThinking(
  level: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
): string {
  if (level === "xhigh") {
    return "Extra High";
  }
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function filterProviders(
  providers: readonly RuntimeSnapshot["providers"][number][],
  query: string,
): readonly RuntimeSnapshot["providers"][number][] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return providers;
  }
  return providers.filter((provider) =>
    [provider.id, provider.name, provider.authType].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}

export function filterModels(
  models: readonly RuntimeSnapshot["models"][number][],
  query: string,
): readonly RuntimeSnapshot["models"][number][] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return models;
  }
  return models.filter((model) =>
    [model.providerId, model.providerName, model.modelId, model.label, model.kind].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}

/* ── Layout components ────────────────────────────────── */

/**
 * A titled settings section over a card of rows. The `settings-section*` and `settings-row*`
 * class names are stable hooks for Electron tests, not styling.
 */
export function SettingsGroup({
  title,
  count,
  description,
  actions,
  plain = false,
  listTestId,
  footer,
  children,
}: {
  readonly title?: string;
  /** Shown beside the title, such as how many rows the card holds. */
  readonly count?: ReactNode;
  readonly description?: string;
  /** Header controls aligned opposite the title, such as a search field. */
  readonly actions?: ReactNode;
  /** Lay children out without the card, for tiles and other custom content. */
  readonly plain?: boolean;
  readonly listTestId?: string;
  /** Content after the card, such as a "Show more" button. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  const heading = title ? (
    <h3 className="settings-section__title flex items-center gap-2">
      {title}
      {count !== undefined ? <Badge variant="secondary">{count}</Badge> : null}
    </h3>
  ) : null;
  return (
    <div className="settings-section">
      {actions ? (
        <div className="flex items-center justify-between gap-3">
          {heading}
          {actions}
        </div>
      ) : (
        heading
      )}
      {description ? <p className="settings-section__description">{description}</p> : null}
      {plain ? children : <SettingsCard data-testid={listTestId}>{children}</SettingsCard>}
      {footer}
    </div>
  );
}

/** Rows in one card, divided like Codex's grouped settings. */
export function SettingsCard({ children, ...props }: ComponentProps<typeof Card>) {
  return (
    <Card size="sm" className="gap-0 py-0" {...props}>
      {Children.toArray(children).map((row, index) => (
        <Fragment key={isValidElement(row) && row.key !== null ? row.key : index}>
          {index > 0 ? <ItemSeparator className="my-0" /> : null}
          {row}
        </Fragment>
      ))}
    </Card>
  );
}

export function SettingsRow({
  title,
  description,
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <Item className="settings-row">
      <ItemContent className="min-w-0">
        <ItemTitle className="settings-row__title">{title}</ItemTitle>
        {description ? (
          <ItemDescription className="line-clamp-none wrap-anywhere">{description}</ItemDescription>
        ) : null}
      </ItemContent>
      {children ? <ItemActions className="settings-row__control">{children}</ItemActions> : null}
    </Item>
  );
}

/** A card row holding only a sentence, such as an empty or warning state. */
export function SettingsNote({
  children,
  tone,
}: {
  readonly children: ReactNode;
  readonly tone?: "warning";
}) {
  return (
    <Item className="settings-row">
      <ItemContent className="min-w-0">
        {tone === "warning" ? (
          <Alert className="settings-warning" variant="destructive">
            <CircleAlertIcon />
            <AlertDescription className="wrap-anywhere">{children}</AlertDescription>
          </Alert>
        ) : (
          <ItemDescription className="line-clamp-none wrap-anywhere">{children}</ItemDescription>
        )}
      </ItemContent>
    </Item>
  );
}

/** A search box for filtering a settings list; the label doubles as the placeholder. */
export function SearchField({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <InputGroup className="w-60">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        placeholder={label}
        spellCheck={false}
        type="search"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </InputGroup>
  );
}

export function ProviderRow({
  provider,
  onLoginProvider,
  onLogoutProvider,
  onConfigureApiKey,
}: {
  readonly provider: RuntimeSnapshot["providers"][number];
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onConfigureApiKey: (provider: RuntimeSnapshot["providers"][number]) => void;
}) {
  const actions = resolveProviderActions(
    provider,
    onLoginProvider,
    onLogoutProvider,
    onConfigureApiKey,
  );
  return (
    <SettingsRow title={provider.name} description={describeProviderStatus(provider)}>
      {actions.length > 0
        ? actions.map((action) => (
            <Button
              disabled={action.disabled}
              key={action.label}
              size="sm"
              variant="secondary"
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))
        : null}
    </SettingsRow>
  );
}

function describeProviderStatus(provider: RuntimeSnapshot["providers"][number]): string {
  switch (provider.authSource) {
    case "oauth":
      return "OAuth · connected";
    case "auth_file":
      return "API key · connected";
    case "env":
      return "Environment variable · connected";
    case "external":
      return provider.hasAuth ? "Configured externally · connected" : "Configure externally";
    default:
      if (provider.oauthSupported) {
        return provider.apiKeySetupSupported ? "OAuth or API key" : "OAuth";
      }
      if (provider.apiKeySetupSupported) {
        return "API key";
      }
      return provider.authType === "api_key" ? "API key" : "Built in";
  }
}

interface ProviderAction {
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick?: () => void;
}

/** Providers like pi's OpenAI accept both OAuth and an API key, so both setups stay offered. */
function resolveProviderActions(
  provider: RuntimeSnapshot["providers"][number],
  onLoginProvider: (providerId: string) => void,
  onLogoutProvider: (providerId: string) => void,
  onConfigureApiKey: (provider: RuntimeSnapshot["providers"][number]) => void,
): readonly ProviderAction[] {
  if (provider.authSource === "oauth") {
    return [{ disabled: false, label: "Logout", onClick: () => onLogoutProvider(provider.id) }];
  }

  const actions: ProviderAction[] = [];
  if (provider.oauthSupported && provider.authSource === "none") {
    actions.push({
      disabled: false,
      label: provider.oauthLoginLabel ?? "Login",
      onClick: () => onLoginProvider(provider.id),
    });
  }
  if (
    provider.apiKeySetupSupported &&
    (provider.authSource === "none" || provider.authSource === "auth_file")
  ) {
    actions.push({
      disabled: false,
      label: provider.authSource === "auth_file" ? "Manage" : "Set API key",
      onClick: () => onConfigureApiKey(provider),
    });
  }
  if (actions.length > 0 || provider.authSource === "env" || provider.authSource === "external") {
    return actions;
  }
  return [{ disabled: true, label: "Configure externally" }];
}

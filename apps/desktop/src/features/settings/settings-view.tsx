import type { ReactNode } from "react";
import type {
  DesktopMcpServerRecord,
  RuntimeSettingsSnapshot,
  RuntimeSnapshot,
} from "@pi-garden/session-driver/runtime-types";
import type {
  ModelSettingsScopeMode,
  NotificationPreferences,
  WorkspaceRecord,
} from "../../../contracts/desktop-state";
import type {
  AddMcpServerInput,
  CustomProviderConfig,
  DesktopNotificationPermissionStatus,
  UpdateMcpServerInput,
} from "../../../contracts/ipc";
import type { ThemeCatalogEntry } from "../../../contracts/theme-catalog";
import { SettingsAppearanceSection } from "./settings-appearance-section";
import { SettingsGeneralSection } from "./settings-general-section";
import { SettingsMcpSection } from "./settings-mcp-section";
import { SettingsModelsSection } from "./settings-models-section";
import { SettingsNotificationsSection } from "./settings-notifications-section";
import { SettingsProvidersSection } from "./settings-providers-section";
import { type SettingsSection, settingsSectionDefinition } from "./settings-sections";
import { SettingsShortcutsSection } from "./settings-shortcuts-section";
import { SettingsToolsSection } from "./settings-tools-section";

export type { SettingsSection } from "./settings-sections";

interface SettingsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly section: SettingsSection;
  readonly platform: NodeJS.Platform;
  /** Shown beside the page title, such as the workspace a page edits. */
  readonly headerAccessory?: ReactNode;
  readonly onSelectSection: (section: SettingsSection) => void;
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly themeMode: "system" | "light" | "dark";
  readonly themePresetId: string;
  readonly themeCatalog: readonly ThemeCatalogEntry[];
  readonly enableTransparency: boolean;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetDefaultModel: (provider: string, modelId: string) => void;
  readonly onSetThinkingLevel: (
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onSetScopedModelPatterns: (patterns: readonly string[]) => void;
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onSetProviderApiKey: (providerId: string, apiKey: string) => Promise<string | undefined>;
  readonly onRemoveProviderApiKey: (providerId: string) => Promise<string | undefined>;
  readonly onSaveCustomProvider: (config: CustomProviderConfig) => Promise<string | undefined>;
  readonly onDeleteCustomProvider: (providerId: string) => Promise<string | undefined>;
  readonly onAddMcpServer: (input: AddMcpServerInput) => Promise<string | undefined>;
  readonly onRemoveMcpServer: (
    scope: DesktopMcpServerRecord["scope"],
    name: string,
  ) => Promise<string | undefined>;
  readonly onUpdateMcpServer: (input: UpdateMcpServerInput) => Promise<string | undefined>;
  readonly onSetProjectTrust: (trusted: boolean) => Promise<string | undefined>;
  readonly onSetDefaultTools: (entries: readonly string[]) => Promise<string | undefined>;
  readonly onSetPiBuiltinEnabled: (name: string, enabled: boolean) => Promise<string | undefined>;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
  readonly onSetThemeMode: (mode: "system" | "light" | "dark") => void;
  readonly onSetThemePresetId: (presetId: string) => void;
  readonly onSetEnableTransparency: (enabled: boolean) => void;
  readonly onAuthorGardenTheme?: () => void;
}

export function SettingsView({
  workspace,
  runtime,
  section,
  platform,
  headerAccessory,
  onSelectSection,
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  modelSettingsScopeMode,
  integratedTerminalShell,
  themeMode,
  themePresetId,
  themeCatalog,
  enableTransparency,
  onSetModelSettingsScopeMode,
  onSetDefaultModel,
  onSetThinkingLevel,
  onToggleSkillCommands,
  onSetScopedModelPatterns,
  onLoginProvider,
  onLogoutProvider,
  onSetProviderApiKey,
  onRemoveProviderApiKey,
  onSaveCustomProvider,
  onDeleteCustomProvider,
  onAddMcpServer,
  onRemoveMcpServer,
  onUpdateMcpServer,
  onSetProjectTrust,
  onSetDefaultTools,
  onSetPiBuiltinEnabled,
  onSetNotificationPreferences,
  onSetIntegratedTerminalShell,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
  onSetThemeMode,
  onSetThemePresetId,
  onSetEnableTransparency,
  onAuthorGardenTheme,
}: SettingsViewProps) {
  const definition = settingsSectionDefinition(section);
  const header = (
    <header className="view-header">
      <div>
        <h1 className="view-header__title">{definition.title}</h1>
        <p className="view-header__body">
          {definition.description(workspace?.name ?? "this workspace")}
        </p>
      </div>
      {headerAccessory ? <div className="view-header__actions">{headerAccessory}</div> : null}
    </header>
  );

  if (!workspace && definition.needsWorkspace) {
    return (
      <section className="canvas">
        <div className="conversation settings-view">
          {header}
          <div className="settings-group">
            <div className="settings-row">
              <div className="settings-row__label">
                <div className="settings-row__title">Select a workspace</div>
                <div className="settings-row__description">
                  Providers, models, MCP, and tools are set per workspace. Choose one, or open a
                  folder first.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="canvas">
      <div className="conversation settings-view">
        {header}

        <div className="settings-grid">
          {section === "appearance" ? (
            <SettingsAppearanceSection
              themeMode={themeMode}
              themePresetId={themePresetId}
              themeCatalog={themeCatalog}
              onSetThemeMode={onSetThemeMode}
              onSetThemePresetId={onSetThemePresetId}
              enableTransparency={enableTransparency}
              onSetEnableTransparency={onSetEnableTransparency}
              onAuthorGardenTheme={onAuthorGardenTheme}
            />
          ) : null}

          {section === "general" ? (
            <SettingsGeneralSection
              runtime={runtime}
              modelSettingsScopeMode={modelSettingsScopeMode}
              integratedTerminalShell={integratedTerminalShell}
              onSetModelSettingsScopeMode={onSetModelSettingsScopeMode}
              onSetIntegratedTerminalShell={onSetIntegratedTerminalShell}
              onToggleSkillCommands={onToggleSkillCommands}
            />
          ) : null}

          {section === "shortcuts" ? <SettingsShortcutsSection platform={platform} /> : null}

          {section === "providers" ? (
            <SettingsProvidersSection
              runtime={runtime}
              onLoginProvider={onLoginProvider}
              onLogoutProvider={onLogoutProvider}
              onSetProviderApiKey={onSetProviderApiKey}
              onRemoveProviderApiKey={onRemoveProviderApiKey}
              onSaveCustomProvider={onSaveCustomProvider}
              onDeleteCustomProvider={onDeleteCustomProvider}
            />
          ) : null}

          {section === "models" ? (
            <SettingsModelsSection
              runtime={runtime}
              onOpenProviders={() => onSelectSection("providers")}
              onSetDefaultModel={onSetDefaultModel}
              onSetScopedModelPatterns={onSetScopedModelPatterns}
              onSetThinkingLevel={onSetThinkingLevel}
            />
          ) : null}

          {section === "mcp" ? (
            <SettingsMcpSection
              runtime={runtime}
              onAddMcpServer={onAddMcpServer}
              onRemoveMcpServer={onRemoveMcpServer}
              onUpdateMcpServer={onUpdateMcpServer}
              onSetProjectTrust={onSetProjectTrust}
            />
          ) : null}

          {section === "tools" ? (
            <SettingsToolsSection
              runtime={runtime}
              onSetDefaultTools={onSetDefaultTools}
              onSetPiBuiltinEnabled={onSetPiBuiltinEnabled}
            />
          ) : null}

          {section === "notifications" ? (
            <SettingsNotificationsSection
              notificationPreferences={notificationPreferences}
              notificationPermissionStatus={notificationPermissionStatus}
              notificationPermissionPending={notificationPermissionPending}
              onSetNotificationPreferences={onSetNotificationPreferences}
              onRequestNotificationPermission={onRequestNotificationPermission}
              onOpenSystemNotificationSettings={onOpenSystemNotificationSettings}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

import type { DesktopNotificationPermissionStatus } from "../../../contracts/ipc";
import type { NotificationPreferences } from "../../../contracts/desktop-state";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { SettingsSwitch } from "./settings-controls";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsNotificationsSectionProps {
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
}

export function SettingsNotificationsSection({
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  onSetNotificationPreferences,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
}: SettingsNotificationsSectionProps) {
  const statusLabel = labelForPermissionStatus(notificationPermissionStatus);
  const statusDescription = descriptionForPermissionStatus(notificationPermissionStatus);
  const showAskMacOs = notificationPermissionStatus === "default";
  const showOpenSystemSettings = notificationPermissionStatus === "denied";
  const showRecoveryActions = showAskMacOs || showOpenSystemSettings;

  return (
    <>
      <SettingsGroup
        title="System"
        description="macOS decides whether pi-garden can show desktop notifications at all."
      >
        <SettingsRow title="macOS notification access" description={statusDescription}>
          <Badge variant={badgeVariantForPermissionStatus(notificationPermissionStatus)}>
            {statusLabel}
          </Badge>
        </SettingsRow>
        {showRecoveryActions ? (
          <SettingsRow
            title="Turn on notifications"
            description={
              showAskMacOs
                ? "pi-garden asks macOS when active work first moves into the background. You can also ask now."
                : "macOS notifications are already turned off for pi-garden. Open System Settings to enable them again."
            }
          >
            <div className="flex flex-wrap justify-end gap-2">
              {showAskMacOs ? (
                <Button
                  disabled={notificationPermissionPending}
                  size="sm"
                  variant="secondary"
                  onClick={onRequestNotificationPermission}
                >
                  Ask macOS
                </Button>
              ) : null}
              {showOpenSystemSettings ? (
                <Button
                  disabled={notificationPermissionPending}
                  size="sm"
                  variant="secondary"
                  onClick={onOpenSystemNotificationSettings}
                >
                  Open System Settings
                </Button>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title="In-app alerts"
        description="Choose which background events should try to notify once macOS access is enabled."
      >
        <SettingsRow
          title="Background completion"
          description="Notify when a background session finishes."
        >
          <SettingsSwitch
            checked={notificationPreferences.backgroundCompletion}
            label="Background completion"
            onChange={(checked) => onSetNotificationPreferences({ backgroundCompletion: checked })}
          />
        </SettingsRow>
        <SettingsRow
          title="Background failures"
          description="Notify when a background session fails."
        >
          <SettingsSwitch
            checked={notificationPreferences.backgroundFailure}
            label="Background failures"
            onChange={(checked) => onSetNotificationPreferences({ backgroundFailure: checked })}
          />
        </SettingsRow>
        <SettingsRow
          title="Needs input or approval"
          description="Notify when input is needed to continue."
        >
          <SettingsSwitch
            checked={notificationPreferences.attentionNeeded}
            label="Needs input or approval"
            onChange={(checked) => onSetNotificationPreferences({ attentionNeeded: checked })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function badgeVariantForPermissionStatus(
  status: DesktopNotificationPermissionStatus,
): "secondary" | "destructive" | "outline" {
  switch (status) {
    case "granted":
      return "secondary";
    case "denied":
      return "destructive";
    default:
      return "outline";
  }
}

function labelForPermissionStatus(status: DesktopNotificationPermissionStatus): string {
  switch (status) {
    case "granted":
      return "Enabled";
    case "denied":
      return "Turned off";
    case "default":
      return "Not enabled yet";
    case "unsupported":
      return "Unavailable";
    default:
      return "Checking…";
  }
}

function descriptionForPermissionStatus(status: DesktopNotificationPermissionStatus): string {
  switch (status) {
    case "granted":
      return "macOS will allow pi-garden to show desktop notifications for background thread updates.";
    case "denied":
      return "macOS notifications are turned off for pi-garden. Enable them in System Settings to receive background completion alerts.";
    case "default":
      return "pi-garden has not asked macOS for desktop notification access yet.";
    case "unsupported":
      return "Desktop notifications are unavailable on this system.";
    default:
      return "Checking whether macOS notifications are available for pi-garden.";
  }
}

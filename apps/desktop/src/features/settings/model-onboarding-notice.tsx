import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/ui/shadcn/alert";
import { Button } from "@/ui/shadcn/button";
import type { ModelOnboardingNotice } from "./model-onboarding";

interface ModelOnboardingNoticeBannerProps {
  readonly notice: ModelOnboardingNotice | undefined;
  readonly onOpenSettings: (section: ModelOnboardingNotice["actionSection"]) => void;
}

export function ModelOnboardingNoticeBanner({
  notice,
  onOpenSettings,
}: ModelOnboardingNoticeBannerProps) {
  if (!notice) {
    return null;
  }

  return (
    <Alert data-testid="model-onboarding-notice">
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>{notice.description}</AlertDescription>
      <AlertAction>
        <Button size="xs" variant="link" onClick={() => onOpenSettings(notice.actionSection)}>
          {notice.actionLabel}
        </Button>
      </AlertAction>
    </Alert>
  );
}

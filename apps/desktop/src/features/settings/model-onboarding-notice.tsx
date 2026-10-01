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
    <div className="model-onboarding-notice" data-testid="model-onboarding-notice">
      <div className="model-onboarding-notice__body">
        <span className="model-onboarding-notice__title">{notice.title}</span>
        <span className="model-onboarding-notice__description">{notice.description}</span>
      </div>
      <Button
        className="shrink-0"
        size="xs"
        variant="link"
        onClick={() => onOpenSettings(notice.actionSection)}
      >
        {notice.actionLabel}
      </Button>
    </div>
  );
}

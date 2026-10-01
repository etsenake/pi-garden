import type { SurfaceContributionPresentation } from "../../../contracts/surface-contributions";
import { HostContributionItem } from "./host-contributions";

export function HeaderBadges({
  badges,
  onInvokeAction,
}: {
  readonly badges: readonly SurfaceContributionPresentation[];
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  if (badges.length === 0) return null;

  return (
    <div aria-label="Extension badges" className="header-badges" data-testid="header-badges">
      {badges.map((badge) => (
        <HostContributionItem
          className="header-badge max-w-[12em]"
          contribution={badge}
          idAttribute="data-badge-id"
          key={badge.id}
          onInvokeAction={onInvokeAction}
        />
      ))}
    </div>
  );
}

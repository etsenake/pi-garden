import type { SurfaceContributionPresentation } from "../../../contracts/surface-contributions";
import { HostContributionItem } from "./host-contributions";

export function SidebarFooter({
  contributions,
  onInvokeAction,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  if (contributions.length === 0) return null;

  return (
    <div aria-label="Extension sidebar" className="sidebar__footer" data-testid="sidebar-footer">
      <div className="sidebar-footer-contributions">
        {contributions.map((contribution) => (
          <HostContributionItem
            className="sidebar-footer-contribution"
            contribution={contribution}
            idAttribute="data-contribution-id"
            key={contribution.id}
            onInvokeAction={onInvokeAction}
          />
        ))}
      </div>
    </div>
  );
}

import type { SurfaceContributionPresentation } from "../../../contracts/surface-contributions";

export function HeaderBadges({
  badges,
}: {
  readonly badges: readonly SurfaceContributionPresentation[];
}) {
  if (badges.length === 0) return null;

  return (
    <div aria-label="Extension badges" className="header-badges" data-testid="header-badges">
      {badges.map((badge) => (
        <span
          className="header-badge"
          data-badge-id={badge.id}
          data-order={badge.order}
          data-tone={badge.tone}
          key={badge.id}
          title={badge.text}
        >
          {badge.text}
        </span>
      ))}
    </div>
  );
}

import type { HeaderBadgePresentation } from "../../../contracts/header-badges";

export function HeaderBadges({ badges }: { readonly badges: readonly HeaderBadgePresentation[] }) {
  if (badges.length === 0) return null;

  return (
    <div aria-label="Extension badges" className="header-badges" data-testid="header-badges">
      {badges.map((badge) => (
        <span
          className="header-badge"
          data-badge-id={badge.id}
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

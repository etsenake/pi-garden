import type { SurfaceContributionPresentation } from "../../../contracts/surface-contributions";

export function SidebarFooter({
  contributions,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
}) {
  if (contributions.length === 0) return null;

  return (
    <div aria-label="Extension sidebar" className="sidebar__footer" data-testid="sidebar-footer">
      <div className="sidebar-footer-contributions">
        {contributions.map((contribution) => (
          <span
            className="sidebar-footer-contribution"
            data-contribution-id={contribution.id}
            data-order={contribution.order}
            data-tone={contribution.tone}
            key={contribution.id}
            title={contribution.text}
          >
            {contribution.text}
          </span>
        ))}
      </div>
    </div>
  );
}

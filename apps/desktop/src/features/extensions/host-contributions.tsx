import type { SurfaceContributionPresentation } from "../../../contracts/surface-contributions";

function HostContributions({
  contributions,
  testId,
  label,
  className,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
  readonly testId: string;
  readonly label: string;
  readonly className: string;
}) {
  if (contributions.length === 0) return null;

  return (
    <div aria-label={label} className={className} data-testid={testId}>
      {contributions.map((contribution) => (
        <span
          className="host-contribution"
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
  );
}

export function ComposerBeforeContributions({
  contributions,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
}) {
  return (
    <HostContributions
      className="composer-before"
      contributions={contributions}
      label="Composer before"
      testId="composer-before"
    />
  );
}

export function ComposerAfterContributions({
  contributions,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
}) {
  return (
    <HostContributions
      className="composer-after"
      contributions={contributions}
      label="Composer after"
      testId="composer-after"
    />
  );
}

export function SidebarSectionContributions({
  contributions,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
}) {
  return (
    <HostContributions
      className="sidebar__host-section"
      contributions={contributions}
      label="Sidebar section"
      testId="sidebar-section"
    />
  );
}

export function StatusChromeContributions({
  contributions,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
}) {
  return (
    <HostContributions
      className="status-chrome"
      contributions={contributions}
      label="Status"
      testId="status-chrome"
    />
  );
}

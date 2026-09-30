import type { SurfaceContributionPresentation } from "../../../contracts/surface-contributions";

function HostContributions({
  contributions,
  testId,
  label,
  className,
  onInvokeAction,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
  readonly testId: string;
  readonly label: string;
  readonly className: string;
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  if (contributions.length === 0) return null;

  return (
    <div aria-label={label} className={className} data-testid={testId}>
      {contributions.map((contribution) => (
        <HostContributionItem
          className="host-contribution"
          contribution={contribution}
          idAttribute="data-contribution-id"
          key={contribution.id}
          onInvokeAction={onInvokeAction}
        />
      ))}
    </div>
  );
}

export function HostContributionItem({
  contribution,
  className,
  idAttribute,
  onInvokeAction,
}: {
  readonly contribution: SurfaceContributionPresentation;
  readonly className: string;
  readonly idAttribute: string;
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  const actionId = contribution.actionId;
  const shared = {
    className,
    [idAttribute]: contribution.id,
    "data-order": contribution.order,
    "data-tone": contribution.tone,
    ...(actionId ? { "data-action-id": actionId } : {}),
    title: contribution.text,
  };
  if (actionId && onInvokeAction) {
    return (
      <button type="button" {...shared} onClick={() => onInvokeAction(actionId)}>
        {contribution.text}
      </button>
    );
  }
  return <span {...shared}>{contribution.text}</span>;
}

export function ComposerBeforeContributions({
  contributions,
  onInvokeAction,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  return (
    <HostContributions
      className="composer-before"
      contributions={contributions}
      label="Composer before"
      onInvokeAction={onInvokeAction}
      testId="composer-before"
    />
  );
}

export function ComposerAfterContributions({
  contributions,
  onInvokeAction,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  return (
    <HostContributions
      className="composer-after"
      contributions={contributions}
      label="Composer after"
      onInvokeAction={onInvokeAction}
      testId="composer-after"
    />
  );
}

export function SidebarSectionContributions({
  contributions,
  onInvokeAction,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  return (
    <HostContributions
      className="sidebar__host-section"
      contributions={contributions}
      label="Sidebar section"
      onInvokeAction={onInvokeAction}
      testId="sidebar-section"
    />
  );
}

export function StatusChromeContributions({
  contributions,
  onInvokeAction,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  return (
    <HostContributions
      className="status-chrome"
      contributions={contributions}
      label="Status"
      onInvokeAction={onInvokeAction}
      testId="status-chrome"
    />
  );
}

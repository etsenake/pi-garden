import { cn } from "@/lib/utils";
import { Badge } from "@/ui/shadcn/badge";
import type { SurfaceContributionPresentation } from "../../../contracts/surface-contributions";
import { toneBadge } from "./tone-badge";

function HostContributions({
  contributions,
  testId,
  label,
  className,
  itemClassName = "max-w-[12em]",
  onInvokeAction,
}: {
  readonly contributions: readonly SurfaceContributionPresentation[];
  readonly testId: string;
  readonly label: string;
  readonly className: string;
  readonly itemClassName?: string;
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  if (contributions.length === 0) return null;

  return (
    <div aria-label={label} className={className} data-testid={testId}>
      {contributions.map((contribution) => (
        <HostContributionItem
          className={itemClassName}
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
  /** Layout only, such as how wide the surface lets a contribution grow. */
  readonly className: string;
  readonly idAttribute: string;
  readonly onInvokeAction?: (actionId: string) => void;
}) {
  const actionId = contribution.actionId;
  const tone = toneBadge(contribution.tone);
  const shared = {
    className: cn(tone.className, actionId && onInvokeAction && "cursor-pointer", className),
    variant: tone.variant,
    [idAttribute]: contribution.id,
    "data-order": contribution.order,
    "data-tone": contribution.tone,
    ...(actionId ? { "data-action-id": actionId } : {}),
    title: contribution.text,
  };
  const label = <span className="truncate">{contribution.text}</span>;
  if (actionId && onInvokeAction) {
    return (
      <Badge {...shared} render={<button type="button" onClick={() => onInvokeAction(actionId)} />}>
        {label}
      </Badge>
    );
  }
  return <Badge {...shared}>{label}</Badge>;
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
      itemClassName="max-w-full"
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

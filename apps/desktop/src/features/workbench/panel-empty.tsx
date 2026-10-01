import type { ComponentProps, ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/shadcn/empty";
import { Spinner } from "@/ui/shadcn/spinner";

interface PanelEmptyProps extends Omit<ComponentProps<typeof Empty>, "title"> {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Shows a spinner; the surrounding element carries any status role. */
  readonly loading?: boolean;
  readonly media?: ReactNode;
  /** Actions such as Retry, shown under the message. */
  readonly children?: ReactNode;
}

/** The empty, loading and unavailable states of the workbench tools. */
export function PanelEmpty({
  title,
  description,
  loading = false,
  media,
  children,
  ...props
}: PanelEmptyProps) {
  return (
    <Empty {...props}>
      <EmptyHeader>
        {loading ? (
          <EmptyMedia>
            <Spinner aria-hidden="true" role="presentation" />
          </EmptyMedia>
        ) : media ? (
          <EmptyMedia variant="icon">{media}</EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

import type { ReactNode } from "react";
import { FolderIcon } from "../ui/icons";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/shadcn/empty";

interface WorkspaceEmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}

/** The main pane when there is no thread to show: no folder yet, or a folder with no thread open. */
export function WorkspaceEmptyState({ title, description, action }: WorkspaceEmptyStateProps) {
  return (
    <section className="canvas canvas--empty">
      <Empty className="empty-panel">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderIcon />
          </EmptyMedia>
          <EmptyTitle aria-level={1} role="heading">
            {title}
          </EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {action ? <EmptyContent>{action}</EmptyContent> : null}
      </Empty>
    </section>
  );
}

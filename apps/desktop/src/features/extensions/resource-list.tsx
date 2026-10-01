import { Fragment, useState, type ReactNode } from "react";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card } from "@/ui/shadcn/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/shadcn/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/ui/shadcn/item";
import { Switch } from "@/ui/shadcn/switch";

export interface ResourceListItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly enabled: boolean;
  /** Undefined when pi cannot change this item, such as a built-in extension. */
  readonly onToggle?: (enabled: boolean) => void;
}

export interface ResourceListGroup {
  readonly label: string;
  readonly items: readonly ResourceListItem[];
}

const COLLAPSED_ROW_COUNT = 6;

/** Cursor-style groups of Codex-style rows: icon, name, one-line description, switch. */
export function ResourceList({
  groups,
  icon,
  expanded,
  testId,
  onOpen,
}: {
  readonly groups: readonly ResourceListGroup[];
  readonly icon: ReactNode;
  /** Show every row, as while searching. */
  readonly expanded: boolean;
  readonly testId: string;
  readonly onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6" data-testid={testId}>
      {groups.map((group) => (
        <ResourceGroup
          expanded={expanded}
          group={group}
          icon={icon}
          key={group.label}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function ResourceGroup({
  group,
  icon,
  expanded,
  onOpen,
}: {
  readonly group: ResourceListGroup;
  readonly icon: ReactNode;
  readonly expanded: boolean;
  readonly onOpen: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = expanded || showAll ? group.items : group.items.slice(0, COLLAPSED_ROW_COUNT);
  const hiddenCount = group.items.length - visible.length;

  return (
    <section className="settings-section">
      <h3 className="settings-section__title flex items-center gap-2">
        {group.label} <Badge variant="secondary">{group.items.length}</Badge>
      </h3>
      <Card className="gap-0 py-0" size="sm">
        {visible.map((item, index) => (
          <Fragment key={item.id}>
            {index > 0 ? <ItemSeparator className="my-0" /> : null}
            <div className="flex items-center gap-2 pr-3">
              <Item
                className="min-w-0 flex-1 flex-nowrap text-left"
                data-resource-id={item.id}
                render={<button type="button" onClick={() => onOpen(item.id)} />}
              >
                <ItemMedia variant="icon">{icon}</ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>{item.title}</ItemTitle>
                  <ItemDescription className="line-clamp-1">{item.description}</ItemDescription>
                </ItemContent>
              </Item>
              <Switch
                aria-label={`Enable ${item.title}`}
                checked={item.enabled}
                disabled={!item.onToggle}
                onCheckedChange={(enabled) => item.onToggle?.(enabled)}
              />
            </div>
          </Fragment>
        ))}
      </Card>
      {hiddenCount > 0 ? (
        <Button
          className="justify-self-start"
          size="sm"
          variant="ghost"
          onClick={() => setShowAll(true)}
        >
          Show {hiddenCount} more
        </Button>
      ) : null}
    </section>
  );
}

export function ResourceEmptyState({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

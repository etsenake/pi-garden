import type { ScheduledTaskRecord } from "../../../contracts/desktop-state";
import { formatScheduledTaskRowMeta } from "../../../contracts/scheduled-tasks";
import { Button } from "@/ui/shadcn/button";
import { Item, ItemActions, ItemContent, ItemDescription } from "@/ui/shadcn/item";

interface ScheduledTaskChipProps {
  readonly task: ScheduledTaskRecord;
  readonly onOpen: () => void;
}

export function ScheduledTaskChip({ task, onOpen }: ScheduledTaskChipProps) {
  return (
    <Item
      className="mx-auto mb-2.5 w-[min(768px,calc(100%-48px))]"
      data-testid="scheduled-task-chip"
      size="sm"
      variant="muted"
    >
      <ItemContent className="min-w-0">
        <ItemDescription>{formatScheduledTaskRowMeta(task)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" type="button" variant="outline" onClick={onOpen}>
          Open
        </Button>
      </ItemActions>
    </Item>
  );
}

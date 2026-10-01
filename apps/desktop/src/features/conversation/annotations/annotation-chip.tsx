import { ChatIcon, CloseIcon } from "../../../ui/icons";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Item, ItemActions, ItemContent, ItemDescription } from "@/ui/shadcn/item";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";
import type { TranscriptAnnotation } from "./annotation-prompt";

/** "N annotations" above the composer; hovering or opening it lists each quote and comment. */
export function AnnotationChip({
  annotations,
  onRemove,
}: {
  readonly annotations: readonly TranscriptAnnotation[];
  readonly onRemove: (id: string) => void;
}) {
  if (annotations.length === 0) return null;
  const label = `${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`;
  return (
    <div className="annotation-chip" data-testid="annotation-chip">
      <Popover>
        <PopoverTrigger
          closeDelay={200}
          delay={0}
          openOnHover
          render={<Button size="sm" variant="outline" />}
        >
          <ChatIcon />
          {label}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-80 w-[min(420px,calc(100vw-48px))] gap-0.5 overflow-y-auto p-1.5"
          data-testid="annotation-chip-popover"
          side="top"
        >
          {annotations.map((annotation, index) => (
            <Item className="flex-nowrap items-start" key={annotation.id} size="xs">
              <Badge>{index + 1}</Badge>
              <ItemContent className="min-w-0">
                <ItemDescription className="line-clamp-3">{annotation.quote}</ItemDescription>
                {annotation.note ? <div className="break-words">{annotation.note}</div> : null}
              </ItemContent>
              <ItemActions>
                <Button
                  aria-label={`Remove annotation ${index + 1}`}
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => onRemove(annotation.id)}
                >
                  <CloseIcon />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

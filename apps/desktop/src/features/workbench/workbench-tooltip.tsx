import type { ReactElement, ReactNode } from "react";
import { Kbd } from "@/ui/shadcn/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";

/** Wraps one control (usually a shadcn Button) in a tooltip, with an optional shortcut. */
export function WithTooltip({
  label,
  shortcut,
  side = "bottom",
  children,
}: {
  readonly label: ReactNode;
  readonly shortcut?: string;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

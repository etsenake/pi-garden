import type { ReactElement, ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
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

/**
 * One tooltip shared by every row of a long list (file trees). Rows render a TooltipTrigger
 * with this handle and their text as payload, so a 2,000-row tree mounts one tooltip root,
 * not 2,000.
 */
export type SharedTooltipHandle = TooltipPrimitive.Handle<ReactNode>;

export function createSharedTooltip(): SharedTooltipHandle {
  return TooltipPrimitive.createHandle<ReactNode>();
}

export function SharedTooltip({
  handle,
  side = "left",
}: {
  readonly handle: SharedTooltipHandle;
  readonly side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip handle={handle}>
      {({ payload }) => <TooltipContent side={side}>{payload as ReactNode}</TooltipContent>}
    </Tooltip>
  );
}

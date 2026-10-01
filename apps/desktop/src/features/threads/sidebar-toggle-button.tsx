import { SidebarToggleIcon } from "../../ui/icons";
import { Button } from "@/ui/shadcn/button";
import { Kbd } from "@/ui/shadcn/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";

interface SidebarToggleButtonProps {
  readonly collapsed: boolean;
  readonly shortcutLabel: string;
  readonly onToggle: () => void;
}

export function SidebarToggleButton({
  collapsed,
  shortcutLabel,
  onToggle,
}: SidebarToggleButtonProps) {
  return (
    <div className="sidebar-toggle flex">
      <Tooltip disableHoverablePopup>
        <TooltipTrigger
          render={
            <Button
              aria-label="Toggle sidebar"
              aria-pressed={!collapsed}
              data-testid="sidebar-toggle"
              variant="ghost"
              size="icon-sm"
              onClick={onToggle}
            />
          }
        >
          <SidebarToggleIcon />
        </TooltipTrigger>
        <TooltipContent role="tooltip" side="bottom">
          <span>Toggle sidebar</span>
          <Kbd>{shortcutLabel}</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

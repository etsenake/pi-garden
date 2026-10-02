import { SidebarToggleIcon } from "../../ui/icons";
import { Button } from "@/ui/shadcn/button";
import { Kbd } from "@/ui/shadcn/kbd";
import { useSidebar } from "@/ui/shadcn/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";

interface SidebarToggleButtonProps {
  readonly shortcutLabel: string;
  readonly onToggle: () => void;
}

/**
 * The titlebar toggle. It reflects the SidebarProvider's open state but toggles
 * through the app command, which persists the flag and knows when the sidebar
 * may toggle (SidebarTrigger would flip the provider directly).
 */
export function SidebarToggleButton({ shortcutLabel, onToggle }: SidebarToggleButtonProps) {
  const { open } = useSidebar();
  return (
    <div className="sidebar-toggle flex">
      <Tooltip disableHoverablePopup>
        <TooltipTrigger
          render={
            <Button
              aria-label="Toggle sidebar"
              aria-pressed={open}
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

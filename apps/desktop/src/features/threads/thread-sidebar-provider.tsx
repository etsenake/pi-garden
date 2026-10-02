import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { SidebarProvider, useSidebar } from "@/ui/shadcn/sidebar";
import { PaneResizeHandle, type PaneWidthBounds } from "../../ui/pane-resize-handle";
import { usePersistedPaneWidth } from "../../ui/use-persisted-pane-width";

const SIDEBAR_WIDTH_RANGE = { min: 200, max: 520 } as const;
const DEFAULT_SIDEBAR_WIDTH = "236px";

function sidebarWidthBounds(_frame: HTMLElement, shell: HTMLElement): PaneWidthBounds {
  return {
    min: SIDEBAR_WIDTH_RANGE.min,
    max: Math.floor(Math.min(SIDEBAR_WIDTH_RANGE.max, shell.clientWidth * 0.45)),
  };
}

/**
 * The app shell as a shadcn SidebarProvider. The provider's open state is the
 * persisted `sidebarCollapsed` flag, and `--sidebar-width` is the width the user
 * dragged, so the stock Sidebar and SidebarInset lay themselves out from both.
 */
export function ThreadSidebarProvider({
  className,
  collapsed,
  onToggle,
  children,
}: {
  readonly className: string;
  readonly collapsed: boolean;
  /** The app's sidebar toggle; it persists the flag and knows when toggling is allowed. */
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  const [width, setWidth] = usePersistedPaneWidth("pi-garden.sidebar-width", SIDEBAR_WIDTH_RANGE);
  // A remembered width never crowds out the main area on a smaller window.
  const style = {
    "--sidebar-width": width === undefined ? DEFAULT_SIDEBAR_WIDTH : `min(${width}px, 45vw)`,
  } as CSSProperties;

  return (
    <SidebarProvider
      className={className}
      style={style}
      open={!collapsed}
      onOpenChange={(open) => {
        // The app's command router owns the Cmd/Ctrl+B chord (platform modifier,
        // terminal focus, main-process menu), so ignore the provider's own listener.
        if (window.event instanceof KeyboardEvent) return;
        if (open === collapsed) onToggle();
      }}
    >
      <MobileSheetSync collapsed={collapsed} onToggle={onToggle} />
      {children}
      {collapsed ? null : (
        <SidebarResizeFrame onResize={setWidth} onReset={() => setWidth(undefined)} />
      )}
    </SidebarProvider>
  );
}

/**
 * Below the mobile breakpoint the stock Sidebar is a Sheet with its own open
 * flag. Mirror the persisted flag into it, and treat dismissing the sheet
 * (backdrop, Escape) as collapsing the sidebar.
 */
function MobileSheetSync({
  collapsed,
  onToggle,
}: {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    if (isMobile) setOpenMobile(!collapsed);
  }, [isMobile, collapsed, setOpenMobile]);

  const wasOpen = useRef(openMobile);
  useEffect(() => {
    const dismissed = wasOpen.current && !openMobile;
    wasOpen.current = openMobile;
    if (isMobile && dismissed && !collapsed) onToggle();
  }, [isMobile, openMobile, collapsed, onToggle]);
  return null;
}

/**
 * A frame the size of the open sidebar that carries its resize handle on the
 * right edge. The handle measures its parent, and the frame keeps the shell as
 * the container whose width bounds the drag.
 */
function SidebarResizeFrame({
  onResize,
  onReset,
}: {
  readonly onResize: (width: number) => void;
  readonly onReset: () => void;
}) {
  const { isMobile } = useSidebar();
  if (isMobile) return null;
  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-30 w-(--sidebar-width)">
      <PaneResizeHandle
        className="sidebar__resize-handle"
        label="Sidebar width"
        controls="primary-sidebar"
        edge="right"
        bounds={sidebarWidthBounds}
        onResize={onResize}
        onReset={onReset}
      />
    </div>
  );
}

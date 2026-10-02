import { useRef, useState, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/ui/shadcn/resizable";
import { usePersistedPaneWidth } from "../../ui/use-persisted-pane-width";

const WIDTH = { min: 320, max: 1200, initial: 440 } as const;
const WORKBENCH_PANE = "workbench-pane";

/**
 * The conversation pane and, when open, the side workbench beside it. The width
 * a user drags is one window preference shared by all tools and tasks.
 */
export function WorkbenchSplit({
  className,
  children,
  workbench,
}: {
  readonly className: string;
  readonly children: ReactNode;
  readonly workbench: ReactNode;
}) {
  const [width, setWidth] = usePersistedPaneWidth("pi-garden.workbench-width", WIDTH);
  const group = useRef<HTMLDivElement>(null);
  return (
    <ResizablePanelGroup
      className="min-h-0 flex-1"
      orientation="horizontal"
      elementRef={group}
      onLayoutChanged={(layout, { isUserInteraction }) => {
        const percent = layout[WORKBENCH_PANE];
        if (!isUserInteraction || percent === undefined || !group.current) return;
        // Layouts are percentages of the panels' total width (separators excluded);
        // panel elements still show the previous split here, but their sum is current.
        let total = 0;
        for (const panel of group.current.querySelectorAll<HTMLElement>(":scope > [data-panel]"))
          total += panel.offsetWidth;
        setWidth(Math.round((percent / 100) * total));
      }}
    >
      <ResizablePanel
        id="conversation-pane"
        className={className}
        minSize="35%"
        style={{ overflow: "hidden" }}
      >
        {children}
      </ResizablePanel>
      {workbench ? (
        <>
          <ResizableHandle aria-label="Side panel width" />
          <WorkbenchPanel width={width ?? WIDTH.initial}>{workbench}</WorkbenchPanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

function WorkbenchPanel({
  width,
  children,
}: {
  readonly width: number;
  readonly children: ReactNode;
}) {
  // The saved width opens the panel; changing defaultSize later would re-register it.
  const [defaultSize] = useState(`${width}px`);
  return (
    <ResizablePanel
      id={WORKBENCH_PANE}
      defaultSize={defaultSize}
      minSize={`${WIDTH.min}px`}
      maxSize={`${WIDTH.max}px`}
      groupResizeBehavior="preserve-pixel-size"
      style={{ overflow: "hidden" }}
    >
      {children}
    </ResizablePanel>
  );
}

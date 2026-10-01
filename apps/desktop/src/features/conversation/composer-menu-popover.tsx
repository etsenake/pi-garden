import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Command, CommandList } from "@/ui/shadcn/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";

interface ComposerMenuPopoverProps {
  /** Test id for the popup, e.g. `slash-menu`. */
  readonly testId: string;
  /** Accessible name for the listbox. */
  readonly label: string;
  /** The `value` of the keyboard-selected item. */
  readonly selectedValue: string | undefined;
  readonly children: ReactNode;
}

/**
 * A composer suggestion menu (slash commands, @mentions, editor autocomplete) shown as a
 * shadcn Command list in a Popover above the composer editor. Render it only while the
 * menu is open, inside the `.composer__editor` box it anchors to.
 *
 * Focus stays in the editor: the textarea's key handlers own arrow/enter/tab/escape and
 * pass the selected item in as `selectedValue`, so the popover never takes or returns focus
 * and pointer hover does not move the selection.
 */
export function ComposerMenuPopover({
  testId,
  label,
  selectedValue,
  children,
}: ComposerMenuPopoverProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // cmdk only scrolls the selection into view for its own keyboard handling.
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[cmdk-item][data-selected='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedValue]);

  return (
    <Popover open>
      <PopoverTrigger
        aria-hidden
        nativeButton={false}
        render={<div className="pointer-events-none absolute inset-x-0 top-0 h-0" />}
        tabIndex={-1}
      />
      <PopoverContent
        align="start"
        className="w-(--anchor-width) p-0"
        data-testid={testId}
        finalFocus={false}
        initialFocus={false}
        side="top"
        sideOffset={12}
        onWheel={(event) => event.stopPropagation()}
      >
        <Command
          disablePointerSelection
          label={label}
          loop={false}
          shouldFilter={false}
          value={selectedValue ?? ""}
        >
          <CommandList className="max-h-[min(420px,48vh)]" ref={listRef}>
            {children}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

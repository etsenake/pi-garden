import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Command, CommandList } from "@/ui/shadcn/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";

interface ComposerMenuPopoverProps {
  /** Test id for the popup, e.g. `slash-menu`. */
  readonly testId: string;
  /** Accessible name for the listbox. */
  readonly label: string;
  /** The `value` of the selected item. */
  readonly selectedValue: string | undefined;
  /** Moves the selection to the item the pointer moves over. */
  readonly onSelectedValueChange: (value: string) => void;
  readonly children: ReactNode;
}

/**
 * A composer suggestion menu (slash commands, @mentions, editor autocomplete) shown as a
 * shadcn Command list in a Popover above the composer editor. Render it only while the
 * menu is open, inside the `.composer__editor` box it anchors to.
 *
 * Focus stays in the editor: the textarea's key handlers own arrow/enter/tab/escape and
 * pass the selected item in as `selectedValue`, so the popover never takes or returns focus.
 * Moving the pointer over a row selects it through `onSelectedValueChange`, so the one
 * highlighted row is always what Enter or Tab picks.
 */
export function ComposerMenuPopover({
  testId,
  label,
  selectedValue,
  onSelectedValueChange,
  children,
}: ComposerMenuPopoverProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // The row the pointer selected is already in view; scrolling it would slide rows under
  // the pointer and select those instead.
  const pointerValueRef = useRef<string | undefined>(undefined);

  // cmdk only scrolls the selection into view for its own keyboard handling.
  useLayoutEffect(() => {
    const fromPointer = selectedValue !== undefined && selectedValue === pointerValueRef.current;
    pointerValueRef.current = undefined;
    if (fromPointer) return;
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
          label={label}
          loop={false}
          shouldFilter={false}
          value={selectedValue ?? ""}
          onValueChange={(value) => {
            pointerValueRef.current = value;
            onSelectedValueChange(value);
          }}
        >
          <CommandList className="max-h-[min(420px,48vh)]" ref={listRef}>
            {children}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

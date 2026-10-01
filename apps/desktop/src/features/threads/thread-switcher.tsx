import { useEffect, useRef } from "react";
import { Command, CommandGroup, CommandItem, CommandList } from "@/ui/shadcn/command";
import type { ThreadSwitcherState } from "./hooks/use-thread-switcher";
import { sessionThreadKey } from "./thread-groups";

interface ThreadSwitcherProps {
  readonly state: ThreadSwitcherState;
  readonly onChoose: (index: number) => void;
}

export function ThreadSwitcher({ state, onChoose }: ThreadSwitcherProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const selected = state.entries[state.index];

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[aria-selected='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [state.index]);

  // Held Control drives selection from the window, so the list never takes focus
  // or follows the pointer; it only mirrors `state.index`.
  return (
    <div className="thread-switcher" data-testid="thread-switcher">
      <Command
        className="thread-switcher__panel h-auto w-full max-w-130 border shadow-md"
        disablePointerSelection
        shouldFilter={false}
        value={selected ? sessionThreadKey(selected) : ""}
      >
        <CommandList label="Recent threads" ref={listRef}>
          <CommandGroup heading="Switch thread">
            {state.entries.map((entry, index) => (
              <CommandItem
                key={sessionThreadKey(entry)}
                value={sessionThreadKey(entry)}
                onMouseDown={(event) => {
                  // Control-click opens the context menu on macOS; act on press instead.
                  event.preventDefault();
                  onChoose(index);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{entry.session.title}</span>
                <span className="max-w-[40%] truncate text-muted-foreground">
                  {entry.contextLabel}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/ui/shadcn/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Kbd, KbdGroup } from "@/ui/shadcn/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";

export interface PaletteItem {
  readonly id: string;
  readonly title: string;
  readonly titleMatches?: readonly number[];
  readonly detail?: string;
  readonly detailMatches?: readonly number[];
  readonly icon: ReactNode;
  readonly hint?: string;
  readonly run: () => void;
}

export interface PaletteSection {
  readonly id: string;
  readonly label: string;
  readonly items: readonly PaletteItem[];
}

export interface PaletteFilter<F extends string> {
  readonly id: F;
  readonly label: string;
}

interface CommandPaletteProps<F extends string> {
  readonly label: string;
  readonly placeholder: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly sections: readonly PaletteSection[];
  /** Shown in place of results when there are no items. */
  readonly emptyText: string;
  readonly filters?: readonly PaletteFilter<F>[];
  readonly activeFilter?: F;
  readonly onFilterChange?: (filter: F) => void;
  /** Results still reflect an older query; Enter waits until they catch up. */
  readonly settling?: boolean;
  /** Backspace on an empty query goes here, for nested lists. */
  readonly onBack?: () => void;
  readonly onClose: () => void;
}

export function CommandPalette<F extends string>({
  label,
  placeholder,
  query,
  onQueryChange,
  sections,
  emptyText,
  filters,
  activeFilter,
  onFilterChange,
  settling = false,
  onBack,
  onClose,
}: CommandPaletteProps<F>) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [enterQueued, setEnterQueued] = useState(false);
  const items = sections.flatMap((section) => section.items);
  const activePosition = Math.min(activeIndex, items.length - 1);
  const active = items[activePosition];

  // The dialog's own focus return would undo focus the picked item moved
  // (the composer, a file tab), so restore focus only when it was lost.
  useEffect(() => {
    const previousFocus = document.activeElement;
    return () => {
      const focusIsLost =
        !document.activeElement ||
        document.activeElement === document.body ||
        !document.activeElement.isConnected;
      if (focusIsLost && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [query, activeFilter, label]);

  useEffect(() => {
    if (enterQueued && !settling) {
      setEnterQueued(false);
      active?.run();
    }
  }, [active, enterQueued, settling]);

  const cycleFilter = (step: 1 | -1) => {
    if (!filters || filters.length === 0 || !onFilterChange) {
      return;
    }
    const current = filters.findIndex((filter) => filter.id === activeFilter);
    const next = filters[(current + step + filters.length) % filters.length];
    if (next) {
      onFilterChange(next.id);
    }
  };

  // cmdk handles arrows and Enter; these keys are ours, and preventDefault
  // keeps cmdk from also handling them.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    switch (event.key) {
      case "Enter":
        if (settling) {
          event.preventDefault();
          setEnterQueued(true);
        }
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      case "Tab":
        // Ctrl+Tab belongs to thread switching; leave it to the app.
        if (event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        event.preventDefault();
        cycleFilter(event.shiftKey ? -1 : 1);
        return;
      case "Backspace":
        if (query === "" && onBack) {
          event.preventDefault();
          onBack();
        }
        return;
      default:
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="top-[min(14vh,120px)] translate-y-0 gap-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl"
        finalFocus={false}
        initialFocus={inputRef}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{placeholder}</DialogDescription>
        </DialogHeader>
        <Command
          aria-label={label}
          data-testid="command-palette"
          label={placeholder}
          loop
          shouldFilter={false}
          value={active?.id ?? ""}
          vimBindings={false}
          onKeyDown={handleKeyDown}
          onValueChange={(value) => {
            const index = items.findIndex((item) => item.id === value);
            if (index >= 0) setActiveIndex(index);
          }}
        >
          {/* shadow-none matches shadcn's InputGroupInput; it drops the legacy
              base.css input focus ring inside the input group's own ring. */}
          <CommandInput
            ref={inputRef}
            className="shadow-none"
            data-testid="command-palette-input"
            placeholder={placeholder}
            value={query}
            onValueChange={onQueryChange}
          />

          {filters && filters.length > 0 && onFilterChange ? (
            <Tabs
              className="px-2 pt-2"
              value={activeFilter}
              onValueChange={(value: F) => onFilterChange(value)}
            >
              <TabsList aria-label="Filters" variant="line">
                {filters.map((filter) => (
                  <TabsTrigger
                    key={filter.id}
                    tabIndex={-1}
                    value={filter.id}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    {filter.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}

          <CommandList ref={listRef} className="max-h-[min(420px,calc(100vh-280px))]">
            <CommandEmpty data-testid="command-palette-empty">{emptyText}</CommandEmpty>
            {sections.map((section) =>
              section.items.length === 0 ? null : (
                <CommandGroup key={section.id} heading={section.label}>
                  {section.items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onSelect={() => item.run()}
                    >
                      {item.icon}
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="max-w-[70%] flex-none truncate">
                          <HighlightedText text={item.title} positions={item.titleMatches} />
                        </span>
                        {item.detail ? (
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            <HighlightedText text={item.detail} positions={item.detailMatches} />
                          </span>
                        ) : null}
                      </span>
                      {item.hint ? <CommandShortcut>{item.hint}</CommandShortcut> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
            )}
          </CommandList>

          <div
            aria-hidden="true"
            className="flex flex-wrap gap-4 border-t px-3 py-2 text-xs text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1">
              <KbdGroup>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
              Navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd> Open
            </span>
            {filters && filters.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Kbd>Tab</Kbd> Filters
              </span>
            ) : null}
            {onBack ? (
              <span className="inline-flex items-center gap-1">
                <Kbd>⌫</Kbd> Back
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Kbd>Esc</Kbd> Close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function HighlightedText({
  text,
  positions,
}: {
  readonly text: string;
  readonly positions?: readonly number[];
}) {
  if (!positions || positions.length === 0) {
    return <>{text}</>;
  }
  const marked = new Set(positions);
  const parts: ReactNode[] = [];
  let start = 0;
  while (start < text.length) {
    const isMatch = marked.has(start);
    let end = start + 1;
    while (end < text.length && marked.has(end) === isMatch) {
      end += 1;
    }
    const slice = text.slice(start, end);
    parts.push(
      isMatch ? (
        <mark key={start} className="bg-transparent font-semibold text-(--accent)">
          {slice}
        </mark>
      ) : (
        slice
      ),
    );
    start = end;
  }
  return <>{parts}</>;
}

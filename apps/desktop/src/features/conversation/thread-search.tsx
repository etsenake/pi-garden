import type { ReactNode, RefObject } from "react";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/ui/shadcn/input-group";
import { Kbd, KbdGroup } from "@/ui/shadcn/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";

interface ThreadSearchBarProps {
  readonly query: string;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onSearch: (query: string) => void;
  readonly onNext: () => void;
  readonly onPrev: () => void;
  readonly onClose: () => void;
}

export function ThreadSearchBar({
  query,
  matchCount,
  activeIndex,
  inputRef,
  onSearch,
  onNext,
  onPrev,
  onClose,
}: ThreadSearchBarProps) {
  return (
    <div className="thread-search-bar" data-testid="thread-search-bar">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search thread"
          ref={inputRef}
          type="text"
          placeholder="Search thread..."
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) {
                onPrev();
              } else {
                onNext();
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          {query ? (
            <InputGroupText className="tabular-nums">
              {matchCount > 0 ? `${activeIndex + 1} / ${matchCount}` : "0 results"}
            </InputGroupText>
          ) : null}
          <SearchBarButton
            disabled={matchCount === 0}
            hint={
              <KbdGroup>
                <Kbd>⇧</Kbd>
                <Kbd>↵</Kbd>
              </KbdGroup>
            }
            label="Previous match"
            onClick={onPrev}
          >
            <ChevronUpIcon />
          </SearchBarButton>
          <SearchBarButton
            disabled={matchCount === 0}
            hint={<Kbd>↵</Kbd>}
            label="Next match"
            onClick={onNext}
          >
            <ChevronDownIcon />
          </SearchBarButton>
          <SearchBarButton hint={<Kbd>Esc</Kbd>} label="Close search" onClick={onClose}>
            <XIcon />
          </SearchBarButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function SearchBarButton({
  label,
  hint,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly hint: ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            aria-label={label}
            disabled={disabled}
            size="icon-xs"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label} {hint}
      </TooltipContent>
    </Tooltip>
  );
}

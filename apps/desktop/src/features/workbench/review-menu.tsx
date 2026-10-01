import { Fragment, type ReactElement } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";

export interface ReviewMenuOption {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  /** Draws a divider above this option, grouping it with the options after it. */
  readonly startsGroup?: boolean;
}

interface ReviewMenuProps {
  readonly label: string;
  /** The trigger button; it should carry `label` as its accessible name. */
  readonly trigger: ReactElement;
  readonly align: "start" | "end";
  readonly options: readonly ReviewMenuOption[];
  readonly onSelect: (id: string) => void;
  /** Read-only lines shown above the options, such as the resolved comparison. */
  readonly details?: readonly string[];
}

/** A small single-choice menu for the Review toolbar. */
export function ReviewMenu({ label, trigger, align, options, onSelect, details }: ReviewMenuProps) {
  const checked = options.find((option) => option.checked)?.id ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align={align} aria-label={label} className="w-auto min-w-50">
        {details?.length ? (
          <>
            <DropdownMenuGroup data-testid="review-comparison-identity">
              {details.map((detail) => (
                <DropdownMenuLabel className="break-all" key={detail}>
                  {detail}
                </DropdownMenuLabel>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuRadioGroup value={checked}>
          {options.map((option) => (
            <Fragment key={option.id}>
              {option.startsGroup ? <DropdownMenuSeparator /> : null}
              <DropdownMenuRadioItem
                closeOnClick
                data-option-id={option.id}
                onClick={() => onSelect(option.id)}
                value={option.id}
              >
                {option.label}
              </DropdownMenuRadioItem>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

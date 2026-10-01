import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/shadcn/select";
import { Switch } from "@/ui/shadcn/switch";
import { ToggleGroup, ToggleGroupItem } from "@/ui/shadcn/toggle-group";

/** An on/off setting; exposes role="switch" with the label as its accessible name. */
export function SettingsSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <Switch
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onChange(next)}
    />
  );
}

export interface SettingsSegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** Two or three mutually exclusive options, shown inline like Codex's "Bottom | Right". */
export function SettingsSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly SettingsSegmentedOption<T>[];
  readonly value: T | undefined;
  readonly onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      size="sm"
      spacing={0}
      value={value === undefined ? [] : [value]}
      variant="outline"
      onValueChange={(next) => {
        // Pressing the active option would clear the group; a segmented control keeps one value.
        const selected = options.find((option) => option.value === next[0]);
        if (selected) onChange(selected.value);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function SettingsSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly SettingsSegmentedOption<T>[];
  readonly value: T | undefined;
  readonly onChange: (value: T) => void;
}) {
  // An unset or unknown value shows a placeholder rather than pretending the first option is chosen.
  const hasValue = options.some((option) => option.value === value);
  return (
    <Select
      items={options}
      value={hasValue ? value : null}
      onValueChange={(next) => {
        const selected = options.find((option) => option.value === next);
        if (selected) onChange(selected.value);
      }}
    >
      <SelectTrigger
        aria-label={label}
        className="max-w-64 min-w-36"
        data-value={hasValue ? value : undefined}
      >
        <SelectValue placeholder="Choose…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem data-value={option.value} key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

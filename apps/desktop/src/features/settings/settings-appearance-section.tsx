import type { ThemeMode } from "../../../contracts/desktop-state";
import { Button } from "@/ui/shadcn/button";
import { Field, FieldLabel, FieldTitle } from "@/ui/shadcn/field";
import { RadioGroup, RadioGroupItem } from "@/ui/shadcn/radio-group";
import { SettingsSelect, SettingsSwitch } from "./settings-controls";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import type { CSSProperties } from "react";
import type { ThemeCatalogEntry } from "../../../contracts/theme-catalog";
import { presentTheme, swatchesForTheme } from "../../../contracts/theme-catalog";
import { useActiveTheme } from "../../ui/active-theme";

interface SettingsAppearanceSectionProps {
  readonly themeMode: ThemeMode;
  readonly themePresetId: string;
  readonly themeCatalog: readonly ThemeCatalogEntry[];
  readonly onSetThemeMode: (mode: ThemeMode) => void;
  readonly onSetThemePresetId: (presetId: string) => void;
  readonly enableTransparency: boolean;
  readonly onSetEnableTransparency: (enabled: boolean) => void;
  readonly onAuthorGardenTheme?: () => void;
}

const THEME_MODES: readonly { readonly mode: ThemeMode; readonly label: string }[] = [
  { mode: "system", label: "System" },
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
];

export function SettingsAppearanceSection({
  themeMode,
  themePresetId,
  themeCatalog,
  onSetThemeMode,
  onSetThemePresetId,
  enableTransparency,
  onSetEnableTransparency,
  onAuthorGardenTheme,
}: SettingsAppearanceSectionProps) {
  const { variant } = useActiveTheme();
  const active = presentTheme(themeCatalog, themePresetId, variant);
  return (
    <>
      <SettingsGroup title="Theme" plain>
        <RadioGroup
          aria-label="Theme"
          className="theme-mode-tiles"
          style={tilePalette(themeCatalog, themePresetId)}
          value={themeMode}
          onValueChange={(value) => onSetThemeMode(value as ThemeMode)}
        >
          {THEME_MODES.map((option) => {
            const id = `theme-mode-${option.mode}`;
            return (
              <FieldLabel className="theme-mode-tile" htmlFor={id} key={option.mode}>
                <Field>
                  <span
                    aria-hidden="true"
                    className={`theme-mode-tile__preview theme-mode-tile__preview--${option.mode}`}
                  >
                    <span className="theme-mode-tile__window">
                      <span className="theme-mode-tile__line theme-mode-tile__line--title" />
                      <span className="theme-mode-tile__line" />
                      <span className="theme-mode-tile__line" />
                    </span>
                  </span>
                  <span className="flex items-center justify-center gap-2">
                    <RadioGroupItem id={id} value={option.mode} />
                    <FieldTitle className="theme-mode-tile__label">{option.label}</FieldTitle>
                  </span>
                </Field>
              </FieldLabel>
            );
          })}
        </RadioGroup>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow title="Color preset" description={active.description}>
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className="settings-preset-swatches">
              {swatchesForTheme(active).map((swatch, index) => (
                <span key={index} style={{ background: swatch }} />
              ))}
            </span>
            <SettingsSelect
              label="Color preset"
              options={themeCatalog.map((preset) => ({ value: preset.id, label: preset.name }))}
              value={themePresetId}
              onChange={onSetThemePresetId}
            />
          </span>
        </SettingsRow>
        {onAuthorGardenTheme ? (
          <SettingsRow
            title="Garden theme file"
            description="Author a pi-garden.theme/v1 document (seed + syntaxTheme). Pi CLI colors themes are not enough for desktop."
          >
            <Button
              data-testid="author-garden-theme"
              size="sm"
              variant="secondary"
              onClick={onAuthorGardenTheme}
            >
              Author Garden theme
            </Button>
          </SettingsRow>
        ) : null}
        <SettingsRow
          title="Window transparency"
          description="Let desktop colors show through supported surfaces."
        >
          <SettingsSwitch
            checked={enableTransparency}
            label="Window transparency"
            onChange={onSetEnableTransparency}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function tilePalette(catalog: readonly ThemeCatalogEntry[], themeId: string): CSSProperties {
  const light = presentTheme(catalog, themeId, "light");
  const dark = presentTheme(catalog, themeId, "dark");
  return {
    "--tile-light-bg": light.tokens["--sidebar"],
    "--tile-light-window": light.tokens["--main"],
    "--tile-light-line": light.tokens["--line-strong"],
    "--tile-dark-bg": dark.tokens["--sidebar"],
    "--tile-dark-window": dark.tokens["--main"],
    "--tile-dark-line": dark.tokens["--line-strong"],
  } as CSSProperties;
}

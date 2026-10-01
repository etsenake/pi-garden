import { expect, type Locator } from "@playwright/test";

// Settings selects are Base UI comboboxes, not native <select> elements. The trigger mirrors the
// chosen value on data-value, and the options render in a body-level listbox while it is open.

export async function chooseSettingsOption(
  trigger: Locator,
  option: { readonly label: string } | { readonly value: string },
): Promise<void> {
  const listbox = trigger.page().getByRole("listbox");
  await trigger.click();
  await expect(listbox).toBeVisible();
  const item =
    "label" in option
      ? listbox.getByRole("option", { name: option.label, exact: true })
      : listbox.locator(`[role="option"][data-value="${option.value}"]`);
  await item.click();
  await expect(listbox).toHaveCount(0);
}

export async function settingsOptionLabels(trigger: Locator): Promise<string[]> {
  const listbox = trigger.page().getByRole("listbox");
  await trigger.click();
  await expect(listbox).toBeVisible();
  const labels = await listbox.getByRole("option").allTextContents();
  await trigger.page().keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  return labels.map((label) => label.trim());
}

export async function expectSettingsValue(trigger: Locator, value: string): Promise<void> {
  await expect(trigger).toHaveAttribute("data-value", value);
}

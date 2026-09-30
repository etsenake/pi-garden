import { registerHeaderBadge, type DesktopExtensionAPI } from "@pi-garden/extension-ui";

/**
 * Minimal user/global Pi extension. Pi Garden renders the badge; this file
 * does not provide React, HTML, or CSS. Load it through Pi's normal discovery,
 * for example ~/.pi/agent/extensions/header-badge/index.ts or a user settings
 * `extensions` path, from a checkout where `@pi-garden/extension-ui` resolves.
 * Terminal Pi acknowledges nothing and shows no badge.
 */
export default function gardenHeaderBadge(pi: DesktopExtensionAPI): void {
  registerHeaderBadge(pi, { id: "garden", text: "Garden" });
}

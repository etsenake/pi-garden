import {
  registerHeaderBadge,
  type DesktopExtensionAPI,
  type HeaderBadgeTone,
} from "@pi-garden/extension-ui";

/**
 * Minimal user/global Pi extension. Pi Garden renders the badges and maps each
 * tone onto the active theme. This file does not provide React, HTML, or CSS.
 * Load it through Pi's normal discovery, for example
 * ~/.pi/agent/extensions/header-badge/index.ts or a user settings `extensions`
 * path, from a checkout where `@pi-garden/extension-ui` resolves.
 * Terminal Pi acknowledges nothing and shows no badge.
 */
const badges: readonly {
  readonly id: string;
  readonly text: string;
  readonly tone?: HeaderBadgeTone;
}[] = [
  { id: "garden", text: "Garden" },
  { id: "accent", text: "Accent", tone: "accent" },
  { id: "ready", text: "Ready", tone: "success" },
  { id: "attention", text: "Attention", tone: "warning" },
  { id: "failed", text: "Failed", tone: "error" },
  { id: "quiet", text: "Quiet", tone: "muted" },
];

export default function gardenHeaderBadge(pi: DesktopExtensionAPI): void {
  for (const badge of badges) registerHeaderBadge(pi, badge);
}

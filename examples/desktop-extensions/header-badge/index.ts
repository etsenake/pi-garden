import {
  registerComposerAfter,
  registerComposerBefore,
  registerHeaderBadge,
  registerSidebarFooter,
  registerSidebarSection,
  registerStatusChrome,
  type DesktopExtensionAPI,
  type HeaderBadgeTone,
} from "@pi-garden/extension-ui";

/**
 * Minimal user/global Pi extension. One extension contributes to every
 * host-rendered surface. Pi Garden renders the labels and maps each tone onto
 * the active theme. This file does not provide React, HTML, or CSS.
 *
 * Header order is Quiet, Garden, Attention, Ready, Accent, Failed.
 * Sidebar section order is Quiet, Lane, Ready, Alert.
 * Footer order is Built, Note, Root, Alert, Down, Mark.
 * Composer before is Before, then Ahead. Composer after is After, then Echo.
 * Status chrome is Live, then Chrome.
 * `garden` is registered in more than one place with different text.
 *
 * Load it through Pi's normal discovery, for example
 * ~/.pi/agent/extensions/header-badge/index.ts or a user settings `extensions`
 * path, from a checkout where `@pi-garden/extension-ui` resolves.
 * Terminal Pi acknowledges nothing and shows no contribution.
 */
interface Contribution {
  readonly id: string;
  readonly text: string;
  readonly tone?: HeaderBadgeTone;
  readonly order?: number;
}

const headerBadges: readonly Contribution[] = [
  { id: "quiet", text: "Quiet", tone: "muted", order: -1 },
  { id: "garden", text: "Garden" },
  { id: "attention", text: "Attention", tone: "warning", order: 1 },
  { id: "ready", text: "Ready", tone: "success", order: 1 },
  { id: "accent", text: "Accent", tone: "accent", order: 2 },
  { id: "failed", text: "Failed", tone: "error", order: 3 },
];

const sidebarSection: readonly Contribution[] = [
  { id: "quiet", text: "Quiet", tone: "muted", order: -1 },
  { id: "garden", text: "Lane", tone: "accent" },
  { id: "ready", text: "Ready", tone: "success", order: 1 },
  { id: "alert", text: "Alert", tone: "warning", order: 2 },
];

const sidebarFooter: readonly Contribution[] = [
  { id: "built", text: "Built", tone: "success" },
  { id: "note", text: "Note", tone: "muted" },
  { id: "garden", text: "Root", tone: "accent", order: 1 },
  { id: "alert", text: "Alert", tone: "warning", order: 2 },
  { id: "down", text: "Down", tone: "error", order: 3 },
  { id: "mark", text: "Mark", order: 4 },
];

const composerBefore: readonly Contribution[] = [
  { id: "lead", text: "Before", tone: "accent" },
  { id: "garden", text: "Ahead", order: 1 },
];

const composerAfter: readonly Contribution[] = [
  { id: "trail", text: "After", tone: "success" },
  { id: "echo", text: "Echo", tone: "muted", order: 1 },
];

const statusChrome: readonly Contribution[] = [
  { id: "live", text: "Live", tone: "warning" },
  { id: "garden", text: "Chrome", tone: "muted", order: 1 },
];

export default function gardenHeaderBadge(pi: DesktopExtensionAPI): void {
  for (const badge of headerBadges) registerHeaderBadge(pi, badge);
  for (const contribution of sidebarSection) registerSidebarSection(pi, contribution);
  for (const contribution of sidebarFooter) registerSidebarFooter(pi, contribution);
  for (const contribution of composerBefore) registerComposerBefore(pi, contribution);
  for (const contribution of composerAfter) registerComposerAfter(pi, contribution);
  for (const contribution of statusChrome) registerStatusChrome(pi, contribution);
}

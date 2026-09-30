/**
 * Extension-level desktop compatibility model.
 *
 * One browser-safe shape describes what a Pi extension asks its host for, how
 * that request was observed, and what pi-garden does with it. The command
 * compatibility records in `desktop-state.ts` stay separate: they are learned
 * per command when it runs. This inventory is per extension and is composed
 * from bounded static inspection plus runtime observations that belong to one
 * runtime generation.
 */

import type { RuntimeSourceInfo } from "@pi-garden/session-driver/runtime-types";

/**
 * Host capabilities pi-garden classifies. The identifier is stable and is the
 * key both the analyzer and the runtime observers report against.
 */
export type ExtensionCapabilityId =
  // Directly supported in pi-garden through Pi's own ctx.ui or registration APIs.
  | "ui.dialogs"
  | "ui.notify"
  | "ui.status"
  | "ui.widget.text"
  | "ui.working"
  | "ui.title"
  | "ui.editorText"
  | "ui.autocomplete"
  | "ui.toolsExpanded"
  | "ui.theme"
  | "pi.registerCommand"
  | "pi.registerShortcut"
  | "pi.registerTool"
  // Terminal-specific with a desktop adaptation target.
  | "ui.onTerminalInput"
  | "ui.widget.component"
  | "ui.setHeader"
  | "ui.setFooter"
  | "ui.custom"
  | "ui.setEditorComponent"
  | "tool.renderCall"
  | "tool.renderResult"
  | "tui.component"
  // Explicitly unsupported in this version.
  | "pi.registerMessageRenderer"
  | "pi.registerMarkdownTransformer"
  | "pi.registerEntryRenderer"
  | "pi.registerFlag"
  // pi-garden-native registrations from @pi-garden/extension-ui.
  | "garden.surfaceContribution"
  | "garden.registerAction"
  | "garden.registerRichSurface"
  | "garden.registerDesktopView"
  | "garden.registerDesktopToolRenderer"
  | "garden.registerDesktopEditor";

/**
 * - `supported`: Pi API that pi-garden serves directly.
 * - `desktop-native`: a pi-garden presentation the extension already supplies.
 * - `adaptable`: terminal-specific, with an existing desktop target to adapt to.
 * - `unsupported`: intentionally not served or adapted in this version.
 * - `unknown`: seen, but the analyzer could not decide.
 */
export type ExtensionCompatibilityStatus =
  "supported" | "desktop-native" | "adaptable" | "unsupported" | "unknown";

export interface ExtensionSourceEvidence {
  readonly kind: "source";
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** The call or import that matched, for display. */
  readonly snippet: string;
  /** True when the analyzer saw the shape but could not fully classify it. */
  readonly partial?: boolean;
}

/**
 * Runtime evidence belongs to one runtime generation. It is dropped when that
 * generation is invalidated (reload, disable, shutdown) and is never persisted.
 */
export interface ExtensionRuntimeEvidence {
  readonly kind: "runtime";
  readonly generation: string;
  readonly sessionId: string;
  readonly observedAt: string;
  /** How the observation was tied to this extension. */
  readonly attribution: "registration" | "call-site" | "reported";
  readonly detail?: string;
}

export type ExtensionCompatibilityEvidence = ExtensionSourceEvidence | ExtensionRuntimeEvidence;

export interface ExtensionCompatibilityFinding {
  readonly capability: ExtensionCapabilityId;
  readonly label: string;
  readonly status: ExtensionCompatibilityStatus;
  /** True when pi-garden serves the Pi API itself, without extension changes. */
  readonly directSupport: boolean;
  /** The pi-garden API that already covers this purpose, when one exists. */
  readonly desktopAnalogue?: string;
  /** Where "Adapt for Desktop" should map this capability. */
  readonly adaptationTarget?: string;
  /** Why the capability is unsupported in this version. */
  readonly unsupportedReason?: string;
  readonly evidence: readonly ExtensionCompatibilityEvidence[];
}

export type ExtensionSourceInspectionStatus =
  /** Every reachable local file parsed. */
  | "complete"
  /** Some files were skipped or failed to parse; findings may be incomplete. */
  | "partial"
  /** Nothing was inspected (package/cache locations, missing files). */
  | "skipped";

export interface ExtensionSourceInspection {
  readonly status: ExtensionSourceInspectionStatus;
  readonly files: readonly string[];
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
  readonly inspectedAt: string;
}

export interface ExtensionRuntimeInspection {
  /** Generations that contributed runtime evidence, one per live session. */
  readonly generations: readonly { readonly sessionId: string; readonly generation: string }[];
}

export type ExtensionAdaptationUnavailableReason =
  "builtin" | "package" | "temporary" | "untrusted-project" | "not-a-file" | "nothing-to-adapt";

export interface ExtensionAdaptationAvailability {
  readonly available: boolean;
  readonly reason?: ExtensionAdaptationUnavailableReason;
  readonly message: string;
}

export interface ExtensionCompatibilityInventory {
  readonly extensionPath: string;
  readonly workspaceId: string;
  readonly sourceInfo: RuntimeSourceInfo;
  readonly source: ExtensionSourceInspection;
  readonly runtime: ExtensionRuntimeInspection;
  readonly findings: readonly ExtensionCompatibilityFinding[];
  readonly adaptation: ExtensionAdaptationAvailability;
}

export interface ExtensionCompatibilityRequest {
  readonly workspaceId: string;
  readonly extensionPath: string;
  /** Re-run source inspection even when the entry file is unchanged. */
  readonly refresh?: boolean;
}

/** Runtime evidence for a workspace changed; the open detail should re-request. */
export interface ExtensionCompatibilityChange {
  readonly workspaceId: string;
}

export interface AdaptExtensionForDesktopInput {
  readonly workspaceId: string;
  readonly extensionPath: string;
}

/** The single canonical skill the "Adapt for Desktop" action invokes. */
export const ADAPT_FOR_DESKTOP_SKILL_NAME = "adapt-for-desktop";

interface CapabilityRule {
  readonly label: string;
  readonly status: ExtensionCompatibilityStatus;
  readonly directSupport: boolean;
  readonly desktopAnalogue?: string;
  readonly adaptationTarget?: string;
  readonly unsupportedReason?: string;
}

/**
 * Classification of every capability, shared by the analyzer, runtime observers
 * and the renderer so each capability has exactly one meaning.
 */
export const EXTENSION_CAPABILITY_RULES: Readonly<Record<ExtensionCapabilityId, CapabilityRule>> = {
  "ui.dialogs": {
    label: "Dialogs (select, confirm, input, editor)",
    status: "supported",
    directSupport: true,
  },
  "ui.notify": { label: "Notifications", status: "supported", directSupport: true },
  "ui.status": { label: "Status text", status: "supported", directSupport: true },
  "ui.widget.text": { label: "Text widgets", status: "supported", directSupport: true },
  "ui.working": { label: "Working indicator", status: "supported", directSupport: true },
  "ui.title": { label: "Title", status: "supported", directSupport: true },
  "ui.editorText": {
    label: "Editor text (set, get, paste)",
    status: "supported",
    directSupport: true,
  },
  "ui.autocomplete": { label: "Autocomplete provider", status: "supported", directSupport: true },
  "ui.toolsExpanded": { label: "Tool expansion", status: "supported", directSupport: true },
  "ui.theme": { label: "Themes", status: "supported", directSupport: true },
  "pi.registerCommand": { label: "Commands", status: "supported", directSupport: true },
  "pi.registerShortcut": { label: "Shortcuts", status: "supported", directSupport: true },
  "pi.registerTool": { label: "Tools", status: "supported", directSupport: true },
  "ui.onTerminalInput": {
    label: "Raw terminal input",
    status: "adaptable",
    directSupport: false,
    adaptationTarget:
      "registerAction / pi.registerShortcut, or focused rich-surface or editor keyboard handling",
  },
  "ui.widget.component": {
    label: "Component widget",
    status: "adaptable",
    directSupport: false,
    adaptationTarget:
      "registerRichSurface (composer-before, composer-after, sidebar or thread-header)",
  },
  "ui.setHeader": {
    label: "Terminal header",
    status: "adaptable",
    directSupport: false,
    adaptationTarget: "registerRichSurface app-header",
  },
  "ui.setFooter": {
    label: "Terminal footer",
    status: "adaptable",
    directSupport: false,
    adaptationTarget: "registerRichSurface app-footer",
  },
  "ui.custom": {
    label: "Custom terminal screen",
    status: "adaptable",
    directSupport: false,
    adaptationTarget: "registerRichSurface overlay, settings or workbench, by purpose",
  },
  "ui.setEditorComponent": {
    label: "Custom terminal editor",
    status: "adaptable",
    directSupport: false,
    adaptationTarget: "registerDesktopEditor",
  },
  "tool.renderCall": {
    label: "Tool call renderer",
    status: "adaptable",
    directSupport: false,
    adaptationTarget: "registerDesktopToolRenderer",
  },
  "tool.renderResult": {
    label: "Tool result renderer",
    status: "adaptable",
    directSupport: false,
    adaptationTarget: "registerDesktopToolRenderer",
  },
  "tui.component": {
    label: "Terminal UI components",
    status: "adaptable",
    directSupport: false,
    adaptationTarget: "registerRichSurface or registerDesktopEditor, by purpose",
  },
  "pi.registerMessageRenderer": {
    label: "Message renderer",
    status: "unsupported",
    directSupport: false,
    unsupportedReason: "Transcript customization is not adapted in this version.",
  },
  "pi.registerMarkdownTransformer": {
    label: "Markdown transformer",
    status: "unsupported",
    directSupport: false,
    unsupportedReason: "Transcript customization is not adapted in this version.",
  },
  "pi.registerEntryRenderer": {
    label: "Entry renderer",
    status: "unsupported",
    directSupport: false,
    unsupportedReason: "Transcript customization is not adapted in this version.",
  },
  "pi.registerFlag": {
    label: "CLI flags",
    status: "unsupported",
    directSupport: false,
    unsupportedReason: "Pi flags are not a desktop UI target.",
  },
  "garden.surfaceContribution": {
    label: "Surface Registry contribution",
    status: "desktop-native",
    directSupport: true,
    desktopAnalogue: "registerHeaderBadge / registerSidebarSection / registerStatusChrome …",
  },
  "garden.registerAction": {
    label: "Desktop action",
    status: "desktop-native",
    directSupport: true,
    desktopAnalogue: "registerAction",
  },
  "garden.registerRichSurface": {
    label: "Rich surface",
    status: "desktop-native",
    directSupport: true,
    desktopAnalogue: "registerRichSurface",
  },
  "garden.registerDesktopView": {
    label: "Workbench view",
    status: "desktop-native",
    directSupport: true,
    desktopAnalogue: "registerDesktopView",
  },
  "garden.registerDesktopToolRenderer": {
    label: "Desktop tool renderer",
    status: "desktop-native",
    directSupport: true,
    desktopAnalogue: "registerDesktopToolRenderer",
  },
  "garden.registerDesktopEditor": {
    label: "Desktop editor",
    status: "desktop-native",
    directSupport: true,
    desktopAnalogue: "registerDesktopEditor",
  },
};

export const EXTENSION_CAPABILITY_IDS = Object.keys(
  EXTENSION_CAPABILITY_RULES,
) as readonly ExtensionCapabilityId[];

export function isExtensionCapabilityId(value: unknown): value is ExtensionCapabilityId {
  return typeof value === "string" && value in EXTENSION_CAPABILITY_RULES;
}

/**
 * Builds one finding from evidence. Partial source evidence with no confident
 * hit downgrades the status to `unknown` so an uncertain parse never claims
 * support or adaptability.
 */
export function buildCompatibilityFinding(
  capability: ExtensionCapabilityId,
  evidence: readonly ExtensionCompatibilityEvidence[],
): ExtensionCompatibilityFinding {
  const rule = EXTENSION_CAPABILITY_RULES[capability];
  const confident = evidence.some((item) => item.kind === "runtime" || !item.partial);
  return {
    capability,
    label: rule.label,
    status: confident ? rule.status : "unknown",
    directSupport: rule.directSupport,
    ...(rule.desktopAnalogue ? { desktopAnalogue: rule.desktopAnalogue } : {}),
    ...(rule.adaptationTarget ? { adaptationTarget: rule.adaptationTarget } : {}),
    ...(rule.unsupportedReason ? { unsupportedReason: rule.unsupportedReason } : {}),
    evidence,
  };
}

const STATUS_ORDER: Readonly<Record<ExtensionCompatibilityStatus, number>> = {
  adaptable: 0,
  unsupported: 1,
  unknown: 2,
  "desktop-native": 3,
  supported: 4,
};

/** Adaptable first so the detail page leads with what the action would change. */
export function compareCompatibilityFindings(
  left: ExtensionCompatibilityFinding,
  right: ExtensionCompatibilityFinding,
): number {
  return (
    STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.label.localeCompare(right.label)
  );
}

/** Findings whose capability the Adapt for Desktop skill would map. */
export function adaptableFindings(
  findings: readonly ExtensionCompatibilityFinding[],
): readonly ExtensionCompatibilityFinding[] {
  return findings.filter((finding) => finding.status === "adaptable");
}

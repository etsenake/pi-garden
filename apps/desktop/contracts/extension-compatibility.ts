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
 * - `adapted`: that terminal capability is paired, in generated metadata, with one
 *   registration the source actually contains. A rich surface that exists on its
 *   own does not make a terminal finding adapted.
 * - `unsupported`: intentionally not served or adapted in this version.
 * - `unknown`: seen, but the analyzer could not decide.
 */
export type ExtensionCompatibilityStatus =
  "supported" | "desktop-native" | "adaptable" | "adapted" | "unsupported" | "unknown";

/** Desktop registration APIs a generated adaptation may name. */
export const DESKTOP_REGISTRATION_APIS = [
  "registerRichSurface",
  "registerAction",
  "registerDesktopView",
  "registerDesktopToolRenderer",
  "registerDesktopEditor",
] as const;

export type DesktopRegistrationApi = (typeof DESKTOP_REGISTRATION_APIS)[number];

/** Identity of one `register*` call, taken from its object-literal argument. */
export interface ExtensionSourceRegistration {
  readonly api: DesktopRegistrationApi;
  readonly id: string;
  readonly surface?: string;
  readonly toolName?: string;
}

/** `desktop-adaptation.json`, written beside the extension entry by Adapt for Desktop. */
export const DESKTOP_ADAPTATION_METADATA_NAME = "desktop-adaptation.json";

export interface DesktopAdaptationPair {
  readonly capability: ExtensionCapabilityId;
  readonly api: DesktopRegistrationApi;
  readonly id: string;
  readonly surface?: string;
  readonly toolName?: string;
}

export interface DesktopAdaptationMetadata {
  readonly version: 1;
  readonly pairs: readonly DesktopAdaptationPair[];
}

/** The registration a terminal finding is paired with. */
export interface ExtensionAdaptationLink {
  readonly api: DesktopRegistrationApi;
  readonly id: string;
  readonly surface?: string;
  readonly toolName?: string;
  readonly metadataFile: string;
}

export interface ExtensionSourceEvidence {
  readonly kind: "source";
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** The call or import that matched, for display. */
  readonly snippet: string;
  /** True when the analyzer saw the shape but could not fully classify it. */
  readonly partial?: boolean;
  /** Set on a garden `register*` call whose id (and surface or tool, when present) is a literal. */
  readonly registration?: ExtensionSourceRegistration;
  /** Pi tool `name` literal on a `renderCall` / `renderResult` property. */
  readonly toolName?: string;
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
  /** Present only when status is `adapted`. */
  readonly adaptedBy?: ExtensionAdaptationLink;
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
  adapted: 1,
  unsupported: 2,
  unknown: 3,
  "desktop-native": 4,
  supported: 5,
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

const REGISTRATION_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

function isDesktopRegistrationApi(value: unknown): value is DesktopRegistrationApi {
  return (
    typeof value === "string" && (DESKTOP_REGISTRATION_APIS as readonly string[]).includes(value)
  );
}

function optionalLiteral(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Reads generated adaptation metadata. A bad file is ignored, not treated as adapted. */
export function parseDesktopAdaptationMetadata(
  value: unknown,
): DesktopAdaptationMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { version?: unknown; pairs?: unknown };
  if (record.version !== 1 || !Array.isArray(record.pairs)) return undefined;
  const pairs: DesktopAdaptationPair[] = [];
  for (const item of record.pairs) {
    if (!item || typeof item !== "object") continue;
    const pair = item as {
      capability?: unknown;
      api?: unknown;
      id?: unknown;
      surface?: unknown;
      toolName?: unknown;
    };
    if (!isExtensionCapabilityId(pair.capability) || !isDesktopRegistrationApi(pair.api)) continue;
    if (typeof pair.id !== "string" || !REGISTRATION_ID_PATTERN.test(pair.id)) continue;
    const surface = optionalLiteral(pair.surface);
    const toolName = optionalLiteral(pair.toolName);
    pairs.push({
      capability: pair.capability,
      api: pair.api,
      id: pair.id,
      ...(surface ? { surface } : {}),
      ...(toolName ? { toolName } : {}),
    });
  }
  return { version: 1, pairs };
}

function registrationMatches(
  evidence: ExtensionCompatibilityEvidence,
  pair: DesktopAdaptationPair,
): boolean {
  if (evidence.kind !== "source" || evidence.partial || !evidence.registration) return false;
  const registration = evidence.registration;
  if (registration.api !== pair.api || registration.id !== pair.id) return false;
  if (pair.surface !== undefined && registration.surface !== pair.surface) return false;
  if (pair.toolName !== undefined && registration.toolName !== pair.toolName) return false;
  return true;
}

/**
 * Upgrades an adaptable finding to `adapted` only when metadata names that
 * capability and some source registration has the same api, id, surface and
 * tool. Runtime evidence and an unrelated registration do not count.
 */
export function linkAdaptedFindings(
  findings: readonly ExtensionCompatibilityFinding[],
  metadata: DesktopAdaptationMetadata | undefined,
  metadataFile: string,
): ExtensionCompatibilityFinding[] {
  if (!metadata) return [...findings];
  return findings.map((finding) => {
    if (finding.status !== "adaptable") return finding;
    const pair = metadata.pairs.find((item) => item.capability === finding.capability);
    if (!pair) return finding;
    const matched = findings.some((candidate) =>
      candidate.evidence.some((item) => registrationMatches(item, pair)),
    );
    if (!matched) return finding;
    return {
      ...finding,
      status: "adapted",
      adaptedBy: {
        api: pair.api,
        id: pair.id,
        ...(pair.surface ? { surface: pair.surface } : {}),
        ...(pair.toolName ? { toolName: pair.toolName } : {}),
        metadataFile,
      },
    };
  });
}

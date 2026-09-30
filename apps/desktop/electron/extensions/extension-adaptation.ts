import path from "node:path";
import type { RuntimeExtensionRecord } from "@pi-garden/session-driver/runtime-types";
import type { DesktopAppState, StartThreadInput } from "../../contracts/desktop-state";
import {
  ADAPT_FOR_DESKTOP_SKILL_NAME,
  type AdaptExtensionForDesktopInput,
  type ExtensionCompatibilityFinding,
  type ExtensionCompatibilityInventory,
  type ExtensionCompatibilityRequest,
} from "../../contracts/extension-compatibility";
import type {
  ExtensionCompatibilityOwner,
  ExtensionCompatibilityWorkspace,
} from "./extension-compatibility-owner";

/**
 * "Adapt for Desktop" is an ordinary Pi conversation. The action composes one
 * `/skill:adapt-for-desktop` prompt carrying the exact target, its scope and the
 * current findings, and starts a normal thread in that workspace. Pi expands
 * the skill; nothing here generates or writes extension code.
 */

export interface ExtensionAdaptationHost {
  workspaceFor(workspaceId: string): ExtensionCompatibilityWorkspace | undefined;
  extensionFor(workspaceId: string, extensionPath: string): RuntimeExtensionRecord | undefined;
  startThread(input: StartThreadInput): Promise<DesktopAppState>;
}

export interface ExtensionAdaptationPaths {
  /** Directory of the shipped `@pi-garden/extension-ui` package (package.json + dist). */
  readonly helperPackageDir: string;
  /**
   * Absolute path to the packaged-safe Adapt writer CLI (`apply.mjs` beside the
   * skill). Ordinary Pi runs this with Node; no repository checkout is required.
   */
  readonly adaptWriterPath: string;
}

export class ExtensionCompatibilityService {
  constructor(
    private readonly owner: ExtensionCompatibilityOwner,
    private readonly host: ExtensionAdaptationHost,
    private readonly paths: ExtensionAdaptationPaths,
  ) {}

  async inventory(
    request: ExtensionCompatibilityRequest,
  ): Promise<ExtensionCompatibilityInventory> {
    const { workspace, extension } = this.resolve(request);
    return this.owner.inventory({ workspace, extension, refresh: request.refresh === true });
  }

  async adapt(input: AdaptExtensionForDesktopInput): Promise<DesktopAppState> {
    const { workspace, extension } = this.resolve(input);
    const inventory = await this.owner.inventory({ workspace, extension });
    if (!inventory.adaptation.available) {
      throw new Error(inventory.adaptation.message);
    }
    return this.host.startThread({
      rootWorkspaceId: workspace.workspaceId,
      environment: "local",
      prompt: buildAdaptForDesktopPrompt({
        extension,
        workspace,
        inventory,
        helperPackageDir: this.paths.helperPackageDir,
        adaptWriterPath: this.paths.adaptWriterPath,
      }),
    });
  }

  private resolve(request: ExtensionCompatibilityRequest): {
    workspace: ExtensionCompatibilityWorkspace;
    extension: RuntimeExtensionRecord;
  } {
    const workspace = this.host.workspaceFor(request.workspaceId);
    if (!workspace) throw new Error(`Unknown workspace: ${request.workspaceId}`);
    const extension = this.host.extensionFor(request.workspaceId, request.extensionPath);
    if (!extension) throw new Error("Extension is not loaded in this workspace.");
    return { workspace, extension };
  }
}

export function buildAdaptForDesktopPrompt(input: {
  readonly extension: RuntimeExtensionRecord;
  readonly workspace: ExtensionCompatibilityWorkspace;
  readonly inventory: ExtensionCompatibilityInventory;
  readonly helperPackageDir: string;
  readonly adaptWriterPath: string;
}): string {
  const { extension, workspace, inventory } = input;
  const scope =
    extension.sourceInfo.scope === "project"
      ? "project-local (trusted workspace)"
      : `${extension.sourceInfo.scope} (editable)`;
  const grouped = groupFindings(inventory.findings);
  const lines = [
    // The skill name must be followed by a space: Pi splits `/skill:<name> <args>` there.
    `/skill:${ADAPT_FOR_DESKTOP_SKILL_NAME} Adapt the Pi extension below for pi-garden desktop. Use only this target; do not pick another extension.`,
    "",
    `Target extension entry: ${extension.path}`,
    `Extension directory: ${path.dirname(extension.path)}`,
    `Extension name: ${extension.displayName}`,
    `Scope: ${scope}`,
    `Workspace: ${workspace.path}`,
    `@pi-garden/extension-ui package to vendor from (read-only source): ${input.helperPackageDir}`,
    `Adapt writer (run with node; self-contained, no repo checkout): ${input.adaptWriterPath}`,
    `Source inspection: ${inventory.source.status}${
      inventory.source.files.length > 0 ? ` (${inventory.source.files.length} file(s))` : ""
    }`,
    `Runtime evidence: ${
      inventory.runtime.generations.length > 0
        ? `${inventory.runtime.generations.length} live generation(s) in this workspace`
        : "none yet"
    }`,
    "",
    "Compatibility findings (source = referenced in code, runtime = observed live in pi-garden):",
    ...adaptedSection(grouped.adapted),
    ...section("Adapt (terminal-specific, has a desktop target)", grouped.adaptable, true),
    ...section("Leave untouched (unsupported in this version)", grouped.unsupported, false),
    ...section("Already desktop-native (do not duplicate)", grouped.native, false),
    ...section("Directly supported (no change needed)", grouped.supported, false),
    ...section("Unknown (inspect before deciding)", grouped.unknown, false),
  ];
  return lines.join("\n");
}

function groupFindings(findings: readonly ExtensionCompatibilityFinding[]) {
  return {
    adapted: findings.filter((finding) => finding.status === "adapted"),
    adaptable: findings.filter((finding) => finding.status === "adaptable"),
    unsupported: findings.filter((finding) => finding.status === "unsupported"),
    native: findings.filter((finding) => finding.status === "desktop-native"),
    supported: findings.filter((finding) => finding.status === "supported"),
    unknown: findings.filter((finding) => finding.status === "unknown"),
  };
}

function adaptedSection(findings: readonly ExtensionCompatibilityFinding[]): readonly string[] {
  if (findings.length === 0) return [];
  return [
    "",
    "Already adapted (paired, do not duplicate):",
    ...findings.map((finding) => {
      const link = finding.adaptedBy;
      const target = link
        ? `${link.api}${link.surface ? ` ${link.surface}` : ""} ${link.id}`
        : "its desktop registration";
      return `- ${finding.capability} (${finding.label}) paired with ${target}; ${describeEvidence(finding)}`;
    }),
  ];
}

function section(
  title: string,
  findings: readonly ExtensionCompatibilityFinding[],
  includeTarget: boolean,
): readonly string[] {
  if (findings.length === 0) return [];
  return [
    "",
    `${title}:`,
    ...findings.map((finding) => {
      const target =
        includeTarget && finding.adaptationTarget ? ` → ${finding.adaptationTarget}` : "";
      return `- ${finding.capability} (${finding.label})${target}; ${describeEvidence(finding)}`;
    }),
  ];
}

function describeEvidence(finding: ExtensionCompatibilityFinding): string {
  const source = finding.evidence.filter((item) => item.kind === "source");
  const runtime = finding.evidence.filter((item) => item.kind === "runtime");
  const parts: string[] = [];
  if (source.length > 0) {
    parts.push(
      `source: ${source
        .slice(0, 4)
        .map(
          (item) => `${path.basename(item.file)}:${item.line}${item.partial ? " (uncertain)" : ""}`,
        )
        .join(", ")}${source.length > 4 ? `, +${source.length - 4} more` : ""}`,
    );
  }
  if (runtime.length > 0) {
    parts.push(`runtime: observed ${runtime.length} time(s) in the current generation`);
  }
  return parts.join("; ") || "no evidence recorded";
}

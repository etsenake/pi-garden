/**
 * Bundled authoring skills that start ordinary Pi threads with injected paths.
 * Parallel to Adapt for Desktop; greenfield scaffolds instead of adapting.
 */

export const CREATE_HOST_CONTRIBUTION_SKILL = "create-host-contribution";
export const CREATE_RICH_SURFACE_SKILL = "create-rich-surface";
export const CREATE_DESKTOP_VIEW_SKILL = "create-desktop-view";
export const THEME_PI_GARDEN_SKILL = "theme-pi-garden";

export type DesktopAuthoringKind =
  | "host-contribution"
  | "rich-surface"
  | "desktop-view"
  | "theme";

export interface DesktopAuthoringPaths {
  readonly helperPackageDir: string;
  readonly skillsDir: string;
  /** Default directory for new extensions (workspace .pi/extensions). */
  readonly extensionsDir: string;
  /** Default directory for Garden theme files (agent themes/). */
  readonly themesDir: string;
}

export interface StartDesktopAuthoringInput {
  readonly workspaceId: string;
  readonly kind: DesktopAuthoringKind;
  /** Optional stable id; the agent may still ask to confirm. */
  readonly id?: string;
  /** Optional rich-surface placement when kind is rich-surface. */
  readonly surface?: string;
}

export function authoringSkillName(kind: DesktopAuthoringKind): string {
  switch (kind) {
    case "host-contribution":
      return CREATE_HOST_CONTRIBUTION_SKILL;
    case "rich-surface":
      return CREATE_RICH_SURFACE_SKILL;
    case "desktop-view":
      return CREATE_DESKTOP_VIEW_SKILL;
    case "theme":
      return THEME_PI_GARDEN_SKILL;
  }
}

export function authoringWriterPath(skillsDir: string, kind: DesktopAuthoringKind): string {
  return `${skillsDir.replace(/\\/g, "/")}/${authoringSkillName(kind)}/apply.mjs`;
}

export function buildDesktopAuthoringPrompt(input: {
  readonly kind: DesktopAuthoringKind;
  readonly workspacePath: string;
  readonly paths: DesktopAuthoringPaths;
  readonly id?: string;
  readonly surface?: string;
}): string {
  const skill = authoringSkillName(input.kind);
  const writer = authoringWriterPath(input.paths.skillsDir, input.kind);
  const idHint = input.id?.trim() || "(choose a lowercase id)";
  const lines: string[] = [
    // Pi splits `/skill:<name> <args>` on the first space after the name.
    `/skill:${skill} Create this for pi-garden. Follow the skill exactly; run the writer before hand-writing parallel files.`,
    "",
    `Workspace: ${input.workspacePath}`,
  ];

  if (input.kind === "theme") {
    lines.push(
      `Themes directory (write here): ${input.paths.themesDir}`,
      `Theme writer (run with node): ${writer}`,
      `Suggested theme id: ${idHint}`,
      "",
      "Use pi-garden.theme/v1 only — not a Pi colors theme.",
    );
  } else {
    lines.push(
      `Extensions directory (create the extension folder under here): ${input.paths.extensionsDir}`,
      `@pi-garden/extension-ui package to vendor from (read-only source): ${input.paths.helperPackageDir}`,
      `Scaffold writer (run with node; self-contained): ${writer}`,
      `Suggested id: ${idHint}`,
    );
    if (input.kind === "rich-surface") {
      lines.push(
        `Suggested surface: ${input.surface?.trim() || "composer-before"}`,
        "",
        "Pass surface-kind as the third writer argument.",
      );
    } else {
      lines.push("");
    }
  }

  lines.push("Do not modify pi-garden application source. Do not commit unless asked.");
  return lines.join("\n");
}

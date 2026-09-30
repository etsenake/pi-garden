import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

/** Pi's path prefix for built-in tools and extensions (`builtin:read`, `builtin:mcp`, …). */
const BUILTIN_PATH_PREFIX = "builtin:";

/** A pi-garden-owned pi extension that users can switch off in Settings. */
export interface BuiltinExtension {
  /** Stable id; pi reports the loaded extension at `builtin:<name>`. */
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly factory: ExtensionFactory;
}

export type BuiltinExtensionEnabled = (name: string) => boolean;

export function builtinExtensionPath(name: string): string {
  return `${BUILTIN_PATH_PREFIX}${name}`;
}

export function findBuiltinExtension(
  builtins: readonly BuiltinExtension[],
  path: string,
): BuiltinExtension | undefined {
  return builtins.find((builtin) => builtinExtensionPath(builtin.name) === path);
}

/**
 * Pi runs inline factories again on every reload, so checking the preference inside the factory
 * lets an open session drop or regain a built-in's tools on its next reload.
 */
export function gatedBuiltinExtensions(
  builtins: readonly BuiltinExtension[],
  isEnabled: BuiltinExtensionEnabled,
): InlineExtension[] {
  return builtins.map((builtin) => ({
    name: builtin.name,
    builtin: true,
    factory: (pi) => (isEnabled(builtin.name) ? builtin.factory(pi) : undefined),
  }));
}

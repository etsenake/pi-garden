import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AttributableExtension {
  readonly resolvedPath: string;
  readonly baseDir?: string;
}

/**
 * Pi hands every extension the same `ctx.ui`, so a live call carries no caller
 * identity. The stack does: jiti evaluates each extension under its real file
 * name. The first frame that is a loaded extension entry wins; otherwise the
 * first frame inside exactly one extension's directory wins. Anything else
 * stays unattributed instead of guessed.
 */
export function attributeExtensionCallSite(
  stack: string | undefined,
  extensions: readonly AttributableExtension[],
): string | undefined {
  if (!stack) return undefined;
  const candidates = extensions.filter((extension) => path.isAbsolute(extension.resolvedPath));
  if (candidates.length === 0) return undefined;
  const byPath = new Map(candidates.map((extension) => [extension.resolvedPath, extension]));
  const frames = stackFilePaths(stack);
  for (const frame of frames) {
    const exact = byPath.get(frame);
    if (exact) return exact.resolvedPath;
  }
  for (const frame of frames) {
    const within = candidates.filter(
      (extension) => extension.baseDir !== undefined && isInside(extension.baseDir, frame),
    );
    if (within.length === 1) return within[0]!.resolvedPath;
    if (within.length > 1) return undefined;
  }
  return undefined;
}

function stackFilePaths(stack: string): readonly string[] {
  const paths: string[] = [];
  for (const line of stack.split("\n")) {
    const match = /\(?((?:file:\/\/)?(?:\/|[A-Za-z]:\\)[^()\s]+?):\d+:\d+\)?\s*$/.exec(line.trim());
    if (!match) continue;
    const raw = match[1]!;
    try {
      paths.push(raw.startsWith("file://") ? fileURLToPath(raw) : raw);
    } catch {
      // Ignore frames that are not local files.
    }
  }
  return paths;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

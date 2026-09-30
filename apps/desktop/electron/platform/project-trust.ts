/**
 * Pi's project trust decision for a workspace, read from the same trust store
 * terminal Pi writes. A project without trust-requiring resources is trusted;
 * otherwise only an explicit stored decision counts, and a read failure is
 * treated as untrusted.
 */
export async function projectIsTrusted(agentDir: string, workspacePath: string): Promise<boolean> {
  const pi = await import("@earendil-works/pi-coding-agent");
  if (!pi.hasTrustRequiringProjectResources(workspacePath)) return true;
  try {
    return new pi.ProjectTrustStore(agentDir).get(workspacePath) === true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[trust] project trust could not be read for ${workspacePath}: ${message}`);
    return false;
  }
}

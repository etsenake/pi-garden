import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProjectTrustStore,
  type DefaultProjectTrust,
  type LoadExtensionsResult,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";

/**
 * Reload options that resolve Pi project trust before project-local extensions load.
 *
 * `resolveProjectTrusted` is not a package export. The resource loader's
 * `resolveProjectTrust` callback is the public seam: Pi loads user and global
 * extensions first, then this callback, then the project set. Desktop has no
 * trust prompt, so a workspace with trust-requiring resources and no stored
 * decision stays untrusted and its project extensions never run.
 */
export function projectTrustReloadOptions(
  agentDir: string,
  cwd: string,
  settingsManager?: Pick<SettingsManager, "getDefaultProjectTrust">,
): {
  resolveProjectTrust: (input: { extensionsResult: LoadExtensionsResult }) => Promise<boolean>;
} {
  return {
    resolveProjectTrust: async ({ extensionsResult }) => {
      const resolveProjectTrusted = await loadResolveProjectTrusted();
      return resolveProjectTrusted({
        cwd,
        trustStore: new ProjectTrustStore(agentDir),
        defaultProjectTrust:
          settingsManager?.getDefaultProjectTrust() ?? readDefaultProjectTrust(agentDir),
        extensionsResult,
        projectTrustContext: {
          cwd,
          mode: "print",
          hasUI: false,
          ui: {
            select: () => Promise.reject(new Error("Pi Garden has no project-trust prompt")),
            confirm: () => Promise.reject(new Error("Pi Garden has no project-trust prompt")),
            input: () => Promise.reject(new Error("Pi Garden has no project-trust prompt")),
            notify: () => undefined,
          },
        },
      });
    },
  };
}

type ResolveProjectTrusted = (options: {
  cwd: string;
  trustStore: ProjectTrustStore;
  defaultProjectTrust?: DefaultProjectTrust;
  extensionsResult?: LoadExtensionsResult;
  projectTrustContext: {
    cwd: string;
    mode: "print";
    hasUI: false;
    ui: {
      select: () => Promise<string | undefined>;
      confirm: () => Promise<boolean>;
      input: () => Promise<string | undefined>;
      notify: () => undefined;
    };
  };
}) => Promise<boolean>;

let resolver: ResolveProjectTrusted | undefined;

async function loadResolveProjectTrusted(): Promise<ResolveProjectTrusted> {
  if (resolver) return resolver;
  const indexUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const loaded = (await import(new URL("./core/project-trust.js", indexUrl).href)) as {
    resolveProjectTrusted?: ResolveProjectTrusted;
  };
  if (typeof loaded.resolveProjectTrusted !== "function") {
    throw new Error("Pi project trust resolver is not available");
  }
  resolver = loaded.resolveProjectTrusted;
  return resolver;
}

function readDefaultProjectTrust(agentDir: string): DefaultProjectTrust {
  try {
    const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as {
      defaultProjectTrust?: unknown;
    };
    if (
      settings.defaultProjectTrust === "always" ||
      settings.defaultProjectTrust === "never" ||
      settings.defaultProjectTrust === "ask"
    ) {
      return settings.defaultProjectTrust;
    }
  } catch {
    // Missing or unreadable settings use Pi's own default.
  }
  return "ask";
}

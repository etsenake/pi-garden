import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "@pi-garden/session-driver/runtime-types";
import { SettingsSwitch } from "./settings-controls";
import { runSettingsAction, SettingsGroup, SettingsRow } from "./settings-utils";

const PI_BUILTINS = [
  {
    name: "mcp",
    title: "MCP",
    description: "Connect servers from mcp.json and register their tools.",
  },
  {
    name: "codemode",
    title: "Codemode",
    description:
      "Lets the model run JavaScript that calls tools in parallel. Enable with +codemode in default tools, or when MCP auto-enables it.",
  },
  {
    name: "tool-search",
    title: "Tool search",
    description: "Finds deferred tools and declares them to the model when needed.",
  },
  {
    name: "llama.cpp",
    title: "llama.cpp",
    description: "Built-in local llama.cpp provider.",
  },
] as const;

interface SettingsToolsSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly onSetDefaultTools: (entries: readonly string[]) => Promise<string | undefined>;
  readonly onSetPiBuiltinEnabled: (name: string, enabled: boolean) => Promise<string | undefined>;
}

/** Pi built-in extensions and defaultTools (+name / -name) settings. */
export function SettingsToolsSection({
  runtime,
  onSetDefaultTools,
  onSetPiBuiltinEnabled,
}: SettingsToolsSectionProps) {
  const tools = runtime?.toolsSettings;
  const disabled = new Set(tools?.disabledBuiltins ?? []);
  const [draft, setDraft] = useState((tools?.defaultTools ?? []).join("\n"));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setDraft((tools?.defaultTools ?? []).join("\n"));
  }, [tools?.defaultTools]);

  const saveDefaultTools = async (): Promise<string | undefined> => {
    setPending(true);
    setError("");
    const entries = draft
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    try {
      return await onSetDefaultTools(entries);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <SettingsGroup title="Built-in extensions">
        {PI_BUILTINS.map((builtin) => (
          <SettingsRow key={builtin.name} title={builtin.title} description={builtin.description}>
            <SettingsSwitch
              checked={!disabled.has(builtin.name)}
              label={`Enable ${builtin.title}`}
              onChange={(enabled) =>
                runSettingsAction(onSetPiBuiltinEnabled(builtin.name, enabled), setError)
              }
            />
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Default tools">
        <SettingsRow
          title="Tool list"
          description="One name per line. Use +name or -name to add or remove without replacing defaults, for example +codemode. Leave empty to use Pi defaults (read, bash, edit, write)."
        >
          <textarea
            className="settings-textarea"
            rows={5}
            value={draft}
            placeholder={"read\nbash\nedit\nwrite\n+codemode"}
            onChange={(event) => setDraft(event.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          title="Resolved"
          description={(tools?.resolvedDefaultTools ?? []).join(", ") || "Pi defaults"}
        >
          <button
            className="button"
            type="button"
            disabled={pending}
            onClick={() => runSettingsAction(saveDefaultTools(), setError)}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </SettingsRow>
        {error ? <p className="settings-error">{error}</p> : null}
      </SettingsGroup>
    </>
  );
}

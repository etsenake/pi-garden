import { useState } from "react";
import type {
  DesktopMcpExposure,
  DesktopMcpServerRecord,
  RuntimeSnapshot,
} from "@pi-garden/session-driver/runtime-types";
import type { AddMcpServerInput, UpdateMcpServerInput } from "../../../contracts/ipc";
import { SettingsSelect, SettingsSwitch } from "./settings-controls";
import { runSettingsAction, SettingsGroup, SettingsRow } from "./settings-utils";

const EXPOSURE_OPTIONS: readonly { readonly value: DesktopMcpExposure; readonly label: string }[] =
  [
    { value: "codemode", label: "Codemode" },
    { value: "codemode-deferred", label: "Codemode (deferred)" },
    { value: "deferred", label: "Deferred (tool search)" },
    { value: "direct", label: "Direct" },
    { value: "hidden", label: "Hidden" },
  ];

interface SettingsMcpSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly onAddMcpServer: (input: AddMcpServerInput) => Promise<string | undefined>;
  readonly onRemoveMcpServer: (
    scope: DesktopMcpServerRecord["scope"],
    name: string,
  ) => Promise<string | undefined>;
  readonly onUpdateMcpServer: (input: UpdateMcpServerInput) => Promise<string | undefined>;
  readonly onSetProjectTrust: (trusted: boolean) => Promise<string | undefined>;
}

/** MCP servers from Pi's mcp.json, plus project trust for project-scoped servers. */
export function SettingsMcpSection({
  runtime,
  onAddMcpServer,
  onRemoveMcpServer,
  onUpdateMcpServer,
  onSetProjectTrust,
}: SettingsMcpSectionProps) {
  const servers = runtime?.mcpServers ?? [];
  const projectTrusted = runtime?.projectTrusted ?? false;
  const trustRequired = runtime?.projectTrustRequired ?? false;
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [mode, setMode] = useState<"stdio" | "http">("stdio");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<string | undefined> => {
    setPending(true);
    setError("");
    const trimmedName = name.trim();
    const input: AddMcpServerInput =
      mode === "http"
        ? {
            scope,
            name: trimmedName,
            config: { type: "http", url: url.trim() },
          }
        : {
            scope,
            name: trimmedName,
            config: {
              type: "stdio",
              command: command.trim(),
              ...(argsText.trim() ? { args: argsText.trim().split(/\s+/).filter(Boolean) } : {}),
            },
          };
    try {
      const nextError = await onAddMcpServer(input);
      if (nextError) return nextError;
    } finally {
      setPending(false);
    }
    setName("");
    setCommand("");
    setArgsText("");
    setUrl("");
    return undefined;
  };

  return (
    <>
      {trustRequired ? (
        <SettingsGroup title="Project trust">
          <SettingsRow
            title={projectTrusted ? "This project is trusted" : "This project is not trusted"}
            description="Project .pi/mcp.json, extensions, and skills load only when the project is trusted — the same decision terminal Pi stores."
          >
            <SettingsSwitch
              checked={projectTrusted}
              label="Trust project"
              onChange={(trusted) => runSettingsAction(onSetProjectTrust(trusted), setError)}
            />
          </SettingsRow>
        </SettingsGroup>
      ) : null}

      <SettingsGroup title="Servers" plain={servers.length === 0}>
        {servers.length === 0 ? (
          <SettingsRow
            title="No MCP servers"
            description="Add a stdio or HTTP server. Config is written to Pi's mcp.json (global or project)."
          />
        ) : (
          servers.map((server) => (
            <McpServerRow
              key={`${server.scope}:${server.name}`}
              server={server}
              onRemove={() =>
                runSettingsAction(onRemoveMcpServer(server.scope, server.name), setError)
              }
              onUpdate={(patch) =>
                runSettingsAction(
                  onUpdateMcpServer({ scope: server.scope, name: server.name, ...patch }),
                  setError,
                )
              }
            />
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title="Add server">
        <SettingsRow
          title="Scope"
          description="Project servers require trust and live in .pi/mcp.json."
        >
          <SettingsSelect
            label="Scope"
            value={scope}
            options={[
              { value: "global", label: "Global" },
              { value: "project", label: "Project" },
            ]}
            onChange={(value) => setScope(value as "global" | "project")}
          />
        </SettingsRow>
        <SettingsRow title="Transport">
          <SettingsSelect
            label="Transport"
            value={mode}
            options={[
              { value: "stdio", label: "stdio" },
              { value: "http", label: "HTTP" },
            ]}
            onChange={(value) => setMode(value as "stdio" | "http")}
          />
        </SettingsRow>
        <SettingsRow title="Name">
          <input
            className="settings-text-input"
            value={name}
            placeholder="filesystem"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
          />
        </SettingsRow>
        {mode === "stdio" ? (
          <>
            <SettingsRow title="Command">
              <input
                className="settings-text-input"
                value={command}
                placeholder="npx"
                spellCheck={false}
                onChange={(event) => setCommand(event.target.value)}
              />
            </SettingsRow>
            <SettingsRow title="Args" description="Space-separated.">
              <input
                className="settings-text-input"
                value={argsText}
                placeholder="-y @modelcontextprotocol/server-filesystem ."
                spellCheck={false}
                onChange={(event) => setArgsText(event.target.value)}
              />
            </SettingsRow>
          </>
        ) : (
          <SettingsRow title="URL">
            <input
              className="settings-text-input"
              value={url}
              placeholder="https://example.com/mcp"
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
            />
          </SettingsRow>
        )}
        <SettingsRow title="Add" description="Writes to Pi's mcp.json for the selected scope.">
          <button
            className="button"
            type="button"
            disabled={pending || !name.trim() || (mode === "stdio" ? !command.trim() : !url.trim())}
            onClick={() => runSettingsAction(submit(), setError)}
          >
            {pending ? "Adding…" : "Add server"}
          </button>
        </SettingsRow>
        {error ? <p className="settings-error">{error}</p> : null}
      </SettingsGroup>
    </>
  );
}

function McpServerRow({
  server,
  onRemove,
  onUpdate,
}: {
  readonly server: DesktopMcpServerRecord;
  readonly onRemove: () => void;
  readonly onUpdate: (patch: {
    readonly enabled?: boolean;
    readonly exposure?: DesktopMcpExposure;
  }) => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <div className="settings-row__title">
          {server.name}{" "}
          <span className="settings-row__meta">
            {server.scope} · {server.transport}
          </span>
        </div>
        <div className="settings-row__description">{server.sourcePath}</div>
      </div>
      <div className="settings-row__control settings-row__control--stack">
        <SettingsSwitch
          checked={server.enabled}
          label="Enabled"
          onChange={(enabled) => onUpdate({ enabled })}
        />
        <SettingsSelect
          label="Exposure"
          value={server.exposure}
          options={EXPOSURE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          onChange={(value) => onUpdate({ exposure: value as DesktopMcpExposure })}
        />
        <button className="button button--secondary" type="button" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

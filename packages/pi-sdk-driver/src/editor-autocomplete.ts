import type { AgentSession, AutocompleteProviderFactory } from "@earendil-works/pi-coding-agent";
import {
  CombinedAutocompleteProvider,
  type AutocompleteItem,
  type AutocompleteProvider,
  type SlashCommand,
} from "@earendil-works/pi-tui";

const SUGGESTION_LIMIT = 30;
const TEXT_LIMIT = 500;

export interface EditorAutocompleteQuery {
  readonly text: string;
  readonly cursor: number;
  readonly force?: boolean;
}

export interface EditorAutocompleteItem {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
}

export interface EditorAutocompleteResponse {
  readonly items: readonly EditorAutocompleteItem[];
  readonly prefix: string;
  readonly triggerCharacters: readonly string[];
}

export interface EditorAutocompleteApplyInput {
  readonly text: string;
  readonly cursor: number;
  readonly prefix: string;
  readonly item: EditorAutocompleteItem;
}

export interface EditorAutocompleteApplied {
  readonly text: string;
  readonly cursor: number;
}

export interface AutocompleteChain {
  readonly provider: AutocompleteProvider | undefined;
  readonly triggerCharacters: readonly string[];
  readonly errors: readonly string[];
}

interface BuiltinCommand {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
}

let builtinCommands: Promise<readonly BuiltinCommand[]> | undefined;

async function loadBuiltinCommands(): Promise<readonly BuiltinCommand[]> {
  builtinCommands ??= (async () => {
    const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
    const mod: unknown = await import(new URL("./core/slash-commands.js", entry).href);
    const commands =
      mod && typeof mod === "object" ? (mod as Record<string, unknown>).BUILTIN_SLASH_COMMANDS : [];
    return Array.isArray(commands) ? (commands as readonly BuiltinCommand[]) : [];
  })();
  return builtinCommands;
}

export function cursorToLineCol(
  text: string,
  cursor: number,
): { readonly line: number; readonly col: number; readonly lines: string[] } {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  const lines = text.split("\n");
  let remaining = clamped;
  for (let line = 0; line < lines.length; line += 1) {
    const current = lines[line] ?? "";
    if (remaining <= current.length) return { line, col: remaining, lines };
    remaining -= current.length + 1;
  }
  const line = Math.max(0, lines.length - 1);
  return { line, col: lines[line]?.length ?? 0, lines };
}

export function lineColToCursor(lines: readonly string[], line: number, col: number): number {
  const safeLine = Math.max(0, Math.min(line, Math.max(0, lines.length - 1)));
  let offset = 0;
  for (let index = 0; index < safeLine; index += 1) offset += (lines[index]?.length ?? 0) + 1;
  const current = lines[safeLine] ?? "";
  return offset + Math.max(0, Math.min(col, current.length));
}

function clip(value: string): string {
  return value.length > TEXT_LIMIT ? value.slice(0, TEXT_LIMIT) : value;
}

export function normalizeAutocompleteItems(
  items: readonly AutocompleteItem[],
): EditorAutocompleteItem[] {
  const normalized: EditorAutocompleteItem[] = [];
  for (const item of items) {
    if (!item || typeof item.label !== "string" || typeof item.value !== "string") continue;
    if (!item.label || !item.value) continue;
    const description =
      typeof item.description === "string" && item.description ? clip(item.description) : undefined;
    normalized.push({
      label: clip(item.label),
      value: clip(item.value),
      ...(description ? { description } : {}),
    });
    if (normalized.length >= SUGGESTION_LIMIT) break;
  }
  return normalized;
}

/**
 * Pi 0.87.1 stacks each factory over the provider produced before it and unions
 * trigger characters in registration order.
 * A factory that throws is left out of the chain so the editor stays usable.
 */
export function composeAutocompleteProviders(
  base: AutocompleteProvider,
  factories: readonly AutocompleteProviderFactory[],
): AutocompleteChain {
  let provider: AutocompleteProvider = base;
  const triggers: string[] = [];
  const errors: string[] = [];
  for (const factory of factories) {
    try {
      const next = factory(provider);
      if (
        !next ||
        typeof next.getSuggestions !== "function" ||
        typeof next.applyCompletion !== "function"
      ) {
        throw new TypeError(
          "Autocomplete provider must implement getSuggestions and applyCompletion",
        );
      }
      provider = next;
      for (const character of provider.triggerCharacters ?? []) {
        if (typeof character === "string" && character.length === 1) triggers.push(character);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (triggers.length > 0) provider.triggerCharacters = [...new Set(triggers)];
  return {
    provider,
    triggerCharacters: provider.triggerCharacters ?? [],
    errors,
  };
}

export async function runAutocompleteQuery(
  provider: AutocompleteProvider,
  query: EditorAutocompleteQuery,
  signal: AbortSignal,
): Promise<EditorAutocompleteResponse> {
  const triggerCharacters = [...(provider.triggerCharacters ?? [])];
  const empty = { items: [], prefix: "", triggerCharacters } satisfies EditorAutocompleteResponse;
  if (signal.aborted) return empty;
  if (query.force && provider.shouldTriggerFileCompletion) {
    const position = cursorToLineCol(query.text, query.cursor);
    let allowed = false;
    try {
      allowed = provider.shouldTriggerFileCompletion(position.lines, position.line, position.col);
    } catch {
      allowed = false;
    }
    if (!allowed) return empty;
  }
  const position = cursorToLineCol(query.text, query.cursor);
  let suggestions: { items?: AutocompleteItem[]; prefix?: string } | null;
  try {
    suggestions = await provider.getSuggestions(position.lines, position.line, position.col, {
      signal,
      ...(query.force ? { force: true } : {}),
    });
  } catch {
    return empty;
  }
  if (signal.aborted || !suggestions || !Array.isArray(suggestions.items)) return empty;
  return {
    items: normalizeAutocompleteItems(suggestions.items),
    prefix: typeof suggestions.prefix === "string" ? suggestions.prefix : "",
    triggerCharacters,
  };
}

export function runAutocompleteApply(
  provider: AutocompleteProvider,
  input: EditorAutocompleteApplyInput,
): EditorAutocompleteApplied | null {
  const position = cursorToLineCol(input.text, input.cursor);
  const item: AutocompleteItem = {
    value: input.item.value,
    label: input.item.label,
    ...(input.item.description ? { description: input.item.description } : {}),
  };
  try {
    const applied = provider.applyCompletion(
      position.lines,
      position.line,
      position.col,
      item,
      input.prefix,
    );
    if (!applied || !Array.isArray(applied.lines)) return null;
    const lines = applied.lines.map((line) => (typeof line === "string" ? line : ""));
    return {
      text: lines.join("\n"),
      cursor: lineColToCursor(lines, applied.cursorLine, applied.cursorCol),
    };
  } catch {
    return null;
  }
}

function slashCommand(
  name: string,
  description: string | undefined,
  argumentHint?: string,
  getArgumentCompletions?: SlashCommand["getArgumentCompletions"],
): SlashCommand {
  return {
    name,
    ...(description ? { description } : {}),
    ...(argumentHint ? { argumentHint } : {}),
    ...(getArgumentCompletions ? { getArgumentCompletions } : {}),
  };
}

interface LooseCommand {
  readonly name: string;
  readonly invocationName?: string;
  readonly description?: string;
  readonly argumentHint?: string;
  readonly getArgumentCompletions?: SlashCommand["getArgumentCompletions"];
}

interface LooseTemplate {
  readonly name: string;
  readonly description?: string;
  readonly argumentHint?: string;
}

interface LooseSkill {
  readonly name: string;
  readonly description?: string;
}

interface LooseModel {
  readonly id: string;
  readonly provider: string;
}

/** The provider Pi passes into the first extension wrapper: commands, arguments, skills, and paths. */
export async function createSessionBaseProvider(
  session: AgentSession,
): Promise<AutocompleteProvider> {
  const builtins = await loadBuiltinCommands();
  const commands: SlashCommand[] = builtins.map((command) =>
    slashCommand(command.name, command.description, command.argumentHint),
  );
  const modelCommand = commands.find((command) => command.name === "model");
  if (modelCommand) {
    modelCommand.getArgumentCompletions = (prefix) => {
      const scoped = session.scopedModels ?? [];
      const models: readonly LooseModel[] =
        scoped.length > 0
          ? scoped.map((entry) => entry.model)
          : (session.modelRuntime.getAvailableSnapshot() as readonly LooseModel[]);
      const query = prefix.toLowerCase();
      const items = models
        .filter((model) => {
          const label = `${model.provider}/${model.id}`.toLowerCase();
          return label.includes(query) || model.id.toLowerCase().includes(query);
        })
        .slice(0, SUGGESTION_LIMIT)
        .map((model) => ({
          value: `${model.provider}/${model.id}`,
          label: model.id,
          description: model.provider,
        }));
      return items.length > 0 ? items : null;
    };
  }
  const thinkingCommand = commands.find((command) => command.name === "thinking");
  if (thinkingCommand) {
    thinkingCommand.getArgumentCompletions = (prefix) => {
      const items = session
        .getAvailableThinkingLevels()
        .filter((level) => level.toLowerCase().startsWith(prefix.toLowerCase()))
        .map((level) => ({ value: level, label: level }));
      return items.length > 0 ? items : null;
    };
  }
  const extensionCommands = (
    (session.extensionRunner?.getRegisteredCommands() ?? []) as readonly LooseCommand[]
  ).filter((command) => !commands.some((builtin) => builtin.name === command.name));
  const templates = session.promptTemplates as readonly LooseTemplate[];
  const skillsEnabled = skillCommandsEnabled(session);
  const skills = skillsEnabled
    ? ((session.resourceLoader.getSkills().skills ?? []) as readonly LooseSkill[])
    : [];
  const cwd = session.sessionManager.getCwd();
  return new CombinedAutocompleteProvider(
    [
      ...commands,
      ...extensionCommands.map((command) =>
        slashCommand(
          command.invocationName || command.name,
          command.description,
          command.argumentHint,
          command.getArgumentCompletions,
        ),
      ),
      ...templates.map((template) =>
        slashCommand(template.name, template.description, template.argumentHint),
      ),
      ...skills.map((skill) => slashCommand(`skill:${skill.name}`, skill.description)),
    ],
    cwd,
  );
}

function skillCommandsEnabled(session: AgentSession): boolean {
  const settings = session as AgentSession & {
    settingsManager?: { getEnableSkillCommands?: () => boolean };
  };
  return settings.settingsManager?.getEnableSkillCommands?.() !== false;
}

import { readFile, stat } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { parse, type Node } from "acorn";
import type {
  ExtensionCapabilityId,
  ExtensionSourceEvidence,
  ExtensionSourceInspection,
} from "../../contracts/extension-compatibility";

/**
 * Bounded static inspection of one Pi extension's local source.
 *
 * The entry file and the relative imports it reaches are parsed into an AST.
 * Bare package imports are never followed and `node_modules` is never walked,
 * extension code is never imported or executed, and a file the parser cannot
 * read leaves the inspection `partial`. A source hit records where an API is
 * referenced; it is not proof that the code ran.
 */

export interface ExtensionSourceAnalysis {
  readonly inspection: ExtensionSourceInspection;
  readonly evidence: ReadonlyMap<ExtensionCapabilityId, readonly ExtensionSourceEvidence[]>;
}

export interface ExtensionSourceAnalysisLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxDepth: number;
}

export const DEFAULT_SOURCE_ANALYSIS_LIMITS: ExtensionSourceAnalysisLimits = {
  maxFiles: 32,
  maxFileBytes: 512 * 1024,
  maxDepth: 4,
};

const SOURCE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;
const GARDEN_PACKAGE = "@pi-garden/extension-ui";
const TUI_PACKAGES = new Set(["@earendil-works/pi-tui", "@mariozechner/pi-tui"]);

const UI_METHODS: Readonly<Record<string, ExtensionCapabilityId>> = {
  select: "ui.dialogs",
  confirm: "ui.dialogs",
  input: "ui.dialogs",
  editor: "ui.dialogs",
  notify: "ui.notify",
  setStatus: "ui.status",
  setWorkingMessage: "ui.working",
  setWorkingVisible: "ui.working",
  setWorkingIndicator: "ui.working",
  setHiddenThinkingLabel: "ui.working",
  setTitle: "ui.title",
  setEditorText: "ui.editorText",
  getEditorText: "ui.editorText",
  pasteToEditor: "ui.editorText",
  addAutocompleteProvider: "ui.autocomplete",
  getToolsExpanded: "ui.toolsExpanded",
  setToolsExpanded: "ui.toolsExpanded",
  getAllThemes: "ui.theme",
  getTheme: "ui.theme",
  setTheme: "ui.theme",
  onTerminalInput: "ui.onTerminalInput",
  setHeader: "ui.setHeader",
  setFooter: "ui.setFooter",
  custom: "ui.custom",
  setEditorComponent: "ui.setEditorComponent",
  getEditorComponent: "ui.setEditorComponent",
};

/**
 * Method names distinctive enough to report (as partial evidence) even when the
 * receiver is not visibly `ctx.ui`; generic names such as `input` or `custom`
 * are only reported on a `ui` receiver.
 */
const DISTINCTIVE_UI_METHODS = new Set([
  "setStatus",
  "setWorkingMessage",
  "setWorkingIndicator",
  "setHiddenThinkingLabel",
  "setEditorText",
  "getEditorText",
  "pasteToEditor",
  "addAutocompleteProvider",
  "setToolsExpanded",
  "getToolsExpanded",
  "getAllThemes",
  "onTerminalInput",
  "setHeader",
  "setFooter",
  "setEditorComponent",
  "getEditorComponent",
  "setWidget",
]);

const PI_METHODS: Readonly<Record<string, ExtensionCapabilityId>> = {
  registerCommand: "pi.registerCommand",
  registerShortcut: "pi.registerShortcut",
  registerTool: "pi.registerTool",
  registerFlag: "pi.registerFlag",
  registerMessageRenderer: "pi.registerMessageRenderer",
  registerMarkdownTransformer: "pi.registerMarkdownTransformer",
  registerEntryRenderer: "pi.registerEntryRenderer",
};

const GARDEN_EXPORTS: Readonly<Record<string, ExtensionCapabilityId>> = {
  registerHeaderBadge: "garden.surfaceContribution",
  registerSidebarSection: "garden.surfaceContribution",
  registerSidebarFooter: "garden.surfaceContribution",
  registerComposerBefore: "garden.surfaceContribution",
  registerComposerAfter: "garden.surfaceContribution",
  registerStatusChrome: "garden.surfaceContribution",
  registerAction: "garden.registerAction",
  registerRichSurface: "garden.registerRichSurface",
  registerDesktopView: "garden.registerDesktopView",
  registerDesktopToolRenderer: "garden.registerDesktopToolRenderer",
  registerDesktopEditor: "garden.registerDesktopEditor",
};

interface EstreeNode extends Node {
  readonly type: string;
  readonly [key: string]: unknown;
}

interface FileContext {
  readonly file: string;
  readonly code: string;
  readonly approximate: boolean;
  /** Local identifier → garden export name. */
  readonly gardenLocals: Map<string, string>;
  /** Namespace identifiers bound to the garden package. */
  readonly gardenNamespaces: Set<string>;
  /** The extension factory's first parameter, when the file has a default export function. */
  piIdentifier: string | undefined;
  /** Identifiers bound once in this file to a function or to text; anything else is unknown. */
  readonly bindings: Map<string, WidgetContentKind>;
}

type WidgetContentKind = "text" | "component" | "unknown";

export async function analyzeExtensionSource(
  entryPath: string,
  limits: ExtensionSourceAnalysisLimits = DEFAULT_SOURCE_ANALYSIS_LIMITS,
): Promise<ExtensionSourceAnalysis> {
  const evidence = new Map<ExtensionCapabilityId, ExtensionSourceEvidence[]>();
  const files: string[] = [];
  const skipped: { file: string; reason: string }[] = [];
  const inspectedAt = new Date().toISOString();
  const entry = await resolveEntryFile(entryPath);
  if (!entry) {
    return {
      inspection: {
        status: "skipped",
        files: [],
        skipped: [{ file: entryPath, reason: "Entry file not found or not a JS/TS source file." }],
        inspectedAt,
      },
      evidence,
    };
  }
  const root = path.dirname(entry);
  const queue: { file: string; depth: number }[] = [{ file: entry, depth: 0 }];
  const seen = new Set<string>();
  let truncated = false;

  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next.file)) continue;
    seen.add(next.file);
    if (files.length >= limits.maxFiles) {
      skipped.push({ file: next.file, reason: `File limit of ${limits.maxFiles} reached.` });
      truncated = true;
      continue;
    }
    if (isInsideNodeModules(next.file)) {
      skipped.push({ file: next.file, reason: "node_modules is not inspected." });
      continue;
    }
    if (next.depth > limits.maxDepth) {
      skipped.push({ file: next.file, reason: `Import depth of ${limits.maxDepth} exceeded.` });
      truncated = true;
      continue;
    }
    const loaded = await loadSource(next.file, limits.maxFileBytes);
    if ("reason" in loaded) {
      skipped.push({ file: next.file, reason: loaded.reason });
      continue;
    }
    const parsed = parseSource(next.file, loaded.code);
    if ("reason" in parsed) {
      skipped.push({ file: next.file, reason: parsed.reason });
      continue;
    }
    files.push(next.file);
    const context: FileContext = {
      file: next.file,
      code: parsed.code,
      approximate: parsed.approximate,
      gardenLocals: new Map(),
      gardenNamespaces: new Set(),
      piIdentifier: undefined,
      bindings: collectBindings(parsed.program),
    };
    const imports = collectImports(parsed.program, context);
    for (const specifier of imports) {
      const target = await resolveRelativeImport(next.file, specifier);
      if (!target) {
        skipped.push({ file: path.resolve(root, specifier), reason: "Relative import not found." });
        continue;
      }
      queue.push({ file: target, depth: next.depth + 1 });
    }
    walk(parsed.program, (node) => {
      inspectNode(node, context, evidence);
    });
  }

  const status: ExtensionSourceInspection["status"] =
    truncated || skipped.some((entry) => !entry.reason.startsWith("node_modules"))
      ? "partial"
      : "complete";
  return {
    inspection: { status, files, skipped, inspectedAt },
    evidence,
  };
}

async function resolveEntryFile(entryPath: string): Promise<string | undefined> {
  try {
    const info = await stat(entryPath);
    if (info.isFile()) {
      return SOURCE_EXTENSIONS.some((extension) => entryPath.endsWith(extension))
        ? entryPath
        : undefined;
    }
    if (info.isDirectory()) {
      for (const extension of SOURCE_EXTENSIONS) {
        const candidate = path.join(entryPath, `index${extension}`);
        if (await isFile(candidate)) return candidate;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function isInsideNodeModules(file: string): boolean {
  return file.split(path.sep).includes("node_modules");
}

async function loadSource(
  file: string,
  maxBytes: number,
): Promise<{ code: string } | { reason: string }> {
  try {
    const info = await stat(file);
    if (info.size > maxBytes) {
      return { reason: `Larger than ${Math.round(maxBytes / 1024)} KiB; not inspected.` };
    }
    return { code: await readFile(file, "utf8") };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

function parseSource(
  file: string,
  original: string,
): { program: EstreeNode; code: string; approximate: boolean } | { reason: string } {
  const typescript = /\.[cm]?ts$/.test(file);
  let code = original;
  let approximate = false;
  if (typescript) {
    try {
      code = stripTypeScriptTypes(original, { mode: "strip" });
    } catch {
      try {
        // Enums, namespaces and parameter properties need a real transform; the
        // output no longer lines up with the original, so locations are approximate.
        code = stripTypeScriptTypes(original, { mode: "transform" });
        approximate = true;
      } catch (error) {
        return { reason: `TypeScript could not be parsed: ${describe(error)}` };
      }
    }
  }
  try {
    const program = parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
      allowHashBang: true,
      allowAwaitOutsideFunction: true,
    }) as unknown as EstreeNode;
    return { program, code, approximate };
  } catch (error) {
    if (file.endsWith(".cjs") || file.endsWith(".js")) {
      try {
        const program = parse(code, {
          ecmaVersion: "latest",
          sourceType: "script",
          locations: true,
          allowHashBang: true,
          allowReturnOutsideFunction: true,
        }) as unknown as EstreeNode;
        return { program, code, approximate };
      } catch {
        // Fall through to the module parse error.
      }
    }
    return { reason: `Syntax could not be parsed: ${describe(error)}` };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The helper package by bare name, or by an absolute path into its checkout/vendored copy
 * (test fixtures and monorepo extensions import it that way).
 */
function isGardenSpecifier(source: string): boolean {
  return (
    source === GARDEN_PACKAGE ||
    source.startsWith(`${GARDEN_PACKAGE}/`) ||
    /[\\/]extension-ui[\\/]dist[\\/]index\.js$/.test(source) ||
    /[\\/]@pi-garden[\\/]extension-ui(?:[\\/]|$)/.test(source)
  );
}

/** Records garden/TUI bindings and returns the relative specifiers to follow. */
function collectImports(program: EstreeNode, context: FileContext): readonly string[] {
  const relative: string[] = [];
  const body = program.body as readonly EstreeNode[];
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") {
      const source = literalString((statement.source as EstreeNode | undefined) ?? undefined);
      if (source === undefined) continue;
      if (isRelative(source)) relative.push(source);
      if (isGardenSpecifier(source)) {
        for (const specifier of statement.specifiers as readonly EstreeNode[]) {
          const local = (specifier.local as EstreeNode).name as string;
          if (specifier.type === "ImportNamespaceSpecifier") {
            context.gardenNamespaces.add(local);
          } else if (specifier.type === "ImportSpecifier") {
            const imported = specifier.imported as EstreeNode;
            const name =
              typeof imported.name === "string" ? imported.name : literalString(imported);
            if (name) context.gardenLocals.set(local, name);
          }
        }
      }
      continue;
    }
    if (
      statement.type === "ExportDefaultDeclaration" ||
      (statement.type === "ExpressionStatement" && isModuleExportsAssignment(statement))
    ) {
      const declaration =
        statement.type === "ExportDefaultDeclaration"
          ? (statement.declaration as EstreeNode)
          : ((statement.expression as EstreeNode).right as EstreeNode);
      const params = declaration.params as readonly EstreeNode[] | undefined;
      const first = params?.[0];
      if (first?.type === "Identifier" && typeof first.name === "string") {
        context.piIdentifier = first.name;
      }
    }
  }
  walk(program, (node) => {
    // Dynamic import("./x") and require("./x") reach local files too.
    if (node.type === "ImportExpression") {
      const source = literalString(node.source as EstreeNode);
      if (source && isRelative(source)) relative.push(source);
    } else if (node.type === "CallExpression") {
      const callee = node.callee as EstreeNode;
      if (callee.type === "Identifier" && callee.name === "require") {
        const source = literalString((node.arguments as readonly EstreeNode[])[0]);
        if (source && isRelative(source)) relative.push(source);
      }
    }
  });
  return relative;
}

function isModuleExportsAssignment(statement: EstreeNode): boolean {
  const expression = statement.expression as EstreeNode;
  if (expression.type !== "AssignmentExpression") return false;
  const left = expression.left as EstreeNode;
  return (
    left.type === "MemberExpression" &&
    memberName(left.object as EstreeNode) === "module" &&
    memberName(left.property as EstreeNode) === "exports"
  );
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

async function resolveRelativeImport(from: string, specifier: string): Promise<string | undefined> {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base];
  // TypeScript sources import `./x.js` while the file on disk is `./x.ts`.
  const stripped = base.replace(/\.(m|c)?js$/, "");
  if (stripped !== base) {
    candidates.push(`${stripped}.ts`, `${stripped}.mts`, `${stripped}.cts`);
  }
  for (const extension of SOURCE_EXTENSIONS) candidates.push(`${base}${extension}`);
  for (const extension of SOURCE_EXTENSIONS) candidates.push(path.join(base, `index${extension}`));
  for (const candidate of candidates) {
    if (
      SOURCE_EXTENSIONS.some((extension) => candidate.endsWith(extension)) &&
      (await isFile(candidate))
    ) {
      return candidate;
    }
  }
  return undefined;
}

function inspectNode(
  node: EstreeNode,
  context: FileContext,
  evidence: Map<ExtensionCapabilityId, ExtensionSourceEvidence[]>,
): void {
  if (node.type === "ImportDeclaration") {
    const source = literalString(node.source as EstreeNode);
    if (source && TUI_PACKAGES.has(source)) {
      const specifiers = node.specifiers as readonly EstreeNode[];
      // Type-only imports are stripped before parsing; a remaining import binds values.
      if (specifiers.length > 0) {
        record(evidence, "tui.component", makeEvidence(context, node, false));
      }
    }
    return;
  }
  if (node.type === "NewExpression" || node.type === "CallExpression") {
    const callee = node.callee as EstreeNode;
    if (callee.type === "Identifier") {
      const gardenName = context.gardenLocals.get(callee.name as string);
      const capability = gardenName ? GARDEN_EXPORTS[gardenName] : undefined;
      if (capability) record(evidence, capability, makeEvidence(context, callee, false));
      return;
    }
    if (callee.type !== "MemberExpression" || callee.computed === true) return;
    const property = memberName(callee.property as EstreeNode);
    if (!property) return;
    const receiver = callee.object as EstreeNode;

    if (receiver.type === "Identifier" && context.gardenNamespaces.has(receiver.name as string)) {
      const capability = GARDEN_EXPORTS[property];
      if (capability) record(evidence, capability, makeEvidence(context, callee, false));
      return;
    }

    const receiverIsUi = isUiReceiver(receiver);
    if (property === "setWidget") {
      if (!receiverIsUi && !DISTINCTIVE_UI_METHODS.has(property)) return;
      const content = (node.arguments as readonly EstreeNode[])[1];
      const classification = classifyWidgetContent(content, context.bindings);
      if (classification === "text") {
        record(evidence, "ui.widget.text", makeEvidence(context, callee, !receiverIsUi));
      } else if (classification === "component") {
        record(evidence, "ui.widget.component", makeEvidence(context, callee, !receiverIsUi));
      } else {
        record(evidence, "ui.widget.component", makeEvidence(context, callee, true));
      }
      return;
    }
    const uiCapability = UI_METHODS[property];
    if (uiCapability) {
      if (receiverIsUi) {
        record(evidence, uiCapability, makeEvidence(context, callee, false));
      } else if (DISTINCTIVE_UI_METHODS.has(property)) {
        record(evidence, uiCapability, makeEvidence(context, callee, true));
      }
      return;
    }

    const piCapability = PI_METHODS[property];
    if (piCapability) {
      const receiverIsPi =
        receiver.type === "Identifier" && receiver.name === (context.piIdentifier ?? "pi");
      record(evidence, piCapability, makeEvidence(context, callee, !receiverIsPi));
      if (property === "registerTool") {
        inspectToolDefinition(node, context, evidence, !receiverIsPi);
      }
      return;
    }
  }
}

function isUiReceiver(receiver: EstreeNode): boolean {
  if (receiver.type === "Identifier") return receiver.name === "ui";
  if (receiver.type === "MemberExpression" && receiver.computed !== true) {
    return memberName(receiver.property as EstreeNode) === "ui";
  }
  return false;
}

function classifyWidgetContent(
  content: EstreeNode | undefined,
  bindings?: ReadonlyMap<string, WidgetContentKind>,
): WidgetContentKind {
  if (!content) return "unknown";
  switch (content.type) {
    case "ArrayExpression":
    case "TemplateLiteral":
      return "text";
    case "Literal":
      return typeof content.value === "string" ? "text" : "unknown";
    case "Identifier":
      if (content.name === "undefined") return "text";
      return bindings?.get(content.name as string) ?? "unknown";
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return "component";
    default:
      return "unknown";
  }
}

/**
 * Names bound in this file whose value shape is evident: function declarations and
 * `const name = <function | array | string>`. A name bound more than once, or to
 * anything else, stays unknown so a widget passed by name is not misclassified.
 */
function collectBindings(program: EstreeNode): Map<string, WidgetContentKind> {
  const bindings = new Map<string, WidgetContentKind>();
  const note = (name: string, kind: WidgetContentKind) => {
    bindings.set(name, bindings.has(name) ? "unknown" : kind);
  };
  walk(program, (node) => {
    if (
      node.type === "FunctionDeclaration" &&
      (node.id as EstreeNode | null)?.type === "Identifier"
    ) {
      note((node.id as EstreeNode).name as string, "component");
      return;
    }
    if (node.type === "VariableDeclarator" && (node.id as EstreeNode).type === "Identifier") {
      const init = node.init as EstreeNode | null;
      note((node.id as EstreeNode).name as string, init ? classifyWidgetContent(init) : "unknown");
    }
  });
  return bindings;
}

function inspectToolDefinition(
  call: EstreeNode,
  context: FileContext,
  evidence: Map<ExtensionCapabilityId, ExtensionSourceEvidence[]>,
  partial: boolean,
): void {
  const definition = (call.arguments as readonly EstreeNode[])[0];
  if (!definition || definition.type !== "ObjectExpression") return;
  for (const property of definition.properties as readonly EstreeNode[]) {
    if (property.type !== "Property" || property.computed === true) continue;
    const key = memberName(property.key as EstreeNode);
    if (key === "renderCall") {
      record(
        evidence,
        "tool.renderCall",
        makeEvidence(context, property.key as EstreeNode, partial),
      );
    } else if (key === "renderResult") {
      record(
        evidence,
        "tool.renderResult",
        makeEvidence(context, property.key as EstreeNode, partial),
      );
    }
  }
}

function memberName(node: EstreeNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Identifier" || node.type === "PrivateIdentifier") {
    return typeof node.name === "string" ? node.name : undefined;
  }
  return literalString(node);
}

function literalString(node: EstreeNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    const quasis = node.quasis as readonly EstreeNode[];
    const expressions = node.expressions as readonly unknown[];
    if (expressions.length === 0 && quasis.length === 1) {
      const cooked = (quasis[0]!.value as { cooked?: string }).cooked;
      return typeof cooked === "string" ? cooked : undefined;
    }
  }
  return undefined;
}

function makeEvidence(
  context: FileContext,
  node: EstreeNode,
  partial: boolean,
): ExtensionSourceEvidence {
  const start = node.loc?.start ?? { line: 1, column: 0 };
  const snippet = context.code.slice(node.start, Math.min(node.end, node.start + 120)).trim();
  return {
    kind: "source",
    file: context.file,
    line: start.line,
    column: start.column + 1,
    snippet: context.approximate ? `${snippet} (approximate location)` : snippet,
    ...(partial ? { partial: true } : {}),
  };
}

function record(
  evidence: Map<ExtensionCapabilityId, ExtensionSourceEvidence[]>,
  capability: ExtensionCapabilityId,
  item: ExtensionSourceEvidence,
): void {
  const list = evidence.get(capability) ?? [];
  if (
    list.some(
      (existing) =>
        existing.file === item.file &&
        existing.line === item.line &&
        existing.column === item.column,
    )
  ) {
    return;
  }
  list.push(item);
  evidence.set(capability, list);
}

/** Depth-first walk over every ESTree child node. */
function walk(root: EstreeNode, visit: (node: EstreeNode) => void): void {
  const step = (node: EstreeNode): void => {
    visit(node);
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) step(child);
        }
      } else if (isNode(value)) {
        step(value);
      }
    }
  };
  step(root);
}

function isNode(value: unknown): value is EstreeNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { start?: unknown }).start === "number"
  );
}

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(__filename);
const helperPath = require.resolve("@pi-garden/extension-ui");

const editorModule = `
export async function mount(root, host) {
  const field = document.createElement("textarea");
  field.setAttribute("data-editor-focus", "true");
  field.value = host.getText();
  root.replaceChildren(field);
  const theme = document.createElement("output");
  theme.id = "theme";
  const boundary = document.createElement("pre");
  boundary.id = "boundary";
  root.append(theme, boundary);
  const paintTheme = () => {
    theme.textContent = (host.theme.snapshot && host.theme.snapshot.id) || host.theme.mode;
  };
  paintTheme();
  const stopTheme = host.subscribeTheme(paintTheme);
  const stopText = host.subscribeText((text) => {
    if (field.value !== text) field.value = text;
  });
  const stopCursor = host.subscribeCursor((cursor) => {
    field.selectionStart = cursor;
    field.selectionEnd = cursor;
  });
  field.addEventListener("input", () => host.setText(field.value, field.selectionStart));
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    host.setText(field.value, field.selectionStart);
    host.submit({
      shift: event.shiftKey,
      meta: event.metaKey,
      ctrl: event.ctrlKey,
      composing: event.isComposing,
    });
  });
  let parentAccess = "allowed";
  try { void parent.document.body; } catch { parentAccess = "blocked"; }
  boundary.textContent = JSON.stringify({
    preload: typeof window.piApp,
    process: typeof process,
    require: typeof require,
    parentAccess,
    origin: self.origin,
  });
  return () => { stopTheme(); stopText(); stopCursor(); };
}
`;

function extensionSource(registerEditor: boolean): string {
  const registration = registerEditor
    ? `registerDesktopEditor(pi, {
        id: "prompt",
        title: "Prompt",
        source: import.meta.url,
        frontend: new URL("./dist/editor.js", import.meta.url),
      });`
    : "";
  return `
import { registerDesktopEditor } from ${JSON.stringify(helperPath)};
export default function desktopEditor(pi) {
  ${registration}
  pi.on("session_start", (_event, ctx) => {
    let called = false;
    ctx.ui.setEditorComponent(() => {
      called = true;
      throw new Error("terminal editor factory ran");
    });
    ctx.ui.setStatus("tui-editor", typeof ctx.ui.getEditorComponent() + ":" + String(called));
    ctx.ui.setEditorComponent(undefined);
    ctx.ui.addAutocompleteProvider((current) => ({
      triggerCharacters: [":"],
      async getSuggestions(lines, line, col, context) {
        const text = (lines[line] ?? "").slice(0, col);
        if (!text.endsWith(":") && !context.force) return current.getSuggestions(lines, line, col, context);
        return { items: [{ value: "garden", label: "garden", description: "extension" }], prefix: ":" };
      },
      applyCompletion(lines, line, col, item, prefix) {
        if (prefix !== ":") return current.applyCompletion(lines, line, col, item, prefix);
        const currentLine = lines[line] ?? "";
        const next = currentLine.slice(0, Math.max(0, col - prefix.length)) + item.value + currentLine.slice(col);
        const copy = lines.slice();
        copy[line] = next;
        return { lines: copy, cursorLine: line, cursorCol: Math.max(0, col - prefix.length) + item.value.length };
      },
    }));
  });
  pi.registerCommand("editor-roundtrip", {
    description: "Set, paste, then read the editor text",
    handler: async (_args, ctx) => {
      const before = ctx.ui.getEditorText();
      ctx.ui.setEditorText("Prefilled");
      ctx.ui.pasteToEditor(" +pasted");
      ctx.ui.notify("Editor before: [" + before + "] after: [" + ctx.ui.getEditorText() + "]", "info");
    },
  });
}
`;
}

export async function installDesktopEditorFixture(input: {
  readonly workspacePath: string;
  readonly withEditor?: boolean;
}): Promise<{ readonly extensionPath: string }> {
  const directory = join(input.workspacePath, ".pi", "extensions");
  const dist = join(directory, "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "editor.js"), editorModule, "utf8");
  const extensionPath = join(directory, "desktop-editor.ts");
  await writeFile(extensionPath, extensionSource(input.withEditor !== false), "utf8");
  return { extensionPath };
}

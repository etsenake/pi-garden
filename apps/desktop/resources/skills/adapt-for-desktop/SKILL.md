---
name: adapt-for-desktop
description: Adapt one existing Pi extension so its terminal-only presentation also works in pi-garden desktop, additively, using @pi-garden/extension-ui. Use when asked to adapt, port or desktop-enable a Pi extension, or when pi-garden's Extensions page starts an "Adapt for Desktop" thread.
---

# Adapt a Pi extension for pi-garden desktop

You are adapting exactly one Pi extension so that the presentation it builds
for the terminal also appears in pi-garden, the desktop app for Pi. The
adaptation is additive: the extension must keep working unchanged in ordinary
terminal Pi 0.87.1, which has no desktop host.

The request that invoked this skill names the target. Work only on that
target. If no target path is given, ask for the exact entry file before
touching anything.

## What pi-garden already does for you

pi-garden serves these Pi APIs directly; do not rewrite them:

- `ctx.ui.select / confirm / input / editor / notify` (dialogs and notices)
- `ctx.ui.setStatus`, `ctx.ui.setWidget(key, string[])` (text status and text widgets)
- `ctx.ui.setTitle`, `setWorkingMessage`, `setWorkingVisible`, `setWorkingIndicator`, `setHiddenThinkingLabel`
- `ctx.ui.setEditorText / getEditorText / pasteToEditor`, `ctx.ui.addAutocompleteProvider`
- `ctx.ui.getToolsExpanded / setToolsExpanded`, `ctx.ui.theme / getAllThemes / getTheme / setTheme`
- `pi.registerCommand`, `pi.registerShortcut`, `pi.registerTool` (execution and the built-in tool row)

Terminal-only members do nothing useful in pi-garden: `ctx.ui.onTerminalInput`
is never called, `setHeader`/`setFooter` are no-ops, `setWidget` with a
component factory is ignored, `ctx.ui.custom()` rejects with an unsupported-host
error, and `setEditorComponent` is stored but never executed. Tool
`renderCall`/`renderResult` components are not rendered. Those are what you
adapt.

## Semantic mapping

Read the extension first and understand what each terminal presentation is
_for_. Then map by purpose, not by API name:

| Terminal presentation                                         | Purpose                      | Desktop target                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setStatus`, `setWidget(key, string[])`                       | short text                   | already native; leave alone. Use `registerStatusChrome` / `registerHeaderBadge` only when the extension wants a persistent badge rather than session status                                                                          |
| `setWidget(key, factory)` component widget                    | live panel near the composer | `registerRichSurface` on `composer-before`, `composer-after`, `sidebar` or `thread-header`                                                                                                                                           |
| `setHeader(factory)`                                          | persistent app header        | `registerRichSurface` on `app-header` (singleton)                                                                                                                                                                                    |
| `setFooter(factory)`                                          | persistent app footer        | `registerRichSurface` on `app-footer` (singleton)                                                                                                                                                                                    |
| `custom(factory)`                                             | modal picker / confirmation  | `registerRichSurface` on `overlay`, opened from an action or another surface                                                                                                                                                         |
| `custom(factory)`                                             | settings-like form           | `registerRichSurface` on `settings`                                                                                                                                                                                                  |
| `custom(factory)`                                             | large working screen         | `registerRichSurface` on `workbench` (or `registerDesktopView`)                                                                                                                                                                      |
| `onTerminalInput(handler)`                                    | keyboard command             | `registerAction(pi, { id, title, source: import.meta.url, handler, shortcut? })` (palette, buttons, shortcut) or `pi.registerShortcut`; keyboard handling that belongs to a surface stays inside that rich surface or desktop editor |
| `setEditorComponent(factory)`                                 | custom prompt editor         | `registerDesktopEditor`                                                                                                                                                                                                              |
| tool `renderCall` / `renderResult`                            | tool presentation            | `registerDesktopToolRenderer` for that tool name                                                                                                                                                                                     |
| complex multi-part TUI screen                                 | dedicated workspace          | one `workbench` rich surface                                                                                                                                                                                                         |
| anything already registered through `@pi-garden/extension-ui` | —                            | leave alone; never register a second copy                                                                                                                                                                                            |

Never do these:

- render or emulate a terminal in the browser, or execute pi-tui components there
- transpile terminal layout code mechanically into DOM code
- replace the whole composer (a desktop editor is the prompt region only; there is no `composer.replace`)
- add transcript/message rendering: `registerMessageRenderer`, `registerMarkdownTransformer`, `registerEntryRenderer` stay unsupported; leave them untouched and report them
- add UI for `pi.registerFlag`; flags are not a desktop UI target
- delete or weaken the terminal behavior

## Procedure

1. **Read the target.** Open the entry file and every relative import it
   reaches. Note each terminal-only call, what state it presents, and where
   that state lives. Identify the extension factory function and how it wires
   `session_start`, commands and tools.
2. **Check for existing desktop registrations.** If the extension already
   imports `@pi-garden/extension-ui`, extend those files and ids; do not add a
   duplicate registration or a second helper copy. A second run of this skill
   must leave an already-adapted extension unchanged apart from real gaps.
3. **Write the plan** as a short list: terminal API → desktop target → files
   you will add or edit. Prefer host-rendered targets (`registerAction`,
   surface contributions) over browser code when the semantics allow it.
4. **Vendor the helper.** The `@pi-garden/extension-ui` package directory is
   named in the request (`package.json` plus `dist/`). Copy it, unchanged, to
   `<extension directory>/node_modules/@pi-garden/extension-ui/`. Its main
   entry has no runtime dependencies, so Node resolution from the extension
   file finds it in both pi-garden and ordinary Pi, and the terminal still
   loads the extension. Do not edit the copy. If a copy is already there,
   replace it with the current one. Add `node_modules/` to the extension's
   ignore file when the directory is under version control.
   Package-installed, npm or git extensions are never edited in place: adapt
   from their source checkout instead.
5. **Make the smallest additive edits** in the entry file:
   - `import { registerRichSurface, registerAction, ... } from "@pi-garden/extension-ui";`
   - Register inside the extension factory. Registrations replay on
     discovery and dispose on `session_shutdown` by themselves.
   - `source: import.meta.url` (the entry file) and
     `frontend: new URL("./<name>.desktop/<surface>.js", import.meta.url)`.
     The frontend must live below the entry file's directory. Never name a
     frontend `index.js`; Pi would discover it as another extension.
   - Rich-surface, tool-renderer and desktop-editor ids are lowercase
     identifiers (`/^[a-z][a-z0-9._-]{0,63}$/`). Action ids follow the
     helper's `EXTENSION_ACTION_ID_PATTERN`.
   - Keep the terminal calls where they are. In pi-garden they are inert; in
     the terminal they still run.
6. **Write the browser frontends** as plain ES modules (`.js`) that export
   `mount(root, host)` and return a disposer. Do not import anything: the
   frame cannot resolve bare specifiers and the app does not bundle for you.
   Use `host.theme` / `host.subscribeTheme` for colors, `host.signal` to stop
   work, `host.tool` / `host.subscribeTool` in a tool renderer, and the
   `DesktopEditorContext` (`getText`, `setText`, `subscribeText`, `submit`,
   `autocomplete`) in a desktop editor. Build only what the surface shows.
   When the extension already has a bundler (`build.mjs`, esbuild), keep using
   it and rebuild after editing.
7. **Move live data through Chord without importing Chord.** A rich surface
   `backend` is a plain facet object; the host supplies `env`:

   ```ts
   const STATE_SERVICE = Object.freeze({ id: "my-extension.state.v1", local: false });
   registerRichSurface(pi, {
     id: "status",
     surface: "composer-before",
     title: "My status",
     source: import.meta.url,
     frontend: new URL("./my-extension.desktop/status.js", import.meta.url),
     backend: () => ({
       id: "my-extension.status.backend",
       setup(env) {
         const state = env.replicatedState(snapshot());
         env.own(subscribe((next) => state.replace(background, next)));
         env.provide(STATE_SERVICE, { state });
       },
     }),
   });
   ```

   `background` is any object satisfying Chord's `Context` interface
   (`{ value: () => undefined, get abortSignal() { return undefined; } }`),
   declared once in the entry file. In the frontend:

   ```js
   export async function mount(root, host) {
     const background = {
       value: () => undefined,
       get abortSignal() {
         return undefined;
       },
     };
     const binding = host.services.open({
       services: [{ id: "my-extension.state.v1", local: false }],
       assertAccess: () => host.signal.throwIfAborted(),
       onError: (reason) => {
         root.textContent = String(reason);
       },
     });
     const service = binding.use({ id: "my-extension.state.v1", local: false });
     await binding.ready(background);
     const stop = service.state.subscribe((next) => render(root, next, host.theme));
     if (service.state.value) render(root, service.state.value, host.theme);
     const dispose = () => {
       stop();
       binding.dispose(background).catch(() => {});
     };
     host.signal.addEventListener("abort", dispose, { once: true });
     return dispose;
   }
   ```

   Keep service method calls minimal and never pass shell text or paths from
   the browser.

8. **Validate.** Run the extension's own typecheck/lint/build if it has them.
   Then prove terminal Pi still loads it with the bundled Pi 0.87.1 from
   pi-garden's checkout or an installed Pi:

   ```sh
   node <pi-coding-agent>/dist/cli.js -e <entry file> -p "reply with ok" --no-session 2>&1 | head
   ```

   or, offline, load it through Pi's `DefaultResourceLoader` with
   `additionalExtensionPaths: [entry]` and assert zero extension errors, the
   original commands/tools still registered, and that the desktop
   registrations returned `available === false` (no desktop host). Any load
   error means the adaptation is not done.

9. **Reload pi-garden** so the new generation registers: use Extensions →
   Refresh, or `/reload` in an idle thread. Then confirm the desktop
   registrations appear (the rich surface, action, editor or tool renderer is
   listed for the session) and that the Extensions detail page's
   Desktop compatibility section now shows the new `desktop-native` findings
   with runtime evidence while the adapted terminal-only findings remain
   listed as adaptable (their terminal calls still exist by design).
10. **Report** what was adapted (terminal API → desktop registration → file),
    what was left alone and why (already native, directly supported,
    unsupported in this version), and any remaining gaps. Do not commit the
    user's extension unless the user asks.

## Boundaries

- Only the named extension and its own directory change. Do not touch
  pi-garden's source, other extensions, Pi's install, or the vendored helper.
- No new registries, marketplaces or package managers. A small data-only
  metadata file for pairing terminal and desktop pieces is fine if the
  extension needs it; a runtime registry is not.
- Keep the terminal path first-class. If a mapping would force removing
  terminal behavior, skip that mapping and report it instead.

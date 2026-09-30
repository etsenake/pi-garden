---
name: adapt-for-desktop
description: Adapt one existing Pi extension so its terminal-only presentation also works in pi-garden desktop, additively, using @pi-garden/extension-ui. Use when asked to adapt, port or desktop-enable a Pi extension, or when pi-garden's Extensions page starts an "Adapt for Desktop" thread.
---

# Adapt a Pi extension for pi-garden desktop

You are adapting exactly one Pi extension so that the presentation it builds
for the terminal also appears in pi-garden, the desktop app for Pi. The
adaptation is additive: the extension must keep working unchanged in ordinary
terminal Pi 0.99.1, which has no desktop host.

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

The writer is `apply.mjs` beside this file (built into the skill directory; plain
Node, no repository checkout). Do not hand-write a parallel set of
registrations. The Adapt prompt names the absolute writer path and the helper
package directory. Run:

```sh
node "<adapt writer path from the prompt>" "<entry>" "<helper package dir>"
```

In a pi-garden checkout before the desktop build has emitted the bundle, the
TypeScript entry still works:

```sh
pnpm exec jiti apps/desktop/resources/skills/adapt-for-desktop/apply.ts "<entry>" "<helper package dir>"
```

It vendors `@pi-garden/extension-ui` (package.json plus dist, unchanged) into
`<extension directory>/node_modules/@pi-garden/extension-ui/`, writes
`pi-garden-desktop.ts`, plain `.js` frontends under `pi-garden-desktop/`, and
`desktop-adaptation.json` beside the entry, and inserts one import plus one
`registerDesktopAdaptations(pi)` call into the extension factory. Terminal
calls stay. `source` is the entry file's URL, not the sibling module's
`import.meta.url`. A second run for the same capabilities prints `unchanged`
and does not overwrite skill-edited frontends or the desktop module body, and
does not add another import, call, or registration. Adapting a newly unpaired
capability appends only that registration and leaves prior edits intact.

`desktop-adaptation.json` is the pairing record: each terminal capability names
the api, id, surface and tool of the registration that adapted it. A rich
surface that merely exists does not adapt anything. A mounted scaffold
placeholder or pairing record alone is not completed semantic adaptation —
wire live Chord behaviour into the generated files before reporting done. Do
not add a second registration for a capability already listed there.

1. **Read the target** and the findings in the request. Note each terminal-only
   call and the extension factory (`export default function name(pi)`).
2. **Run the writer** with the exact entry and the named helper directory.
   Package-installed, npm or git extensions are never edited in place: adapt
   from their source checkout instead. Add `node_modules/` to the extension's
   ignore file when the directory is under version control.
3. **Review the diff** against the mapping table. The writer keeps the terminal
   calls and uses one registration per family (`onTerminalInput` → action
   `terminal-input`; component widget → `composer-before` `widget`; header →
   `app-header` `header`; footer → `app-footer` `footer`; `custom` → overlay
   `custom`; editor component → desktop editor `editor`; each tool's
   `renderCall` and `renderResult` share one `registerDesktopToolRenderer`;
   a pi-tui import → workbench `tui`). Frontends are plain ES modules that
   export `mount(root)` and import nothing.
4. **Live data, only inside those files.** If a surface needs the extension's
   state, move it through Chord in the generated backend and frontend without
   changing the paired id, surface or tool name and without adding another
   `register*` call. Re-running the writer for an already-paired capability
   leaves those edited files alone. Re-run only when a new unpaired capability
   still needs a scaffold.
5. **Move live data through Chord without importing Chord.** A rich surface
   `backend` is a plain facet object; the host supplies `env`:

   ```ts
   const STATE_SERVICE = Object.freeze({ id: "my-extension.state.v1", local: false });
   registerRichSurface(pi, {
     id: "status",
     surface: "composer-before",
     title: "My status",
     source: new URL("./index.ts", import.meta.url).href,
     frontend: new URL("./pi-garden-desktop/status.js", import.meta.url),
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

6. **Validate.** Run the extension's own typecheck/lint/build if it has them.
   Then prove terminal Pi still loads it with the bundled Pi 0.99.1 from
   pi-garden's checkout or an installed Pi:

   ```sh
   node <pi-coding-agent>/dist/cli.js -e <entry file> -p "reply with ok" --no-session 2>&1 | head
   ```

   or, offline, load it through Pi's `DefaultResourceLoader` with
   `additionalExtensionPaths: [entry]` and assert zero extension errors, the
   original commands/tools still registered, and that the desktop
   registrations returned `available === false` (no desktop host). Any load
   error means the adaptation is not done.

7. **Reload pi-garden** so the new generation registers: use Extensions →
   Refresh, or `/reload` in an idle thread. Confirm the generated surface is
   visible and the Extensions detail page shows each paired terminal finding
   as **Adapted**, naming the registration in `desktop-adaptation.json`.
   Findings that are still **Adaptable** were not paired. Run the writer a
   second time; it must print `unchanged`.
8. **Report** what was adapted (terminal API → desktop registration → file),
   what was left alone and why (already paired, directly supported,
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

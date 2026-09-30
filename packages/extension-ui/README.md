# Desktop extension author helper

The existing Pi extension owns the backend. An optional browser module owns the
view. This package connects them through Chord without scanning or loading a
second extension instance.

```ts
import { registerDesktopView } from "@pi-garden/extension-ui";
import { defineFacet } from "@earendil-works/chord";

export default function extension(pi) {
  registerDesktopView(pi, {
    id: "review",
    title: "Review",
    source: import.meta.url,
    frontend: new URL("./dist/desktop.js", import.meta.url),
    backend: () =>
      defineFacet({
        id: "review-backend",
        setup(env) {
          // Use env.replicatedState and provide your shared service token here.
          // Close over the same Pi extension's commands, tools, and saved state.
        },
      }),
  });
}
```

## Host-rendered surfaces

`registerHeaderBadge`, `registerSidebarSection`, `registerSidebarFooter`,
`registerComposerBefore`, `registerComposerAfter`, and `registerStatusChrome`
contribute a label to the conversation header, a section in the primary sidebar
body, the sidebar footer, the area before the composer, the area after the
composer, or the topbar status chrome. Each takes a stable `id`,
visible `text`, an optional semantic `tone` (`default`, `accent`, `success`,
`warning`, `error`, or `muted`), and an optional integer `order`. Omitted tone
is `default`. Omitted order is `0`. Lower orders render first, and equal orders
use the id. The same id on different surfaces is independent. A later
registration with the same id on the same surface replaces text, tone, and
order.

A contribution may set `actionId` to an id from `registerAction`. The host
renders a button and invokes that action. The extension does not supply a
callback, HTML, CSS, or React.

The extension supplies no HTML, CSS, class names, or colors. Pi Garden renders
the contribution and maps the tone onto the active theme. Discovery replays the
registration. Session shutdown removes it. Terminal Pi reports
`available === false`.

`registerAction` takes a stable `id`, `title`, `source` (`import.meta.url`),
an optional `description`, an optional shortcut such as `ctrl+shift+m`, and a
handler. The handler stays in the extension process. The same id is what a
button, the command palette, and the shortcut invoke. Pi `registerCommand` and
`registerShortcut` stay the command and shortcut APIs; Pi Garden discovers them.

## Rich surfaces

`registerRichSurface` is the generalized declaration. `registerDesktopView` remains
the workbench compatibility wrapper and still emits the original desktop-view
events. A rich declaration names a stable `id`, a placement, `source`, a prebuilt
browser `frontend`, and a `backend` facet factory. Additive placements take an
optional integer `order` (omitted means `0`). Lower orders render first. Equal
orders use the extension id, then the surface id. Placement is a closed set:

| Placement                                                                                | Rule                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-header`, `app-footer`                                                               | Singleton. The lowest extension id, then id, mounts. The host shows the other owners as a conflict.                                                                        |
| `sidebar`, `thread-header`, `composer-before`, `composer-after`, `settings`, `workbench` | Additive, in deterministic order.                                                                                                                                          |
| `overlay`                                                                                | Registered, not auto-mounted. `host.actions.presentOverlay(id)` asks the host to open it. The overlay mount calls `host.actions.settle(value)` or `host.actions.cancel()`. |
| `tool`                                                                                   | Use `registerDesktopToolRenderer`. One renderer owns one Pi tool name. A second claim is a conflict and the built-in tool row stays.                                       |

The browser module still exports `mount(root, host)` and runs in the sandboxed
frame. It does not receive Node, Electron, or the parent preload. `host.tool` and
`host.subscribeTool` carry tool presentation state for a tool renderer.
`host.subscribeTheme` reports the same live theme snapshot the host already
pushes into the frame. Closing a surface drops the frame. It does not delete
extension state or cancel accepted backend work.

These surfaces are the Pi Garden targets for a later adaptation of terminal
`setWidget` component factories, `setHeader`, `setFooter`, and `custom()`. Those
factories are not executed in the browser.

`registerDesktopView` returns an object with `available` and `dispose()`. Terminal
Pi reports `available === false`. Availability acknowledges discovery; the desktop
validates the loaded extension source and browser assets before activating the
backend. Discovery replays the same declaration, and session shutdown unregisters
it. The helper does not invoke the backend factory.

The browser entry exports `mount(root, host)`, returning a cleanup function or a
promise of one. `DesktopViewContext` is exported from
`@pi-garden/extension-ui/browser`. Its `services` is a Chord `RemoteServiceSource`, so
the frontend can create its own facet host with `serviceSources: [host.services]`.
Use `env.use(Service)` during setup, then subscribe to state in `env.onActivate`.
Bundle the browser's framework and Chord dependencies. Backend facets must create
state with `env.replicatedState`, which uses the host's Chord instance.

`host.actions.openFile({ path, line?, column? })` opens a scoped file target.
`host.actions.prepareTaskDraft({ title, prompt, files? })` prepares a task draft.
Neither accepts a workspace, session, or window identity. The desktop binds actions
to the initiating connection. The host supplies theme colors, a `theme.snapshot` of the
active Pi Garden theme (id, variant, seed, syntax theme, and semantic tokens), and an `AbortSignal`
that reports connection loss; the frontend should stop using old service handles
when that signal aborts.

`@pi-garden/extension-ui/transport` provides server and client connections over an
ordered JSON message channel. Each connection owns a Chord endpoint; Chord owns
service dispatch and replicated state. The adapter validates complete messages,
uses a separate state codec per subscription, and buffers updates until hydration
is installed. Closing a connection releases subscriptions and rejects waiting
client requests. Accepted backend work continues, and late responses are discarded.
An explicit request cancellation propagates its abort signal to the backend method.
Connection teardown never disposes the shared backend host.

The package build emits `dist/frame-bridge.js`, a self-contained browser module for
the app-owned frame bootstrap. It exports `createChordClientConnection` and
`parseDesktopHostAction`. The desktop supplies and scopes the channel; this package
does not expose Electron, Node, filesystem access, or general IPC to the browser.

Run `pnpm --filter @pi-garden/extension-ui test` for registration, action validation,
transport lifecycle, malformed-message, and separate-browser-bundle checks. The
bundle test executes two distinct browser-target modules in Node to prove the
Chord module boundary; desktop tests separately prove the real iframe/IPC flow.

Desktop development starts `pnpm --filter @pi-garden/extension-ui watch` alongside
the other shared-package watchers. Each TypeScript emit is followed by a browser
bridge rebuild, so edits update both the normal modules and the self-contained
frame entry. The watcher closes both compiler and bundler resources on shutdown.

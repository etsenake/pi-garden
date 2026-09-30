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

The extension supplies no HTML, CSS, class names, or colors. Pi Garden renders
the contribution and maps the tone onto the active theme. Discovery replays the
registration. Session shutdown removes it. Terminal Pi reports
`available === false`.

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
to the initiating connection. The host supplies theme colors and an `AbortSignal`
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

---
name: create-rich-surface
description: Use when creating a new Pi extension rich surface or desktop widget (composer-before/after, sidebar, thread-header, overlay, settings, app-header/footer) with a browser mount() and Chord backend, not a full workbench tab and not host-rendered text-only badges.
---

# Create a rich surface (widget)

You are creating a **new** Pi extension that mounts a sandboxed browser frontend
near the conversation chrome via `registerRichSurface`. Use this for live panels
and widgets. For text-only host labels, use **create-host-contribution**. For a
dedicated workbench tab, use **create-desktop-view**. To port an existing
terminal UI, use **adapt-for-desktop**.

## Placement

| `surface`                                                                   | Rule                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `composer-before`, `composer-after`, `sidebar`, `thread-header`, `settings` | Additive; optional `order`                                     |
| `overlay`                                                                   | Registered only; open with `host.actions.presentOverlay(id)`   |
| `app-header`, `app-footer`                                                  | Singleton (lowest extension id + id wins)                      |
| `workbench` / `tool`                                                        | Prefer **create-desktop-view** / `registerDesktopToolRenderer` |

## Procedure

1. Confirm output directory and a stable surface id.
2. Run the writer:

```sh
node "<writer apply.mjs>" "<output-extension-dir>" "<surface-id>" "<surface-kind>" "<helper-package-dir>"
```

`surface-kind` is one of: `composer-before`, `composer-after`, `sidebar`,
`thread-header`, `overlay`, `settings`, `app-header`, `app-footer`.

3. Wire live state through Chord inside the generated `backend` and
   `frontend` only. Do not add a second `registerRichSurface` for the same id.
4. Theme the frontend with `host.theme` and `host.subscribeTheme` — never
   hardcode a brand palette. Prefer CSS variables from
   `background` / `foreground` / `accent` and, when present,
   `theme.snapshot.seed` / `theme.snapshot.tokens`. See **theme-pi-garden** for
   how Garden themes differ from Pi themes.
5. Rebuild is not required for plain ES module frontends the writer emits.
6. Extensions → Refresh or `/reload`. Confirm the surface mounts and Frames
   dispose cleanly on close.
7. Terminal Pi must still load; registration returns `available === false`.

## Frontend rules

- Export `mount(root, host)` returning a disposer (or Promise of one).
- No Node, Electron, or parent preload. Bundle your own deps if you add any.
- Observe `host.signal` abort; dispose Chord bindings on abort.
- Keep service calls minimal; never pass shell text or paths from the browser
  except through typed host actions (`openFile`, `prepareTaskDraft`, overlay
  settle/cancel).

## Boundaries

- Do not edit pi-garden source or the vendored helper.
- Do not emulate a terminal or execute pi-tui in the browser.
- Do not commit unless asked.

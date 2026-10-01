---
name: create-desktop-view
description: Use when creating a new Pi extension workbench desktop view or full Chord-backed tab (PR Review / Test Runs style), including registerDesktopView or registerRichSurface on workbench, not small composer widgets or host-rendered badges.
---

# Create a desktop workbench view

You are creating a **new** Pi extension with a workbench tab: backend owns
commands/tools/state; browser `mount(root, host)` draws the UI over Chord.
Terminal commands must keep working when no desktop host is present.

For small chrome widgets use **create-rich-surface**. For text badges use
**create-host-contribution**. To port terminal presentation use
**adapt-for-desktop**.

## Procedure

1. Confirm output directory and a stable view id (`^[a-z][a-z0-9._-]{0,63}$`).
2. Run the writer:

```sh
node "<writer apply.mjs>" "<output-extension-dir>" "<view-id>" "<helper-package-dir>"
```

3. Replace scaffold state/methods with the real workflow. Keep one Pi entry
   (`index.ts`) that registers commands/tools **and** the desktop view.
4. Theme with `host.theme` / `host.subscribeTheme` (Garden tokens). Do not
   hardcode palettes. See **theme-pi-garden** for Garden vs Pi theme model.
5. If you add a bundler for a richer frontend, keep the browser entry as a
   prebuilt ES module under the extension directory; Pi loads `index.ts`, never
   register `desktop.js` as a Pi extension.
6. Configure Pi `extensions` to the entry path. Refresh in pi-garden. Open
   **Add tab (+)** → Extension views.
7. Validate: extension tests if present; terminal load with
   `available === false`; Electron open/close/reload of the view.

## Contract reminders

- `registerDesktopView` is the workbench wrapper over rich surfaces.
- Backend facets use `env.replicatedState` on the host Chord instance.
- Frontend waits for service `ready()` before reading state.
- Host actions: `openFile`, `prepareTaskDraft` only — no general filesystem.
- Closing a tab disposes the frame, not accepted backend work.

## Boundaries

- Do not edit pi-garden source or the vendored helper.
- Do not commit unless asked.

---
name: create-host-contribution
description: Use when creating a new Pi extension that contributes host-rendered labels (header badges, sidebar sections/footers, composer before/after, status chrome) or when asked for a garden badge, chrome contribution, or text-only desktop surface without a browser frontend.
---

# Create a host-rendered contribution

You are creating a **new** Pi extension that contributes short labels pi-garden
draws itself. No HTML, CSS, React, or Chord. Terminal Pi reports
`available === false` and shows nothing.

If the user already has a terminal extension to port, use **adapt-for-desktop**
instead. For live panels with a browser `mount()`, use **create-rich-surface**.
For a full workbench tab, use **create-desktop-view**. For Garden theme
documents (`pi-garden.theme/v1`), use **theme-pi-garden**.

## Choose the API

| Need                                | Call                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| Conversation header chip            | `registerHeaderBadge`                                    |
| Primary sidebar body                | `registerSidebarSection`                                 |
| Sidebar footer                      | `registerSidebarFooter`                                  |
| Above the composer                  | `registerComposerBefore`                                 |
| Below the composer                  | `registerComposerAfter`                                  |
| Topbar status chrome                | `registerStatusChrome`                                   |
| Palette / shortcut / button handler | `registerAction` + optional `actionId` on a contribution |

Each contribution: stable `id` (`^[a-z][a-z0-9._-]{0,63}$`), `text` (max 32),
optional `tone` (`default` \| `accent` \| `success` \| `warning` \| `error` \|
`muted`), optional `order` (lower first), optional `actionId`.

**Never** pass colors, class names, HTML, or CSS. The host maps `tone` onto the
active Garden theme.

## Procedure

1. Confirm target directory (prefer the workspace / user extensions path named
   in the request). Ask only if missing.
2. Pick a lowercase extension folder name and contribution `id`s.
3. Run the writer (paths come from the Adapt-style prompt when started from
   pi-garden; otherwise resolve `apply.mjs` beside this skill):

```sh
node "<writer apply.mjs>" "<output-extension-dir>" "<extension-id>" "<helper-package-dir>"
```

4. Edit the generated `index.ts` for real labels, tones, and optional actions.
   Do not invent a second registration style.
5. Ensure the extension is on Pi's `extensions` list or under a discovered
   extensions directory. Add `node_modules/` to ignore when version-controlled.
6. In pi-garden: Extensions → Refresh (or `/reload` on an idle thread). Confirm
   labels appear and Extensions diagnostics are clean.
7. Prove terminal Pi still loads the entry (helper may report
   `available === false`).

## Boundaries

- Do not edit pi-garden app source, vendored `@pi-garden/extension-ui`, or other
  extensions.
- Do not call `registerRichSurface` / `registerDesktopView` from this skill.
- Do not commit unless the user asks.

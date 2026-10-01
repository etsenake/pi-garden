---
name: theme-pi-garden
description: Use when authoring or editing Pi Garden themes (pi-garden.theme/v1 seed + syntaxTheme), when a Pi colors theme is wrong for desktop, or when asked how Garden theming differs from basic Pi themes.
---

# Theme Pi Garden (not basic Pi)

Pi Garden themes are **not** Pi CLI `name` + `colors` documents. Garden uses
`format: "pi-garden.theme/v1"` with a six-colour **seed** per light/dark variant
plus a bundled **syntaxTheme** id. The desktop derives every UI token from that
seed. Pi's theme schema rejects Garden documents (`additionalProperties: false`);
pi-garden still loads them from the same theme discovery paths Pi uses.

Use this skill to create or edit Garden theme files. Do not invent a parallel
theme system. For extension UI that only *consumes* the active theme, follow
`host.theme` / tones in **create-rich-surface** / **create-host-contribution**;
still read the quick mapping below.

## Garden vs Pi

| | Pi theme | Garden theme |
| --- | --- | --- |
| Format | `name` + `colors` (+ optional `vars` / `export`) | `format: "pi-garden.theme/v1"` |
| Colour model | Large role map (text, borders, markdown, tools, …) | Seed: `surface`, `ink`, `accent`, `added`, `removed`, `warning` |
| Syntax | Embedded in colour roles | Explicit `syntaxTheme` (bundled Shiki id) |
| Pi CLI | Valid | Reported invalid |
| Pi Garden | Mapped approximately from roles | First-class |

## Document shape

```json
{
  "format": "pi-garden.theme/v1",
  "id": "harbor",
  "name": "Harbor",
  "description": "Cool coastal neutrals.",
  "variants": {
    "light": {
      "seed": {
        "surface": "#f3f7fa",
        "ink": "#1a2a33",
        "accent": "#0b6e99",
        "added": "#1a7f37",
        "removed": "#cf222e",
        "warning": "#9a6700"
      },
      "syntaxTheme": "github-light-default"
    },
    "dark": {
      "seed": {
        "surface": "#0b1d2a",
        "ink": "#d6e4ee",
        "accent": "#7eb6d6",
        "added": "#3fb950",
        "removed": "#f85149",
        "warning": "#d29922"
      },
      "syntaxTheme": "github-dark-default"
    }
  }
}
```

Rules:

- `id` / theme ids: 1–80 chars, no `/`, `:`, or control characters.
- At least one of `light` / `dark`. Exact keys only — no extras.
- Seed hex colours `#rrggbb`. Surface/ink contrast must be ≥ 3:1.
- `syntaxTheme` must be a bundled id (see list in the writer output / request).
- Builtin `garden` already ships in the app; user/project files add more ids.

## Where files live

Same discovery as Pi themes:

- User: `~/.pi/agent/themes/*.json`, `settings.json` `themes` entries, packages
  with `pi.themes`
- Project: trusted workspace `.pi/themes` / settings / packages

After writing: Appearance → Color preset should list the theme once discovery
refreshes (restart or reopen settings if needed). Selecting it must update
extension frames via `host.subscribeTheme`.

## Procedure

1. Confirm themes directory (user agent `themes/` or trusted project). Prefer
   the path named in the request.
2. Choose a new `id` that does not collide with builtins (`garden`, `default`,
   …) unless intentionally replacing a user file of the same id.
3. Run:

```sh
node "<writer apply.mjs>" "<themes-directory>" "<theme-id>"
```

4. Edit seed colours and `syntaxTheme` for both variants. Keep contrast.
5. Do **not** convert to a Pi `colors` document “so the CLI accepts it” — that
   loses Garden fidelity. If both are needed, keep separate files.
6. Verify in pi-garden Appearance and in an open rich surface / desktop view.

## Extension UI consumption (quick)

- Host contributions: semantic `tone` only.
- Rich / desktop frontends: `host.theme.background|foreground|accent|mode`,
  `host.subscribeTheme`, optional `theme.snapshot.seed` and
  `theme.snapshot.tokens` (CSS variables). Never hardcode Garden’s coral/cream.

## Boundaries

- Do not edit pi-garden builtin preset source to “add” a user theme; write a
  file under theme discovery paths.
- Do not commit user theme files unless asked.

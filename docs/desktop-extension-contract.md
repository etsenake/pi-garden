# Desktop extension contract (v1)

Status: **freeze candidate** for pi-garden desktop customization against bundled
Pi `@earendil-works/pi-coding-agent` **0.99.1**. The helper
`@pi-garden/extension-ui` remains private (no npm publication). This document is
the public desktop contract for first-version freeze.

Companion sources:

- [Parity manifest](pi-extension-ui-parity.md) and
  [signature baseline](pi-extension-ui-parity.signatures.json)
- [Architecture](architecture.md) (owners, CSP, Chord host)
- [Author helper](../packages/extension-ui/README.md)
- [Adapt for Desktop skill](../apps/desktop/resources/skills/adapt-for-desktop/SKILL.md)

## Scope (in)

| Family | Contract |
| --- | --- |
| Surface Registry | Host-rendered text/tone/badge/button contributions; no iframe |
| Rich surfaces | Sandboxed iframe + Chord; placements in helper README |
| Tool renderers | `registerDesktopToolRenderer`; built-in row on conflict/failure |
| Custom editors | `registerDesktopEditor` replaces only the text-editor region |
| Autocomplete | Stacked Pi providers coexisting with slash/mentions |
| Themes | Live theme snapshot into frames; catalog via `ctx.ui` theme APIs |
| Commands / shortcuts / actions | Pi registrations + `registerAction`; host palette/shortcut routing |
| Adapt for Desktop | Additive pairing via `desktop-adaptation.json`; terminal path remains |

## Scope (out of first version)

- Transcript / message / markdown / entry rendering customization
- `registerFlag` UI
- Marketplace / npm publication of the helper
- Automatic commits of adapted user extensions
- Visual redesign or new customization families beyond the table above

## Ownership

| Concern | Owner |
| --- | --- |
| Canonical draft, submit, attachments, queue, model/reasoning/send | Desktop conversation host |
| Runtime, tools, commands, session truth | Pi |
| Rich UI process isolation | Extension view owner + opaque-origin iframe |
| Compatibility inventory | Extension compatibility owner (source ≠ runtime ≠ pairing) |
| Small contributions | Surface Registry |

## Lifecycle

- Discovery replays registrations per runtime generation.
- Reload / disable / removal / invalidation retires that generation’s
  contributions, connections, and runtime compatibility evidence.
- Stale-generation callbacks, messages, and results are rejected.
- Project extensions run only after Pi project trust is resolved; untrusted
  project code must not execute. User/global extensions remain available.

## Conflicts and fallback

- Header/footer: singleton by extension id then surface id; losers are `conflict`.
- Tool name: two claims demote both; built-in tool row remains.
- Shortcut / action conflicts: registry precedence; reserved built-ins preserved.
- Tool-renderer frame/backend failure: built-in fallback keeps streaming/result/error.
- Editor failure: canonical draft preserved; host textarea restored.

## Security

- Browser contracts stay Electron-independent (`@pi-garden/extension-ui` browser/types).
- Frame: `allow-scripts` opaque origin, per-connection CSP (no network/workers/nested frames).
- Assets served only under the matched extension directory via `pi-extension://`.
- Host actions are narrow (open file, prepare draft, overlay settle/cancel).
- IPC: main-frame sender checks; no broad Node/preload in the frame.

## Adaptation metadata

- Writer scaffolds registrations and `desktop-adaptation.json` pairs.
- Pairing / mounted scaffold ≠ completed semantic adaptation; skill must wire live behaviour.
- Reruns preserve skill edits; only unpaired capabilities append.
- Mutation limited to the named editable local user/global (or trusted project) extension.
- Ordinary Pi must still load adapted extensions (registrations inert without a desktop host).

## Compatibility evidence

Keep three evidence kinds separate:

1. **Source** — bounded static inspection (may be `partial` / `unknown`)
2. **Registration / runtime** — generation-bound observations
3. **Pairing** — `adapted` only when metadata names a registration present in source

## Upgrades

A Pi upgrade that adds, removes, or reshapes in-scope APIs must fail
`scripts/extension-ui-parity.test.mjs` until the manifest and signature baseline
are deliberately reviewed. Contract version bumps with that review.

**Contract version:** `1.0.0-0.99.1`

---
name: pi-garden-reference
description: Use when you need Pi or Pi Garden docs, API types, examples, or source — Pi extension APIs (ExtensionAPI, ExtensionContext, events, commands, settings, context usage, compaction), the Pi SDK or TUI, Chord services and replicated state, @pi-garden/extension-ui, desktop extension contracts, or how Pi Garden itself works. Read this before guessing an API or digging through app.asar.
---

# Pi and Pi Garden reference

Pi Garden ships a plain-file reference: Pi's README, docs, examples, and API
types; the types of Pi's runtime packages, including Chord; and the Pi Garden
source this build was made from. Prefer it over the `app.asar` paths in the
system prompt — bash can't list or search inside the asar, and the asar has no
`.d.ts` files or Pi examples.

## Where it is

- Packaged app: `../../reference/` relative to this skill's directory.
- Pi Garden checkout: `apps/desktop/build/reference/`, created by
  `pnpm --filter @pi-garden/desktop build:reference`. In a checkout the source
  itself is the primary reference.

Read `INDEX.md` there first. It lists versions, the source commit, the layout,
and which file answers which kind of question.

## How to use it

- Search with `rg` across the reference, list with `ls`, read with `read`.
- For an API shape, read the `.d.ts` under `packages/@earendil-works/<name>/dist/`
  instead of inferring it from prose.
- For Pi Garden behavior, read `pi-garden/`; it matches this build's commit.
- Don't edit the reference or vendor from it. Extensions vendor
  `@pi-garden/extension-ui` from the separate `extension-ui` resource.

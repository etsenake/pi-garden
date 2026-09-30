import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The manifest must classify every member of the bundled Pi `ExtensionUIContext`
// with one exact owner; a Pi upgrade that adds or removes a member fails here
// until docs/pi-extension-ui-parity.md is updated.

const root = process.cwd();
const piPackage = "@earendil-works/pi-coding-agent";
// The package's exports map hides its d.ts files, so resolve the root and walk in.
const piRoot = join(root, "node_modules", piPackage);
const piVersion = JSON.parse(readFileSync(join(piRoot, "package.json"), "utf8")).version;
const typesPath = join(piRoot, "dist", "core", "extensions", "types.d.ts");
const manifest = readFileSync(join(root, "docs", "pi-extension-ui-parity.md"), "utf8");

const classifications = new Set([
  "implemented and verified in Pi Garden",
  "implemented by this task",
  "owned by the interaction system",
  "owned by the theme system",
  "owned by rich desktop surfaces",
  "owned by editor customization",
  "owned by Adapt for Desktop",
  "explicitly deferred: transcript rendering only",
]);

/** Member name -> declaration count (overloads) from the bundled declaration. */
export function declaredMembers(source) {
  const start = source.indexOf("export interface ExtensionUIContext {");
  assert.notEqual(start, -1, "bundled Pi types no longer declare ExtensionUIContext");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end).split("\n").slice(1);
  const counts = new Map();
  for (const line of body) {
    // Members sit at one indent level; continuation lines of a signature and
    // doc comments are deeper or start with `*` / `/**`.
    const match = /^ {4}(?:readonly )?([A-Za-z_$][\w$]*)\s*[(<:]/.exec(line);
    if (match) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
  return counts;
}

/** Rows of the Members table: `{ member, classification }`. */
export function manifestRows(markdown) {
  const section = markdown.slice(markdown.indexOf("## Members"));
  const rows = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) {
      continue;
    }
    const cells = line
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
    const member = /^`([A-Za-z_$][\w$]*)/.exec(cells[0])?.[1];
    const classification = /^`([^`]+)`$/.exec(cells[1] ?? "")?.[1];
    rows.push({ member, classification, raw: line });
  }
  return rows;
}

test("manifest names the bundled Pi version", () => {
  assert.match(
    manifest,
    new RegExp(`Pi version: \`${piPackage}\` ${piVersion.replaceAll(".", "\\.")}\\b`),
  );
});

test("every bundled ExtensionUIContext member has exactly one owner", () => {
  const declared = declaredMembers(readFileSync(typesPath, "utf8"));
  assert.ok(declared.size >= 20, `unexpectedly small declaration: ${declared.size} members`);
  const rows = manifestRows(manifest);
  const seen = new Map();
  for (const row of rows) {
    assert.ok(row.member, `manifest row without a member name: ${row.raw}`);
    assert.ok(
      row.classification && classifications.has(row.classification),
      `${row.member}: classification must be one exact term, got ${JSON.stringify(row.classification)}`,
    );
    assert.ok(declared.has(row.member), `${row.member} is not declared by Pi ${piVersion}`);
    seen.set(row.member, (seen.get(row.member) ?? 0) + 1);
  }
  for (const [member, count] of declared) {
    assert.equal(
      seen.get(member) ?? 0,
      count,
      `${member}: expected ${count} manifest row(s) (one per declaration), found ${seen.get(member) ?? 0}`,
    );
  }
});

test("transcript rendering is the only deferred family", () => {
  const deferred = manifestRows(manifest).filter((row) =>
    row.classification?.startsWith("explicitly deferred"),
  );
  for (const row of deferred) {
    assert.equal(row.classification, "explicitly deferred: transcript rendering only", row.raw);
  }
});

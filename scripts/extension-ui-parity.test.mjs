import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Parity guard for bundled Pi 0.99.1 customization contracts.
 *
 * Fails when ExtensionUIContext or the in-scope ExtensionAPI registration
 * members are added, removed, or change signature/type shape while keeping
 * the same name. Update docs/pi-extension-ui-parity.md and
 * docs/pi-extension-ui-parity.signatures.json together after deliberate review.
 */

const root = process.cwd();
const piPackage = "@earendil-works/pi-coding-agent";
const piRoot = join(root, "node_modules", piPackage);
const piVersion = JSON.parse(readFileSync(join(piRoot, "package.json"), "utf8")).version;
const typesPath = join(piRoot, "dist", "core", "extensions", "types.d.ts");
const manifestPath = join(root, "docs", "pi-extension-ui-parity.md");
const signaturesPath = join(root, "docs", "pi-extension-ui-parity.signatures.json");
const manifest = readFileSync(manifestPath, "utf8");
const typesSource = readFileSync(typesPath, "utf8");

const classifications = new Set([
  "implemented and verified in Pi Garden",
  "owned by the interaction system",
  "owned by the theme system",
  "owned by rich desktop surfaces",
  "owned by editor customization",
  "owned by Adapt for Desktop",
  "explicitly deferred: transcript rendering only",
]);

/** Registration APIs that define the desktop customization surface. */
const EXTENSION_API_CUSTOMIZATION_MEMBERS = [
  "registerCommand",
  "registerShortcut",
  "registerTool",
  "registerFlag",
  "registerMessageRenderer",
  "registerMarkdownTransformer",
  "registerEntryRenderer",
];

/**
 * Collect one interface body's member declarations with a normalized signature
 * fingerprint. Multi-line overloads stay separate entries under the same name.
 */
export function interfaceMembers(source, interfaceName) {
  const start = source.indexOf(`export interface ${interfaceName} {`);
  assert.notEqual(start, -1, `bundled Pi types no longer declare ${interfaceName}`);
  let depth = 0;
  let end = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `unclosed interface ${interfaceName}`);
  const body = source.slice(source.indexOf("{", start) + 1, end);
  const members = [];
  let pending = "";
  let paren = 0;
  let angle = 0;
  let brace = 0;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!pending) {
      if (
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("//") ||
        trimmed === "" ||
        trimmed.startsWith("@")
      ) {
        continue;
      }
      if (!/^((?:readonly\s+)?[A-Za-z_$][\w$]*)\s*[<(,:]/.test(trimmed)) {
        continue;
      }
    }
    pending = pending ? `${pending} ${trimmed}` : trimmed;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      // `=>` is an arrow, not a generic closer.
      if (ch === "=" && trimmed[i + 1] === ">") {
        i += 1;
        continue;
      }
      if (ch === "(") paren += 1;
      else if (ch === ")") paren -= 1;
      else if (ch === "<") angle += 1;
      else if (ch === ">") angle -= 1;
      else if (ch === "{") brace += 1;
      else if (ch === "}") brace -= 1;
    }
    if (paren === 0 && angle === 0 && brace === 0 && /;\s*$/.test(pending)) {
      const signature = normalizeSignature(pending);
      const name = /^((?:readonly\s+)?)([A-Za-z_$][\w$]*)/.exec(signature)?.[2];
      assert.ok(name, `could not parse member name from ${signature}`);
      members.push({ name, signature });
      pending = "";
      paren = 0;
      angle = 0;
      brace = 0;
    }
  }
  assert.equal(pending, "", `unfinished member in ${interfaceName}: ${pending}`);
  return members;
}

/** Collapse whitespace and strip trailing comments for stable fingerprints. */
export function normalizeSignature(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*$/, ";")
    .trim();
}

export function declaredMemberCounts(members) {
  const counts = new Map();
  for (const member of members) {
    counts.set(member.name, (counts.get(member.name) ?? 0) + 1);
  }
  return counts;
}

export function signatureBook(members) {
  const book = {};
  for (const member of members) {
    book[member.name] ??= [];
    book[member.name].push(member.signature);
  }
  for (const name of Object.keys(book)) book[name].sort();
  return book;
}

/** Rows of the Members table: `{ member, classification }`. */
export function manifestRows(markdown) {
  const section = markdown.slice(markdown.indexOf("## Members"));
  const rows = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
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

export function loadSignatureBaseline(path = signaturesPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function currentSignatureSnapshot(source = typesSource) {
  const ui = interfaceMembers(source, "ExtensionUIContext");
  const api = interfaceMembers(source, "ExtensionAPI").filter((member) =>
    EXTENSION_API_CUSTOMIZATION_MEMBERS.includes(member.name),
  );
  return {
    piPackage,
    piVersion,
    extensionUIContext: signatureBook(ui),
    extensionAPI: signatureBook(api),
  };
}

test("manifest names the bundled Pi version", () => {
  assert.match(
    manifest,
    new RegExp(`Pi version: \`${piPackage}\` ${piVersion.replaceAll(".", "\\.")}\\b`),
  );
});

test("every bundled ExtensionUIContext member has exactly one owner", () => {
  const declared = declaredMemberCounts(interfaceMembers(typesSource, "ExtensionUIContext"));
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

test("manifest classifications are freeze terms (no stale phase labels)", () => {
  for (const row of manifestRows(manifest)) {
    assert.notEqual(
      row.classification,
      "implemented by this task",
      `${row.member}: replace stale phase classification with "implemented and verified in Pi Garden"`,
    );
  }
  assert.doesNotMatch(manifest, /\bPhase\s+\d+\b/i);
});

test("transcript rendering is the only deferred family", () => {
  const deferred = manifestRows(manifest).filter((row) =>
    row.classification?.startsWith("explicitly deferred"),
  );
  for (const row of deferred) {
    assert.equal(row.classification, "explicitly deferred: transcript rendering only", row.raw);
  }
});

test("ExtensionUIContext and customization ExtensionAPI signatures match the reviewed baseline", () => {
  const baseline = loadSignatureBaseline();
  const current = currentSignatureSnapshot();
  assert.equal(baseline.piPackage, current.piPackage);
  assert.equal(baseline.piVersion, current.piVersion);
  assert.deepEqual(
    baseline.extensionUIContext,
    current.extensionUIContext,
    "ExtensionUIContext signature drift — review docs/pi-extension-ui-parity.md and update signatures JSON",
  );
  assert.deepEqual(
    baseline.extensionAPI,
    current.extensionAPI,
    "ExtensionAPI customization signature drift — review and update signatures JSON",
  );
});

test("negative: renamed ExtensionUIContext member fails the owner table", () => {
  const mutated = typesSource.replace(
    "export interface ExtensionUIContext {",
    "export interface ExtensionUIContext {\n    renamedSelect(title: string, options: string[]): Promise<string | undefined>;",
  ).replace(/^\s*select\(title: string, options: string\[\].*$/m, "");
  const declared = declaredMemberCounts(interfaceMembers(mutated, "ExtensionUIContext"));
  assert.equal(declared.has("select"), false);
  assert.equal(declared.has("renamedSelect"), true);
  const rows = manifestRows(manifest);
  assert.ok(rows.some((row) => row.member === "select"));
  assert.ok(!declared.has("select") || (rows.find((row) => row.member === "select") && !declared.has("select")));
});

test("negative: same-name signature change fails the baseline", () => {
  const mutated = typesSource.replace(
    "notify(message: string, type?: \"info\" | \"warning\" | \"error\"): void;",
    "notify(message: string, type?: \"info\" | \"warning\" | \"error\" | \"success\"): void;",
  );
  const current = currentSignatureSnapshot(mutated);
  const baseline = loadSignatureBaseline();
  assert.notDeepEqual(baseline.extensionUIContext.notify, current.extensionUIContext.notify);
});

test("negative: removed ExtensionAPI registration fails the baseline", () => {
  const mutated = typesSource.replace(
    /registerCommand\(name: string, options: Omit<RegisteredCommand, "name" \| "sourceInfo">\): void;/,
    "",
  );
  const current = currentSignatureSnapshot(mutated);
  const baseline = loadSignatureBaseline();
  assert.equal(current.extensionAPI.registerCommand, undefined);
  assert.ok(baseline.extensionAPI.registerCommand);
});

// Allow regenerating the baseline deliberately: `node scripts/extension-ui-parity.test.mjs --write`
if (process.argv.includes("--write")) {
  writeFileSync(signaturesPath, `${JSON.stringify(currentSignatureSnapshot(), null, 2)}\n`);
  console.log(`wrote ${signaturesPath}`);
}

import test from "node:test";
import assert from "node:assert/strict";
import { attributeExtensionCallSite } from "../dist/extension-call-attribution.js";

const a = {
  resolvedPath: "/home/u/.pi/agent/extensions/alpha/index.ts",
  baseDir: "/home/u/.pi/agent/extensions/alpha",
};
const b = { resolvedPath: "/work/.pi/extensions/beta.ts" };
const extensions = [a, b];

function stack(...frames: string[]): string {
  return ["Error", ...frames.map((frame) => `    at ${frame}`)].join("\n");
}

await test("an exact entry-file frame wins over anything else", () => {
  const observed = attributeExtensionCallSite(
    stack(
      "observe (/app/out/main/session-supervisor.js:10:5)",
      "Object.setHeader (/app/out/main/session-supervisor.js:20:9)",
      `fixture (file://${b.resolvedPath}:7:12)`,
      `arm (${a.resolvedPath}:3:3)`,
    ),
    extensions,
  );
  assert.equal(observed, b.resolvedPath);
});

await test("a frame inside exactly one extension directory attributes to that extension", () => {
  const observed = attributeExtensionCallSite(
    stack("render (/home/u/.pi/agent/extensions/alpha/lib/panel.ts:12:4)"),
    extensions,
  );
  assert.equal(observed, a.resolvedPath);
});

await test("frames outside every extension stay unattributed instead of guessed", () => {
  assert.equal(
    attributeExtensionCallSite(stack("run (/app/out/main/other.js:1:1)"), extensions),
    undefined,
  );
  assert.equal(attributeExtensionCallSite(undefined, extensions), undefined);
  assert.equal(
    attributeExtensionCallSite(stack("x (/work/.pi/extensions/beta.ts:1:1)"), []),
    undefined,
  );
});

await test("two extensions sharing a directory frame are ambiguous, not attributed", () => {
  const shared = [
    { resolvedPath: "/shared/one.ts", baseDir: "/shared" },
    { resolvedPath: "/shared/two.ts", baseDir: "/shared" },
  ];
  assert.equal(
    attributeExtensionCallSite(stack("helper (/shared/lib/util.ts:4:4)"), shared),
    undefined,
  );
  assert.equal(
    attributeExtensionCallSite(stack("two (/shared/two.ts:4:4)"), shared),
    "/shared/two.ts",
  );
});

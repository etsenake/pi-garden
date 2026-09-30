import { expect, test } from "@playwright/test";
import {
  MAX_ANSI_TEXT_LENGTH,
  ansiStyleClassNames,
  parseAnsiText,
  stripAnsiText,
} from "../../src/lib/ansi-text";

/**
 * Pi's theme emits exactly these SGR forms (see `theme.fg` / `theme.bg` and
 * chalk attributes); the parser must keep them and strip everything else.
 */

test("keeps chalk text attributes and their resets", () => {
  const segments = parseAnsiText(
    "\u001b[1mbold\u001b[22m \u001b[2mdim\u001b[22m \u001b[3mitalic\u001b[23m \u001b[4munder\u001b[24m \u001b[7minv\u001b[27m \u001b[9mstrike\u001b[29m plain",
  );
  expect(segments).toEqual([
    { text: "bold", style: { bold: true } },
    { text: " ", style: {} },
    { text: "dim", style: { dim: true } },
    { text: " ", style: {} },
    { text: "italic", style: { italic: true } },
    { text: " ", style: {} },
    { text: "under", style: { underline: true } },
    { text: " ", style: {} },
    { text: "inv", style: { inverse: true } },
    { text: " ", style: {} },
    { text: "strike", style: { strikethrough: true } },
    { text: " plain", style: {} },
  ]);
});

test("maps basic, bright, 256-color and truecolor SGR to the semantic palette", () => {
  expect(parseAnsiText("\u001b[31mred\u001b[39m")).toEqual([
    { text: "red", style: { foreground: { name: "red", bright: false } } },
  ]);
  expect(parseAnsiText("\u001b[92mgreen\u001b[0m")).toEqual([
    { text: "green", style: { foreground: { name: "green", bright: true } } },
  ]);
  expect(parseAnsiText("\u001b[38;5;196mred256\u001b[39m")[0]?.style.foreground?.name).toBe("red");
  expect(parseAnsiText("\u001b[38;2;30;120;220mblue\u001b[39m")[0]?.style.foreground).toEqual({
    name: "blue",
    bright: false,
  });
  expect(parseAnsiText("\u001b[48;5;2mbg\u001b[49m")[0]?.style.background).toEqual({
    name: "green",
    bright: false,
  });
  expect(parseAnsiText("\u001b[103mbg\u001b[49m")[0]?.style.background).toEqual({
    name: "yellow",
    bright: true,
  });
  // Grayscale ramp collapses onto black / white.
  expect(parseAnsiText("\u001b[38;5;250mgray")[0]?.style.foreground).toEqual({
    name: "white",
    bright: false,
  });
});

test("combined parameters and empty reset behave like a terminal", () => {
  expect(parseAnsiText("\u001b[1;31mboth\u001b[mplain")).toEqual([
    { text: "both", style: { bold: true, foreground: { name: "red", bright: false } } },
    { text: "plain", style: {} },
  ]);
  // Unknown SGR codes are ignored but don't break the run.
  expect(parseAnsiText("\u001b[5;31mblink")).toEqual([
    { text: "blink", style: { foreground: { name: "red", bright: false } } },
  ]);
});

test("strips cursor movement, OSC payloads, private modes and control bytes", () => {
  expect(stripAnsiText("a\u001b[2Jb\u001b[Hc\u001b[?25ld")).toBe("abcd");
  expect(stripAnsiText("\u001b]0;title\u0007text")).toBe("text");
  expect(stripAnsiText("\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\")).toBe("link");
  expect(stripAnsiText("a\u0000b\u0008c\u007fd\te")).toBe("abcd\te");
  expect(stripAnsiText("esc7\u001b7done")).toBe("esc7done");
  // Unterminated CSI drops only the dangling sequence.
  expect(stripAnsiText("keep\u001b[31")).toBe("keep");
});

test("bounds the amount of text parsed per call", () => {
  const long = "x".repeat(MAX_ANSI_TEXT_LENGTH + 500);
  expect(stripAnsiText(long)).toHaveLength(MAX_ANSI_TEXT_LENGTH);
});

test("produces stable class names for styles", () => {
  expect(
    ansiStyleClassNames({
      bold: true,
      dim: true,
      foreground: { name: "red", bright: true },
      background: { name: "blue", bright: false },
    }),
  ).toBe("ansi--bold ansi--dim ansi-fg-bright-red ansi-bg-blue");
});

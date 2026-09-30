/**
 * Bounded parser for the terminal text Pi extensions hand to `setWidget` and
 * `setStatus`. Pi's theme emits SGR sequences (chalk attributes plus 16-color,
 * 256-color and truecolor foreground/background) and nothing else, so this
 * keeps exactly that: text attributes and colors mapped onto the desktop
 * theme's semantic palette. Every other escape (cursor movement, OSC titles
 * and hyperlinks, private modes) is stripped, and C0 control bytes other than
 * tab are dropped. It is not a terminal emulator: no cursor, no line editing.
 */

export type AnsiColorName =
  "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white";

export interface AnsiColor {
  readonly name: AnsiColorName;
  readonly bright: boolean;
}

export interface AnsiTextStyle {
  readonly bold?: true;
  readonly dim?: true;
  readonly italic?: true;
  readonly underline?: true;
  readonly inverse?: true;
  readonly strikethrough?: true;
  readonly foreground?: AnsiColor;
  readonly background?: AnsiColor;
}

export interface AnsiTextSegment {
  readonly text: string;
  readonly style: AnsiTextStyle;
}

/** Upper bound on characters parsed per call so a runaway widget cannot stall the renderer. */
export const MAX_ANSI_TEXT_LENGTH = 8_000;

const ESC = "\u001b";
const BEL = "\u0007";
const BASIC_COLORS: readonly AnsiColorName[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];

/** Parse one line (or short multi-line block) into styled segments. */
export function parseAnsiText(input: string): readonly AnsiTextSegment[] {
  const source = input.length > MAX_ANSI_TEXT_LENGTH ? input.slice(0, MAX_ANSI_TEXT_LENGTH) : input;
  const segments: AnsiTextSegment[] = [];
  let style: AnsiTextStyle = {};
  let buffer = "";

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ text: buffer, style });
      buffer = "";
    }
  };

  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char !== ESC) {
      if (isDroppedControl(char)) {
        index += 1;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    const next = source[index + 1];
    if (next === "[") {
      const end = findCsiEnd(source, index + 2);
      if (end === -1) {
        break; // unterminated CSI at the end: drop the rest of the sequence
      }
      if (source[end] === "m") {
        const nextStyle = applySgr(style, source.slice(index + 2, end));
        if (nextStyle !== style) {
          flush();
          style = nextStyle;
        }
      }
      index = end + 1;
      continue;
    }
    if (next === "]") {
      index = skipOsc(source, index + 2);
      continue;
    }
    // Two-byte escapes (ESC 7, ESC =, charset selection, ...): drop both bytes.
    index += next === undefined ? 1 : 2;
  }

  flush();
  return segments;
}

/** Plain text with every escape sequence and control byte removed. */
export function stripAnsiText(input: string): string {
  return parseAnsiText(input)
    .map((segment) => segment.text)
    .join("");
}

export function hasAnsiStyle(style: AnsiTextStyle): boolean {
  return Object.keys(style).length > 0;
}

/** Stable CSS class list for a style, consumed by `ansi-text.css` rules. */
export function ansiStyleClassNames(style: AnsiTextStyle): string {
  const classes: string[] = [];
  if (style.bold) classes.push("ansi--bold");
  if (style.dim) classes.push("ansi--dim");
  if (style.italic) classes.push("ansi--italic");
  if (style.underline) classes.push("ansi--underline");
  if (style.inverse) classes.push("ansi--inverse");
  if (style.strikethrough) classes.push("ansi--strikethrough");
  if (style.foreground) {
    classes.push(`ansi-fg-${style.foreground.bright ? "bright-" : ""}${style.foreground.name}`);
  }
  if (style.background) {
    classes.push(`ansi-bg-${style.background.bright ? "bright-" : ""}${style.background.name}`);
  }
  return classes.join(" ");
}

function isDroppedControl(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code === 0x09 || code === 0x0a) {
    return false;
  }
  return code < 0x20 || code === 0x7f;
}

/** Index of the CSI final byte (0x40–0x7e) after `start`, or -1 if missing. */
function findCsiEnd(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
    // Parameter (0x30–0x3f) and intermediate (0x20–0x2f) bytes continue the sequence.
    if (code < 0x20 || code > 0x3f) {
      return index; // malformed: treat the offending byte as the terminator
    }
  }
  return -1;
}

/** Skip an OSC payload terminated by BEL or ST (ESC \). Returns the next index. */
function skipOsc(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === BEL) {
      return index + 1;
    }
    if (source[index] === ESC && source[index + 1] === "\\") {
      return index + 2;
    }
  }
  return source.length;
}

function applySgr(style: AnsiTextStyle, rawParams: string): AnsiTextStyle {
  if (rawParams.length === 0) {
    return {};
  }
  const params = rawParams.split(";").map((value) => (value === "" ? 0 : Number(value)));
  let next: AnsiTextStyle = style;
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index]!;
    if (!Number.isInteger(code)) {
      continue;
    }
    switch (code) {
      case 0:
        next = {};
        break;
      case 1:
        next = { ...next, bold: true };
        break;
      case 2:
        next = { ...next, dim: true };
        break;
      case 3:
        next = { ...next, italic: true };
        break;
      case 4:
        next = { ...next, underline: true };
        break;
      case 7:
        next = { ...next, inverse: true };
        break;
      case 9:
        next = { ...next, strikethrough: true };
        break;
      case 22:
        next = without(next, ["bold", "dim"]);
        break;
      case 23:
        next = without(next, ["italic"]);
        break;
      case 24:
        next = without(next, ["underline"]);
        break;
      case 27:
        next = without(next, ["inverse"]);
        break;
      case 29:
        next = without(next, ["strikethrough"]);
        break;
      case 39:
        next = without(next, ["foreground"]);
        break;
      case 49:
        next = without(next, ["background"]);
        break;
      case 38:
      case 48: {
        const { color, consumed } = extendedColor(params, index + 1);
        index += consumed;
        if (color) {
          next = { ...next, [code === 38 ? "foreground" : "background"]: color };
        }
        break;
      }
      default:
        if (code >= 30 && code <= 37) {
          next = { ...next, foreground: { name: BASIC_COLORS[code - 30]!, bright: false } };
        } else if (code >= 90 && code <= 97) {
          next = { ...next, foreground: { name: BASIC_COLORS[code - 90]!, bright: true } };
        } else if (code >= 40 && code <= 47) {
          next = { ...next, background: { name: BASIC_COLORS[code - 40]!, bright: false } };
        } else if (code >= 100 && code <= 107) {
          next = { ...next, background: { name: BASIC_COLORS[code - 100]!, bright: true } };
        }
        // Blink, conceal, fonts, and unknown codes are ignored on purpose.
        break;
    }
  }
  return next;
}

function without(style: AnsiTextStyle, keys: readonly (keyof AnsiTextStyle)[]): AnsiTextStyle {
  const next: Record<string, unknown> = { ...style };
  for (const key of keys) {
    delete next[key];
  }
  return next as AnsiTextStyle;
}

/** `38;5;n` / `38;2;r;g;b` → nearest of the 16 basic colors, plus params consumed. */
function extendedColor(
  params: readonly number[],
  start: number,
): { color: AnsiColor | undefined; consumed: number } {
  const mode = params[start];
  if (mode === 5) {
    const index = params[start + 1];
    return { color: index === undefined ? undefined : color256(index), consumed: 2 };
  }
  if (mode === 2) {
    const r = params[start + 1];
    const g = params[start + 2];
    const b = params[start + 3];
    return {
      color:
        r === undefined || g === undefined || b === undefined ? undefined : nearestBasic(r, g, b),
      consumed: 4,
    };
  }
  return { color: undefined, consumed: 0 };
}

function color256(index: number): AnsiColor | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    return undefined;
  }
  if (index < 8) {
    return { name: BASIC_COLORS[index]!, bright: false };
  }
  if (index < 16) {
    return { name: BASIC_COLORS[index - 8]!, bright: true };
  }
  if (index >= 232) {
    // Grayscale ramp: dark half reads as black, light half as white.
    return index < 244 ? { name: "black", bright: true } : { name: "white", bright: false };
  }
  const cube = index - 16;
  const levels = [0, 95, 135, 175, 215, 255] as const;
  const r = levels[Math.floor(cube / 36)]!;
  const g = levels[Math.floor((cube % 36) / 6)]!;
  const b = levels[cube % 6]!;
  return nearestBasic(r, g, b);
}

const BASIC_RGB: readonly (readonly [AnsiColor, readonly [number, number, number]])[] = [
  [{ name: "black", bright: false }, [0, 0, 0]],
  [{ name: "red", bright: false }, [205, 49, 49]],
  [{ name: "green", bright: false }, [13, 188, 121]],
  [{ name: "yellow", bright: false }, [229, 229, 16]],
  [{ name: "blue", bright: false }, [36, 114, 200]],
  [{ name: "magenta", bright: false }, [188, 63, 188]],
  [{ name: "cyan", bright: false }, [17, 168, 205]],
  [{ name: "white", bright: false }, [229, 229, 229]],
  [{ name: "black", bright: true }, [102, 102, 102]],
  [{ name: "red", bright: true }, [241, 76, 76]],
  [{ name: "green", bright: true }, [35, 209, 139]],
  [{ name: "yellow", bright: true }, [245, 245, 67]],
  [{ name: "blue", bright: true }, [59, 142, 234]],
  [{ name: "magenta", bright: true }, [214, 112, 214]],
  [{ name: "cyan", bright: true }, [41, 184, 219]],
  [{ name: "white", bright: true }, [255, 255, 255]],
];

function nearestBasic(r: number, g: number, b: number): AnsiColor {
  let best = BASIC_RGB[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of BASIC_RGB) {
    const [, [cr, cg, cb]] = candidate;
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best[0];
}

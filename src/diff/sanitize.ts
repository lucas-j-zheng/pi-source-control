/**
 * Repository content is untrusted input. A crafted file, filename, commit
 * subject or author name can carry terminal control sequences that drive the
 * reviewer's terminal (OSC 52 clipboard writes, OSC 0 title changes) or make a
 * diff line *display* as something other than what it contains (a bare CR
 * rewrites the row from column zero).
 *
 * These helpers are pure and hold no terminal state. They run at the **parse
 * boundary** so the in-memory model is already clean; renderers wrap that clean
 * text in the extension's own `Styler` escapes afterwards, and those must never
 * be fed back through here.
 */

const ESC = "\u001b";
const BEL = "\u0007";
const REPLACEMENT = "\ufffd";

/**
 * C0 controls and DEL, minus `\t` (kept for `expandTabs`) and `\n` (a content
 * string may legitimately span lines before it is split), plus the C1 block:
 * in a UTF-8 terminal U+009B is a live CSI introducer and U+009D a live OSC
 * introducer, so they are exactly as dangerous as their ESC-prefixed forms.
 */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const LINE_BREAK = /\n/g;

/**
 * Strips every escape-introduced sequence and neutralises the remaining
 * control characters. Use for diff line content and hunk headers.
 */
export function sanitizeContent(text: string): string {
  return stripEscapeSequences(text).replace(CONTROL_CHARACTER, REPLACEMENT);
}

/**
 * As {@link sanitizeContent}, but a label occupies a single row, so line
 * breaks are collapsed to a visible placeholder too. Use for paths, commit
 * subjects and author names.
 */
export function sanitizeLabel(text: string): string {
  return sanitizeContent(text).replace(LINE_BREAK, REPLACEMENT);
}

/**
 * A lossless identity for decoded path bytes. Two filenames that differ only
 * in invalid UTF-8 bytes decode to the same replacement-character string, so
 * the display string cannot be used as an id; the raw octets can.
 */
export function pathKey(octets: readonly number[]): string {
  return Buffer.from(Uint8Array.from(octets)).toString("hex");
}

function stripEscapeSequences(text: string): string {
  if (!text.includes(ESC)) return text;

  let result = "";
  let index = 0;

  while (index < text.length) {
    if (text[index] !== ESC) {
      result += text[index];
      index += 1;
      continue;
    }
    index = endOfEscapeSequence(text, index);
  }

  return result;
}

/** Returns the index just past the escape sequence starting at `start`. */
function endOfEscapeSequence(text: string, start: number): number {
  let index = start + 1;
  const introducer = text[index];

  if (introducer === undefined) return index;

  // CSI: ESC [ <params 0x30-0x3f> <intermediates 0x20-0x2f> <final 0x40-0x7e>
  if (introducer === "[") {
    index += 1;
    while (index < text.length && isInRange(text[index]!, 0x30, 0x3f)) index += 1;
    while (index < text.length && isInRange(text[index]!, 0x20, 0x2f)) index += 1;
    // A control character aborts the sequence rather than ending it, so it is
    // left for the C0 pass instead of being swallowed here.
    return index < text.length && isInRange(text[index]!, 0x40, 0x7e)
      ? index + 1
      : index;
  }

  // OSC / DCS / SOS / PM / APC: a string payload terminated by BEL or ST.
  if (
    introducer === "]" ||
    introducer === "P" ||
    introducer === "X" ||
    introducer === "^" ||
    introducer === "_"
  ) {
    index += 1;
    while (index < text.length) {
      const char = text[index]!;
      if (char === BEL) return index + 1;
      if (char === ESC) return text[index + 1] === "\\" ? index + 2 : index;
      index += 1;
    }
    // Unterminated: the terminal would swallow the rest of the row anyway.
    return index;
  }

  // Any other ESC form: optional intermediates then a final byte. A control
  // character is never a final byte, so a lone ESC before one drops by itself
  // and the control character is handled by the C0 pass.
  while (index < text.length && isInRange(text[index]!, 0x20, 0x2f)) index += 1;
  if (index < text.length && isInRange(text[index]!, 0x20, 0x7e)) index += 1;
  return index;
}

function isInRange(char: string, low: number, high: number): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code >= low && code <= high;
}

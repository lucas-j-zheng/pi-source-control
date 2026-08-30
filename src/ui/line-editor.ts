import {
  decodeKittyPrintable,
  matchesKey,
  visibleWidth,
} from "@earendil-works/pi-tui";

import { plainStyler, type Styler } from "./theme.ts";

export interface EditorBuffer {
  text: string;
  caret: number;
}

export interface ApplyKeyResult {
  buffer: EditorBuffer;
  done?: "submit" | "cancel";
}

const TAB_REPLACEMENT = "  ";
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

export function createBuffer(text = ""): EditorBuffer {
  return { text, caret: Array.from(text).length };
}

export function applyKey(buffer: EditorBuffer, data: string): ApplyKeyResult {
  const characters = Array.from(buffer.text);
  const caret = clampCaret(buffer.caret, characters.length);
  const unchanged: EditorBuffer = { text: buffer.text, caret };

  if (data.includes(PASTE_START)) return applyPaste(characters, caret, data);

  if (matchesKey(data, "alt+enter")) {
    return { buffer: insert(characters, caret, "\n") };
  }
  if (matchesKey(data, "enter")) return { buffer: unchanged, done: "submit" };
  if (matchesKey(data, "escape")) return { buffer: unchanged, done: "cancel" };

  if (matchesKey(data, "backspace")) {
    if (caret === 0) return { buffer: unchanged };
    const next = [...characters];
    next.splice(caret - 1, 1);
    return { buffer: { text: next.join(""), caret: caret - 1 } };
  }
  if (matchesKey(data, "delete")) {
    if (caret >= characters.length) return { buffer: unchanged };
    const next = [...characters];
    next.splice(caret, 1);
    return { buffer: { text: next.join(""), caret } };
  }
  if (matchesKey(data, "left")) {
    return { buffer: { text: buffer.text, caret: Math.max(0, caret - 1) } };
  }
  if (matchesKey(data, "right")) {
    return {
      buffer: {
        text: buffer.text,
        caret: Math.min(characters.length, caret + 1),
      },
    };
  }
  if (matchesKey(data, "home")) {
    return { buffer: { text: buffer.text, caret: 0 } };
  }
  if (matchesKey(data, "end")) {
    return { buffer: { text: buffer.text, caret: characters.length } };
  }

  const printable =
    decodeKittyPrintable(data) ??
    decodeModifyOtherKeys(data) ??
    plainPrintable(data);
  if (printable === undefined) return { buffer: unchanged };
  return { buffer: insert(characters, caret, printable) };
}

export function renderBuffer(
  buffer: EditorBuffer,
  width: number,
  styler: Styler = plainStyler,
): string[] {
  const safeWidth = Math.max(1, Math.trunc(width));
  const characters = Array.from(buffer.text);
  const caret = clampCaret(buffer.caret, characters.length);
  const rows: string[] = [];
  let row = "";
  let rowWidth = 0;

  const flush = (): void => {
    rows.push(row);
    row = "";
    rowWidth = 0;
  };
  const push = (text: string, highlighted: boolean): void => {
    const cell = visibleWidth(text) > safeWidth ? " " : text;
    const cellWidth = Math.max(1, visibleWidth(cell));
    if (rowWidth + cellWidth > safeWidth) flush();
    row += highlighted ? styler.bg("selectedBg", cell) : cell;
    rowWidth += cellWidth;
  };

  for (const [index, character] of characters.entries()) {
    if (character === "\n") {
      if (index === caret) push(" ", true);
      flush();
      continue;
    }
    push(character === "\t" ? TAB_REPLACEMENT : character, index === caret);
  }
  if (caret >= characters.length) push(" ", true);
  flush();

  return rows;
}

function applyPaste(
  characters: string[],
  caret: number,
  data: string,
): ApplyKeyResult {
  // The terminal re-wraps bracketed paste content before the component sees it,
  // so the payload arrives as literal text between the two markers.
  const rest = data.replace(PASTE_START, "");
  const end = rest.indexOf(PASTE_END);
  const content = end === -1 ? rest : rest.slice(0, end);
  const pasted = insert(characters, caret, pastedText(content));
  const remainder = end === -1 ? "" : rest.slice(end + PASTE_END.length);
  if (remainder === "") return { buffer: pasted };
  return applyKey(pasted, remainder);
}

function pastedText(content: string): string {
  // Some terminals re-encode control bytes inside a paste as CSI-u sequences;
  // decode them so newlines survive instead of leaking a printable tail.
  const decoded = content.replace(/\u001b\[(\d+);5u/g, (match, code) => {
    const codePoint = Number.parseInt(code, 10);
    if (codePoint >= 0x41 && codePoint <= 0x5a) {
      return String.fromCodePoint(codePoint - 0x40);
    }
    if (codePoint >= 0x61 && codePoint <= 0x7a) {
      return String.fromCodePoint(codePoint - 0x60);
    }
    return match;
  });
  const normalized = decoded
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, TAB_REPLACEMENT);
  return Array.from(normalized)
    .filter(
      (character) =>
        character === "\n" || plainPrintable(character) !== undefined,
    )
    .join("");
}

function insert(
  characters: string[],
  caret: number,
  text: string,
): EditorBuffer {
  const inserted = Array.from(text);
  const next = [...characters];
  next.splice(caret, 0, ...inserted);
  return { text: next.join(""), caret: caret + inserted.length };
}

function clampCaret(caret: number, length: number): number {
  if (!Number.isFinite(caret)) return length;
  return Math.max(0, Math.min(length, Math.trunc(caret)));
}

function decodeModifyOtherKeys(data: string): string | undefined {
  const match = /^\u001b\[27;(1|2);(\d+)~$/u.exec(data);
  if (match === null) return undefined;

  const codePoint = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(codePoint) || codePoint < 0x20 || codePoint === 0x7f) {
    return undefined;
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return undefined;
  }
}

function plainPrintable(data: string): string | undefined {
  if (data === "") return undefined;
  for (const character of data) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return undefined;
  }
  return data;
}

import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  applyKey,
  createBuffer,
  renderBuffer,
  type EditorBuffer,
} from "../../src/ui/line-editor.ts";

const ESC = "\u001b";
const BACKSPACE = "\u007f";
const DELETE = `${ESC}[3~`;
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;

function type(buffer: EditorBuffer, keys: string[]): EditorBuffer {
  return keys.reduce((current, key) => applyKey(current, key).buffer, buffer);
}

describe("line editor", () => {
  it("typing inserts at the caret and backspace deletes before it", () => {
    const typed = type(createBuffer(), ["a", "b", "c"]);
    expect(typed).toEqual({ text: "abc", caret: 3 });

    const deleted = applyKey(typed, BACKSPACE).buffer;
    expect(deleted).toEqual({ text: "ab", caret: 2 });

    const inserted = type(deleted, [`${ESC}[D`, "X"]);
    expect(inserted).toEqual({ text: "aXb", caret: 2 });
  });

  it("inserts multi-byte characters as single caret steps", () => {
    const typed = type(createBuffer(), ["é", "🙂"]);
    expect(typed).toEqual({ text: "é🙂", caret: 2 });
    expect(applyKey(typed, BACKSPACE).buffer).toEqual({ text: "é", caret: 1 });
  });

  it("arrow keys, home and end move the caret without changing text", () => {
    const buffer = createBuffer("hello");

    expect(applyKey(buffer, `${ESC}[D`).buffer).toEqual({
      text: "hello",
      caret: 4,
    });
    expect(applyKey(buffer, `${ESC}[C`).buffer).toEqual({
      text: "hello",
      caret: 5,
    });
    expect(applyKey(buffer, `${ESC}[H`).buffer).toEqual({
      text: "hello",
      caret: 0,
    });
    expect(applyKey({ text: "hello", caret: 2 }, DELETE).buffer).toEqual({
      text: "helo",
      caret: 2,
    });
    expect(applyKey({ text: "hello", caret: 0 }, `${ESC}[F`).buffer).toEqual({
      text: "hello",
      caret: 5,
    });
  });

  it("Enter submits and Esc cancels", () => {
    const buffer = createBuffer("done");

    expect(applyKey(buffer, "\r")).toEqual({ buffer, done: "submit" });
    expect(applyKey(buffer, ESC)).toEqual({ buffer, done: "cancel" });
  });

  it("Alt+Enter inserts a newline instead of submitting", () => {
    const result = applyKey(createBuffer("one"), `${ESC}\r`);

    expect(result.done).toBeUndefined();
    expect(result.buffer).toEqual({ text: "one\n", caret: 4 });
  });

  it("unknown escape sequences are ignored rather than inserted", () => {
    const buffer = createBuffer("keep");

    for (const data of [`${ESC}[200~`, `${ESC}[5~`, `${ESC}[1;2Q`, "\u0007"]) {
      expect(applyKey(buffer, data)).toEqual({ buffer });
    }
  });

  it("bracketed paste inserts multi-line text at the caret", () => {
    const result = applyKey(
      { text: "ac", caret: 1 },
      `${PASTE_START}one\r\ntwo\rthree${PASTE_END}`,
    );

    expect(result.done).toBeUndefined();
    expect(result.buffer).toEqual({ text: "aone\ntwo\nthreec", caret: 14 });
  });

  it("bracketed paste never submits or cancels", () => {
    const pastes: [string, string][] = [
      ["\r", "keep\n"],
      ["\n", "keep\n"],
      ["one\r\n", "keepone\n"],
      [ESC, "keep"],
      ["", "keep"],
    ];

    for (const [content, text] of pastes) {
      const result = applyKey(
        createBuffer("keep"),
        `${PASTE_START}${content}${PASTE_END}`,
      );
      expect(result.done).toBeUndefined();
      expect(result.buffer).toEqual({ text, caret: Array.from(text).length });
    }
  });

  it("bracketed paste drops control characters and expands tabs", () => {
    const result = applyKey(
      createBuffer(),
      `${PASTE_START}ab\tc${BACKSPACE}${PASTE_END}`,
    );

    expect(result.buffer).toEqual({ text: "ab  c", caret: 5 });
  });

  it("input after the paste terminator is handled as a normal key", () => {
    const pasted = applyKey(createBuffer(), `${PASTE_START}ab${PASTE_END}c`);
    expect(pasted.buffer).toEqual({ text: "abc", caret: 3 });

    const submitted = applyKey(createBuffer(), `${PASTE_START}ab${PASTE_END}\r`);
    expect(submitted.buffer).toEqual({ text: "ab", caret: 2 });
    expect(submitted.done).toBe("submit");
  });

  it("inserts printables reported through the modifyOtherKeys fallback", () => {
    expect(applyKey(createBuffer(), `${ESC}[27;2;65~`).buffer).toEqual({
      text: "A",
      caret: 1,
    });
    expect(applyKey(createBuffer(), `${ESC}[27;1;97~`).buffer).toEqual({
      text: "a",
      caret: 1,
    });
    expect(applyKey(createBuffer("x"), `${ESC}[27;5;97~`).buffer).toEqual({
      text: "x",
      caret: 1,
    });
  });

  it("modifyOtherKeys printables are decoded without a deep package import", () => {
    expect(applyKey(createBuffer(), `${ESC}[27;2;65~`).buffer).toEqual({
      text: "A",
      caret: 1,
    });
    expect(applyKey(createBuffer(), `${ESC}[27;1;97~`).buffer).toEqual({
      text: "a",
      caret: 1,
    });
    const buffer = createBuffer("x");
    expect(applyKey(buffer, `${ESC}[27;5;97~`)).toEqual({ buffer });
  });

  it("malformed modifyOtherKeys sequences are ignored", () => {
    const buffer = createBuffer("keep");

    for (const data of [
      `${ESC}[27;2~`,
      `${ESC}[27;2;65`,
      `${ESC}[27;2;9~`,
    ]) {
      expect(applyKey(buffer, data)).toEqual({ buffer });
    }
  });

  it("renderBuffer wraps to the given width and never exceeds it", () => {
    const buffer = createBuffer("the quick brown fox jumps over the lazy dog");

    for (const width of [1, 4, 7, 12, 40]) {
      const rows = renderBuffer(buffer, width);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  it("renderBuffer breaks explicit newlines onto their own rows", () => {
    expect(renderBuffer({ text: "one\ntwo", caret: 0 }, 20)).toHaveLength(2);
  });
});

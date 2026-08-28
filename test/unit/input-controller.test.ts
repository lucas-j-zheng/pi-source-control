import { describe, expect, it } from "vitest";

import { createInitialState, type ReviewEnv } from "../../src/model/review-state.ts";
import { actionForKey } from "../../src/ui/input-controller.ts";
import { computeLayout } from "../../src/ui/layout.ts";

const layout = computeLayout(220, 24);
const env: ReviewEnv = {
  layout,
  sources: [{ kind: "working", id: "working", label: "Working Tree" }],
  filesForSource: () => [],
  fileById: () => undefined,
  diffRowCount: () => 0,
  hunkRows: () => [],
};
const state = createInitialState("working", env);

describe("input controller", () => {
  it("maps every documented key to its action", () => {
    const cases: Array<[string, object]> = [
      ["\u001b[A", { type: "move", delta: -1 }],
      ["k", { type: "move", delta: -1 }],
      ["\u001b[B", { type: "move", delta: 1 }],
      ["j", { type: "move", delta: 1 }],
      ["\t", { type: "focus-next" }],
      ["\u001b[Z", { type: "focus-prev" }],
      ["q", { type: "close" }],
      ["n", { type: "next-hunk" }],
      ["p", { type: "prev-hunk" }],
      ["\u001b[6~", { type: "page", delta: 1 }],
      ["\u001b[5~", { type: "page", delta: -1 }],
      ["\u001b[H", { type: "home" }],
      ["\u001b[F", { type: "end" }],
      ["\u001b[D", { type: "scroll-horizontal", delta: -1 }],
      ["\u001b[C", { type: "scroll-horizontal", delta: 1 }],
      ["v", { type: "toggle-view" }],
      [" ", { type: "toggle-reviewed" }],
      ["g", { type: "refresh" }],
      ["?", { type: "toggle-help" }],
    ];

    for (const [key, action] of cases) {
      expect(actionForKey(key, state, layout), JSON.stringify(key)).toEqual(action);
    }
  });

  it("unknown keys map to undefined", () => {
    expect(actionForKey("x", state, layout)).toBeUndefined();
  });

  it("shift+j and shift+k map to five-line moves", () => {
    expect(actionForKey("J", state, layout)).toEqual({
      type: "move",
      delta: 5,
    });
    expect(actionForKey("K", state, layout)).toEqual({
      type: "move",
      delta: -5,
    });
  });

  it("ctrl+d and ctrl+u map to half-page actions", () => {
    expect(actionForKey("\u0004", state, layout)).toEqual({
      type: "half-page",
      delta: 1,
    });
    expect(actionForKey("\u0015", state, layout)).toEqual({
      type: "half-page",
      delta: -1,
    });
  });

  it("lowercase j and k still move one line", () => {
    expect(actionForKey("j", state, layout)).toEqual({
      type: "move",
      delta: 1,
    });
    expect(actionForKey("k", state, layout)).toEqual({
      type: "move",
      delta: -1,
    });
  });

  it("backspace and h map to back", () => {
    expect(actionForKey("\u007f", state, layout)).toEqual({ type: "back" });
    expect(actionForKey("h", state, layout)).toEqual({ type: "back" });
    expect(actionForKey("H", state, layout)).toBeUndefined();
  });

  it("l maps to enter", () => {
    expect(actionForKey("l", state, layout)).toEqual({ type: "enter" });
    expect(actionForKey("L", state, layout)).toBeUndefined();
  });

  it("escape and enter are unchanged", () => {
    expect(actionForKey("\u001b", state, layout)).toEqual({ type: "back" });
    expect(actionForKey("\r", state, layout)).toEqual({ type: "enter" });
  });
});

import { describe, expect, it } from "vitest";

import type { UiAction } from "../../src/model/review-state.ts";
import {
  computeHitTargets,
  hitTest,
  type HitInput,
} from "../../src/ui/hit-target-registry.ts";
import { computeLayout } from "../../src/ui/layout.ts";

function input(width: number): HitInput {
  return {
    layout: computeLayout(width, 10),
    sourceRowIds: ["working", undefined, "staged"],
    fileRowIds: ["working:a.ts", "working:b.ts"],
    sourceListTop: 2,
    fileListTop: 6,
    diffTop: 2,
  };
}

describe("hit target registry", () => {
  it("source, file and diff rows map to distinct actions", () => {
    const targets = computeHitTargets(input(220));

    expect(hitTest(targets, 2, 0)).toEqual({
      type: "select-source",
      sourceId: "working",
    });
    expect(hitTest(targets, 6, 0)).toEqual({
      type: "select-file",
      fileId: "working:a.ts",
    });
    expect(hitTest(targets, 2, 100)).toEqual({ type: "focus-diff" });
    expect(hitTest(targets, 3, 0)).toBeUndefined();
  });

  it("keyboard and pointer activation dispatch the same action object", () => {
    const pointerAction = hitTest(computeHitTargets(input(220)), 7, 1);
    const reducerAction: UiAction = {
      type: "select-file",
      fileId: "working:b.ts",
    };

    expect(pointerAction).toEqual(reducerAction);
  });

  it("hitboxes follow layout after resize", () => {
    const wideInput = input(220);
    const mediumInput = input(90);
    const wide = computeHitTargets(wideInput);
    const medium = computeHitTargets(mediumInput);
    const wideSource = wide.find((target) => target.action.type === "select-source");
    const mediumSource = medium.find(
      (target) => target.action.type === "select-source",
    );
    const wideDiff = wide.find((target) => target.action.type === "focus-diff");

    expect(wideSource?.columnEnd).toBe(wideInput.layout.leftWidth);
    expect(mediumSource?.columnEnd).toBe(mediumInput.layout.leftWidth);
    expect(wideSource?.columnEnd).not.toBe(mediumSource?.columnEnd);
    expect(wideDiff).toMatchObject({
      row: 2,
      columnStart: wideInput.layout.leftWidth + 1,
      columnEnd: 220,
    });
  });

  it("narrow mode exposes only the focused pane", () => {
    const narrow = input(60);
    const sourceTargets = computeHitTargets({ ...narrow, fileRowIds: [] });
    expect(sourceTargets.every((target) => target.action.type === "select-source")).toBe(
      true,
    );
    expect(sourceTargets[0]).toMatchObject({ columnStart: 0, columnEnd: 60 });

    const fileTargets = computeHitTargets({ ...narrow, sourceRowIds: [] });
    expect(fileTargets.every((target) => target.action.type === "select-file")).toBe(
      true,
    );

    const diffTargets = computeHitTargets({
      ...narrow,
      sourceRowIds: [],
      fileRowIds: [],
    });
    expect(diffTargets.every((target) => target.action.type === "focus-diff")).toBe(
      true,
    );
    expect(diffTargets).toHaveLength(input(60).layout.bodyHeight);
  });
});

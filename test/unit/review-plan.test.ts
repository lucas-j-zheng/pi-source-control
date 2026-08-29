import { describe, expect, it } from "vitest";

import type { ReviewComment } from "../../src/model/review-comment.ts";
import {
  buildReviewPlan,
  renderPlan,
} from "../../src/model/review-plan.ts";

function comment(
  id: string,
  filePath: string,
  overrides: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id,
    fileId: filePath,
    filePath,
    anchor: { hunkIndex: 0, lineIndex: 0 },
    newLineNumber: 1,
    lineKind: "addition",
    lineText: "value",
    contextText: "+value",
    scopeLabel: "working tree",
    body: "Review this.",
    createdAt: 1,
    ...overrides,
  };
}

describe("review plan", () => {
  it("comments on one file form a single unit", () => {
    const plan = buildReviewPlan([
      comment("first", "src/example.ts"),
      comment("second", "src/example.ts"),
    ]);

    expect(plan.units).toEqual([
      {
        index: 1,
        filePaths: ["src/example.ts"],
        commentIds: ["first", "second"],
      },
    ]);
  });

  it("comments on different files form one unit per file ordered by path", () => {
    const plan = buildReviewPlan([
      comment("z-comment", "z.ts"),
      comment("a-comment", "a.ts"),
    ]);

    expect(plan.units).toEqual([
      { index: 1, filePaths: ["a.ts"], commentIds: ["a-comment"] },
      { index: 2, filePaths: ["z.ts"], commentIds: ["z-comment"] },
    ]);
  });

  it("every comment appears in exactly one unit", () => {
    const comments = [
      comment("one", "a.ts"),
      comment("two", "b.ts"),
      comment("three", "a.ts"),
    ];
    const plan = buildReviewPlan(comments);
    const plannedIds = plan.units.flatMap((unit) => unit.commentIds);

    expect(plannedIds).toHaveLength(comments.length);
    for (const queued of comments) {
      expect(plannedIds.filter((id) => id === queued.id)).toHaveLength(1);
    }
  });

  it("parallelSafe is false for a single unit and true for two or more", () => {
    expect(buildReviewPlan([comment("one", "a.ts")]).parallelSafe).toBe(false);
    expect(
      buildReviewPlan([
        comment("one", "a.ts"),
        comment("two", "b.ts"),
      ]).parallelSafe,
    ).toBe(true);
  });

  it("renderPlan is empty for a single unit", () => {
    const plan = buildReviewPlan([
      comment("one", "a.ts"),
      comment("two", "a.ts"),
    ]);

    expect(renderPlan(plan)).toBe("");
  });

  it("renderPlan lists units with the comment numbers from the message body", () => {
    const plan = buildReviewPlan([
      comment("first", "a.ts"),
      comment("second", "b.ts"),
      comment("third", "a.ts"),
    ]);

    expect(renderPlan(plan)).toBe(
      "\n\nSuggested plan — 2 independent units, one per file:\n\n" +
        "  Unit 1: a.ts  (comments 1, 3)\n" +
        "  Unit 2: b.ts  (comment 2)\n\n" +
        "Units touch disjoint files and may be worked in parallel, one worker per unit.\n" +
        "Do not split a unit across workers: comments in a unit edit the same file.\n" +
        "Merge units into one worker if the changes turn out to be coupled — for example a\n" +
        "rename whose call sites live in another unit's file.",
    );
  });
});

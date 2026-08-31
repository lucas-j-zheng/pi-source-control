import { describe, expect, it } from "vitest";

import type { ChangedFile, DiffReview } from "../../src/model/diff.ts";
import {
  buildComment,
  buildReviewMessage,
  describeScope,
  type ReviewComment,
} from "../../src/model/review-comment.ts";

function file(): ChangedFile {
  return {
    id: "working:src/example.ts",
    group: "working",
    status: "modified",
    newPath: "src/example.ts",
    displayName: "example.ts",
    displayDirectory: "src",
    additions: 2,
    deletions: 1,
    isBinary: false,
    isOversized: false,
    rawPatch: "patch",
    patchFingerprint: "fingerprint",
    hunks: [
      {
        index: 0,
        header: "@@ -10,6 +20,7 @@",
        oldStart: 10,
        oldCount: 6,
        newStart: 20,
        newCount: 7,
        lines: [
          { kind: "context", content: "before three", oldLineNumber: 10, newLineNumber: 20 },
          { kind: "deletion", content: "old value", oldLineNumber: 11 },
          { kind: "addition", content: "  new value  ", newLineNumber: 21 },
          { kind: "context", content: "middle", oldLineNumber: 12, newLineNumber: 22 },
          { kind: "context", content: "after one", oldLineNumber: 13, newLineNumber: 23 },
          { kind: "addition", content: "after two", newLineNumber: 24 },
          { kind: "context", content: "after three", oldLineNumber: 14, newLineNumber: 25 },
        ],
      },
      {
        index: 1,
        header: "@@ -30 +40 @@",
        oldStart: 30,
        oldCount: 1,
        newStart: 40,
        newCount: 1,
        lines: [
          { kind: "context", content: "other hunk", oldLineNumber: 30, newLineNumber: 40 },
        ],
      },
    ],
  };
}

function review(
  scope: DiffReview["scope"],
  groups: DiffReview["groups"],
  metadata?: DiffReview["metadata"],
): DiffReview {
  return {
    repositoryRoot: "/repo",
    scope,
    groups,
    metadata,
    generatedAt: 0,
  };
}

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "working:src/example.ts:0:2",
    fileId: "working:src/example.ts",
    filePath: "src/example.ts",
    anchor: { hunkIndex: 0, lineIndex: 2 },
    newLineNumber: 21,
    lineKind: "addition",
    lineText: "new value",
    contextText: "-old value\n+new value\n unchanged",
    scopeLabel: "working tree",
    body: "Please use the validated value.",
    createdAt: 1,
    ...overrides,
  };
}

describe("review comments", () => {
  it("buildComment captures line numbers, verbatim line text and surrounding patch context", () => {
    const result = buildComment({
      file: file(),
      anchor: { hunkIndex: 0, lineIndex: 2 },
      body: "Please validate this.",
      scopeLabel: "working tree",
      now: 123,
    });

    expect(result).toMatchObject({
      id: "working:src/example.ts:0:2",
      filePath: "src/example.ts",
      oldLineNumber: undefined,
      newLineNumber: 21,
      lineKind: "addition",
      lineText: "  new value  ",
      body: "Please validate this.",
      createdAt: 123,
    });
    expect(result.contextText).toBe(
      " before three\n-old value\n+  new value  \n middle\n after one\n+after two",
    );
  });

  it("context stops at hunk boundaries", () => {
    const result = buildComment({
      file: file(),
      anchor: { hunkIndex: 0, lineIndex: 6 },
      body: "Comment",
      scopeLabel: "working tree",
      now: 0,
    });

    expect(result.contextText).toBe(
      " middle\n after one\n+after two\n after three",
    );
    expect(result.contextText).not.toContain("other hunk");
  });

  it("describeScope labels working tree, staged, commit and range reviews", () => {
    const changed = file();
    expect(describeScope(review(
      { kind: "workspace" },
      [{ id: "working", title: "Working Tree", files: [changed] }],
    ))).toBe("working tree");
    expect(describeScope(review(
      { kind: "workspace" },
      [{ id: "staged", title: "Staged Changes", files: [changed] }],
    ))).toBe("staged changes");
    expect(describeScope(review(
      {
        kind: "commit",
        requestedRevision: "HEAD",
        commitOid: "abcdef0123456789",
        parentCount: 1,
      },
      [{ id: "commit", title: "Files", files: [changed] }],
      {
        oid: "abcdef0123456789",
        shortOid: "abcdef0",
        subject: "Tighten validation",
        authorName: "Ada",
        authoredAt: "2026-08-28",
        parentOids: ["parent"],
      },
    ))).toBe("commit abcdef0 (Tighten validation)");
    expect(describeScope(review(
      {
        kind: "range",
        requestedExpression: "main...feature",
        mode: "three-dot",
        leftOid: "left",
        rightOid: "right",
        effectiveBaseOid: "base",
      },
      [{ id: "range", title: "Files", files: [changed] }],
    ))).toBe("range main...feature");
  });

  it("buildReviewMessage numbers, orders and formats entries", () => {
    const result = buildReviewMessage([
      comment({
        id: "z:0:0",
        fileId: "z",
        filePath: "z.ts",
        oldLineNumber: 9,
        newLineNumber: undefined,
        lineKind: "deletion",
        lineText: "gone",
        contextText: "-gone",
        body: "Keep this behavior.\nIt is still required.",
      }),
      comment({
        id: "a:0:0",
        fileId: "a",
        filePath: "a.ts",
        newLineNumber: 3,
        lineText: "after",
        contextText: " before\n+after",
        body: "Handle the error.",
      }),
    ]);

    expect(result).toBe(
      "Review of working tree — 2 comments from /diff.\n\n" +
        "1. a.ts:3 (added)\n" +
        "     +after\n\n" +
        "   Handle the error.\n\n" +
        "2. z.ts:-9 (removed)\n" +
        "     -gone\n\n" +
        "   Keep this behavior.\n" +
        "   It is still required.\n\n" +
        "Suggested plan — 2 independent units, one per file:\n\n" +
        "  Unit 1: a.ts  (comment 1)\n" +
        "  Unit 2: z.ts  (comment 2)\n\n" +
        "Units touch disjoint files and may be worked in parallel, one worker per unit.\n" +
        "Do not split a unit across workers: comments in a unit edit the same file.\n" +
        "Merge units into one worker if the changes turn out to be coupled — for example a\n" +
        "rename whose call sites live in another unit's file.",
    );
  });

  it("buildReviewMessage labels each entry when comments span multiple scopes", () => {
    const result = buildReviewMessage([
      comment({ scopeLabel: "staged changes" }),
      comment({
        id: "commit:other.ts:0:0",
        fileId: "commit:other.ts",
        filePath: "other.ts",
        newLineNumber: 8,
        scopeLabel: "commit abcdef0 (Fix it)",
      }),
    ]);

    expect(result).toContain("Review of multiple sources — 2 comments from /diff.");
    expect(result).toContain("[staged changes]");
    expect(result).toContain("[commit abcdef0 (Fix it)]");
  });

  it("buildReviewMessage appends the plan when comments span multiple files", () => {
    const result = buildReviewMessage([
      comment({ id: "z", fileId: "z", filePath: "z.ts" }),
      comment({ id: "a", fileId: "a", filePath: "a.ts" }),
    ]);

    expect(result).toContain(
      "\n\nSuggested plan — 2 independent units, one per file:\n\n" +
        "  Unit 1: a.ts  (comment 1)\n" +
        "  Unit 2: z.ts  (comment 2)",
    );
  });

  it("buildReviewMessage omits the plan for a single-file review", () => {
    const result = buildReviewMessage([
      comment({ id: "later", newLineNumber: 30 }),
      comment({ id: "earlier", newLineNumber: 10 }),
    ]);

    expect(result).not.toContain("Suggested plan");
    expect(result).not.toContain("Unit 1:");
  });
});

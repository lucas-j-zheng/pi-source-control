import { describe, expect, it } from "vitest";

import { alignFile, alignHunk } from "../../src/diff/side-by-side-aligner.ts";
import type { DiffHunk, DiffLine } from "../../src/model/diff.ts";

function hunk(lines: DiffLine[], index = 0): DiffHunk {
  return {
    index,
    header: `@@ -1,${lines.length} +1,${lines.length} @@`,
    oldStart: 1,
    oldCount: lines.length,
    newStart: 1,
    newCount: lines.length,
    lines,
  };
}

describe("alignHunk", () => {
  it("context only", () => {
    const rows = alignHunk(
      hunk([
        {
          kind: "context",
          content: "first",
          oldLineNumber: 1,
          newLineNumber: 3,
        },
        {
          kind: "context",
          content: "second",
          oldLineNumber: 2,
          newLineNumber: 4,
        },
      ]),
    );

    expect(rows).toEqual([
      {
        left: { kind: "metadata", content: "@@ -1,2 +1,2 @@" },
        right: { kind: "metadata", content: "@@ -1,2 +1,2 @@" },
        hunkIndex: 0,
      },
      {
        left: { kind: "context", content: "first", lineNumber: 1 },
        right: { kind: "context", content: "first", lineNumber: 3 },
        hunkIndex: 0,
      },
      {
        left: { kind: "context", content: "second", lineNumber: 2 },
        right: { kind: "context", content: "second", lineNumber: 4 },
        hunkIndex: 0,
      },
    ]);
  });

  it("one deletion replaced by one addition", () => {
    const rows = alignHunk(
      hunk([
        { kind: "deletion", content: "old", oldLineNumber: 1 },
        { kind: "addition", content: "new", newLineNumber: 1 },
      ]),
    );

    expect(rows[1]).toEqual({
      left: { kind: "deletion", content: "old", lineNumber: 1 },
      right: { kind: "addition", content: "new", lineNumber: 1 },
      hunkIndex: 0,
    });
  });

  it("two deletions replaced by three additions", () => {
    const rows = alignHunk(
      hunk([
        { kind: "deletion", content: "old 1", oldLineNumber: 4 },
        { kind: "deletion", content: "old 2", oldLineNumber: 5 },
        { kind: "addition", content: "new 1", newLineNumber: 8 },
        { kind: "addition", content: "new 2", newLineNumber: 9 },
        { kind: "addition", content: "new 3", newLineNumber: 10 },
      ]),
    );

    expect(rows.slice(1)).toEqual([
      {
        left: { kind: "deletion", content: "old 1", lineNumber: 4 },
        right: { kind: "addition", content: "new 1", lineNumber: 8 },
        hunkIndex: 0,
      },
      {
        left: { kind: "deletion", content: "old 2", lineNumber: 5 },
        right: { kind: "addition", content: "new 2", lineNumber: 9 },
        hunkIndex: 0,
      },
      {
        left: { kind: "empty", content: "" },
        right: { kind: "addition", content: "new 3", lineNumber: 10 },
        hunkIndex: 0,
      },
    ]);
  });

  it("three deletions replaced by one addition", () => {
    const rows = alignHunk(
      hunk([
        { kind: "deletion", content: "old 1", oldLineNumber: 2 },
        { kind: "deletion", content: "old 2", oldLineNumber: 3 },
        { kind: "deletion", content: "old 3", oldLineNumber: 4 },
        { kind: "addition", content: "new", newLineNumber: 2 },
      ]),
    );

    expect(rows.slice(1)).toEqual([
      {
        left: { kind: "deletion", content: "old 1", lineNumber: 2 },
        right: { kind: "addition", content: "new", lineNumber: 2 },
        hunkIndex: 0,
      },
      {
        left: { kind: "deletion", content: "old 2", lineNumber: 3 },
        right: { kind: "empty", content: "" },
        hunkIndex: 0,
      },
      {
        left: { kind: "deletion", content: "old 3", lineNumber: 4 },
        right: { kind: "empty", content: "" },
        hunkIndex: 0,
      },
    ]);
  });

  it("addition-only block", () => {
    const rows = alignHunk(
      hunk([
        { kind: "addition", content: "new 1", newLineNumber: 6 },
        { kind: "addition", content: "new 2", newLineNumber: 7 },
      ]),
    );

    expect(rows.slice(1).map((row) => row.left)).toEqual([
      { kind: "empty", content: "" },
      { kind: "empty", content: "" },
    ]);
  });

  it("deletion-only block", () => {
    const rows = alignHunk(
      hunk([
        { kind: "deletion", content: "old 1", oldLineNumber: 6 },
        { kind: "deletion", content: "old 2", oldLineNumber: 7 },
      ]),
    );

    expect(rows.slice(1).map((row) => row.right)).toEqual([
      { kind: "empty", content: "" },
      { kind: "empty", content: "" },
    ]);
  });

  it("adjacent hunks", () => {
    const rows = alignFile([
      hunk([{ kind: "context", content: "first" }], 0),
      hunk([{ kind: "context", content: "second" }], 1),
    ]);

    expect(
      rows
        .filter((row) => row.left?.kind === "metadata")
        .map((row) => row.hunkIndex),
    ).toEqual([0, 1]);
    expect(rows.map((row) => row.hunkIndex)).toEqual([0, 0, 1, 1]);
  });

  it("deletions following additions start a new block", () => {
    const rows = alignHunk(
      hunk([
        { kind: "addition", content: "new", newLineNumber: 1 },
        { kind: "deletion", content: "old", oldLineNumber: 1 },
      ]),
    );

    expect(rows.slice(1)).toEqual([
      {
        left: { kind: "empty", content: "" },
        right: { kind: "addition", content: "new", lineNumber: 1 },
        hunkIndex: 0,
      },
      {
        left: { kind: "deletion", content: "old", lineNumber: 1 },
        right: { kind: "empty", content: "" },
        hunkIndex: 0,
      },
    ]);
  });
});

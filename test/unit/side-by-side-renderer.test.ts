import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import type { ChangedFile, DiffHunk, DiffLine } from "../../src/model/diff.ts";
import { buildComment } from "../../src/model/review-comment.ts";
import type { LineAnchor } from "../../src/model/review-state.ts";
import {
  SBS_WIDTH_NOTICE,
  type SbsRow,
  buildSideBySideRows,
  renderSideBySide,
  sbsHunkStartRows,
} from "../../src/ui/side-by-side-renderer.ts";
import { plainStyler } from "../../src/ui/theme.ts";
import { placeholderFor } from "../../src/ui/unified-renderer.ts";

function changedFile(hunks: DiffHunk[]): ChangedFile {
  return {
    id: "working:example.ts",
    group: "working",
    status: "modified",
    newPath: "example.ts",
    displayName: "example.ts",
    displayDirectory: "",
    additions: 0,
    deletions: 0,
    isBinary: false,
    isOversized: false,
    rawPatch: "",
    patchFingerprint: "fixture",
    hunks,
  };
}

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

function replacementFile(): ChangedFile {
  return changedFile([
    hunk([
      { kind: "deletion", content: "old one", oldLineNumber: 4 },
      { kind: "deletion", content: "old two", oldLineNumber: 5 },
      { kind: "addition", content: "new one", newLineNumber: 8 },
      { kind: "addition", content: "new two", newLineNumber: 9 },
      { kind: "addition", content: "new three", newLineNumber: 10 },
    ]),
  ]);
}

function deletionFile(): ChangedFile {
  return changedFile([
    hunk([{ kind: "deletion", content: "old one", oldLineNumber: 4 }]),
  ]);
}

function columnWidths(width: number): [number, number] {
  const left = Math.floor((width - 1) / 2);
  return [left, width - left - 1];
}

function composerRows(
  file: ChangedFile,
  anchor: LineAnchor,
  width: number,
  body = "needs a test",
): SbsRow[] {
  return buildSideBySideRows(file, plainStyler, width, 0, anchor, true, [], {
    anchor,
    buffer: { text: body, caret: body.length },
  });
}

function commentColumn(
  rows: SbsRow[],
  body: string,
  width: number,
): "ORIGINAL" | "MODIFIED" | undefined {
  const [leftWidth] = columnWidths(width);
  const row = rows.find((candidate) => candidate.text.includes(body));
  if (row === undefined) return undefined;
  if (row.text.slice(0, leftWidth).includes(body)) return "ORIGINAL";
  return row.text.slice(leftWidth + 1).includes(body) ? "MODIFIED" : undefined;
}

describe("side-by-side renderer", () => {
  it("pairs a replacement block across columns", () => {
    const width = 90;
    const [leftWidth] = columnWidths(width);
    const rows = buildSideBySideRows(replacementFile(), plainStyler, width, 0);
    const thirdPair = rows[4]?.text;

    expect(rows[2]?.text.slice(0, leftWidth).trimEnd()).toBe("   4 -old one");
    expect(rows[2]?.text.slice(leftWidth + 1).trimEnd()).toBe("   8 +new one");
    expect(thirdPair?.slice(0, leftWidth).trim()).toBe("");
    expect(thirdPair?.slice(leftWidth + 1).trimEnd()).toBe("  10 +new three");
  });

  it("context rows show the same content on both sides with both numbers", () => {
    const width = 90;
    const [leftWidth] = columnWidths(width);
    const file = changedFile([
      hunk([
        {
          kind: "context",
          content: "shared content",
          oldLineNumber: 12,
          newLineNumber: 18,
        },
      ]),
    ]);
    const row = buildSideBySideRows(file, plainStyler, width, 0)[2]?.text;

    expect(row?.slice(0, leftWidth).trimEnd()).toBe("  12  shared content");
    expect(row?.slice(leftWidth + 1).trimEnd()).toBe("  18  shared content");
  });

  it("hunk headers appear in both columns and sbsHunkStartRows matches", () => {
    const width = 100;
    const [leftWidth] = columnWidths(width);
    const file = changedFile([
      hunk([{ kind: "context", content: "first" }], 0),
      hunk([{ kind: "context", content: "second" }], 1),
    ]);
    const rows = buildSideBySideRows(file, plainStyler, width, 0);
    const starts = rows.flatMap((row, index) =>
      row.isHunkHeader ? [index] : [],
    );

    expect(starts).toEqual([1, 3]);
    expect(sbsHunkStartRows(file)).toEqual(starts);
    for (const row of starts) {
      expect(rows[row]?.text.slice(0, leftWidth)).toContain("@@");
      expect(rows[row]?.text.slice(leftWidth + 1)).toContain("@@");
    }
  });

  it("horizontal offset slices both sides", () => {
    const width = 90;
    const [leftWidth] = columnWidths(width);
    const file = changedFile([
      hunk([
        { kind: "deletion", content: "prefix-old value", oldLineNumber: 1 },
        { kind: "addition", content: "prefix-new value", newLineNumber: 1 },
      ]),
    ]);
    const row = buildSideBySideRows(file, plainStyler, width, 7)[2]?.text;

    expect(row?.slice(5, leftWidth).trimEnd()).toBe("-old value");
    expect(row?.slice(leftWidth + 6).trimEnd()).toBe("+new value");
  });

  it("width notice when side-by-side does not fit", () => {
    const lines = renderSideBySide(
      {
        file: replacementFile(),
        verticalOffset: 0,
        horizontalOffset: 0,
        height: 4,
      },
      60,
      plainStyler,
    );

    expect(lines[0]?.trimEnd()).toBe(SBS_WIDTH_NOTICE);
    expect(lines.slice(1).every((line) => line.trim() === "")).toBe(true);
  });

  it("placeholders reuse unified placeholder text", () => {
    const base = replacementFile();
    const cases: Array<ChangedFile | undefined> = [
      undefined,
      { ...base, isBinary: true, hunks: [] },
      { ...base, isOversized: true, hunks: [] },
      { ...base, status: "unmerged", hunks: [] },
      { ...base, hunks: [] },
    ];

    for (const file of cases) {
      const lines = renderSideBySide(
        { file, verticalOffset: 0, horizontalOffset: 0, height: 4 },
        90,
        plainStyler,
      );
      expect(lines[1]?.trimEnd()).toBe(placeholderFor(file));
    }
  });

  it("the composer sits in ORIGINAL for a standalone deletion", () => {
    const width = 100;
    const anchor = { hunkIndex: 0, lineIndex: 0 };
    const rows = composerRows(deletionFile(), anchor, width);
    const composer = rows.findIndex((row) => row.isComment === true);

    expect(commentColumn(rows, "needs a test", width)).toBe("ORIGINAL");
    expect(rows[composer]?.anchor).toBeUndefined();
    expect(rows[composer + 1]?.isComment).toBe(true);
    expect(rows[composer + 1]?.text).toContain("Enter save");
  });

  it("the composer follows the anchored line on a paired row", () => {
    const width = 100;
    const file = replacementFile();
    const paired = (anchor: LineAnchor): number =>
      composerRows(file, anchor, width).findIndex(
        (row) => row.anchors?.length === 2,
      );

    expect(
      commentColumn(
        composerRows(file, { hunkIndex: 0, lineIndex: 0 }, width),
        "needs a test",
        width,
      ),
    ).toBe("ORIGINAL");
    expect(
      commentColumn(
        composerRows(file, { hunkIndex: 0, lineIndex: 2 }, width),
        "needs a test",
        width,
      ),
    ).toBe("MODIFIED");
    expect(paired({ hunkIndex: 0, lineIndex: 0 })).toBe(
      paired({ hunkIndex: 0, lineIndex: 2 }),
    );
  });

  it("the composer sits in MODIFIED for an addition", () => {
    const width = 100;
    const rows = composerRows(
      replacementFile(),
      { hunkIndex: 0, lineIndex: 4 },
      width,
    );

    expect(commentColumn(rows, "needs a test", width)).toBe("MODIFIED");
  });

  it("the composer and the saved comment share a column", () => {
    const width = 100;
    const file = replacementFile();

    for (const lineIndex of [0, 1, 2, 3, 4]) {
      const anchor = { hunkIndex: 0, lineIndex };
      const comment = buildComment({
        file,
        anchor,
        body: "needs a test",
        scopeLabel: "working tree",
        now: 1,
      });
      const saved = buildSideBySideRows(
        file,
        plainStyler,
        width,
        0,
        anchor,
        true,
        [comment],
      );

      expect(commentColumn(saved, "needs a test", width)).toBeDefined();
      expect(commentColumn(composerRows(file, anchor, width), "needs a test", width))
        .toBe(commentColumn(saved, "needs a test", width));
    }
  });

  it("the composer is width-safe in both columns", () => {
    for (const width of [90, 110, 129, 130, 160, 220]) {
      for (const lineIndex of [0, 4]) {
        const anchor = { hunkIndex: 0, lineIndex };
        const lines = renderSideBySide(
          {
            file: replacementFile(),
            verticalOffset: 0,
            horizontalOffset: 0,
            height: 24,
            cursor: anchor,
          },
          width,
          plainStyler,
          [],
          { anchor, buffer: { text: "needs a test", caret: 12 } },
        );

        for (const line of lines) expect(visibleWidth(line)).toBe(width);
      }
    }
  });

  it("output has exactly height lines and is width-safe", () => {
    for (const width of [90, 110, 129, 130, 160, 220]) {
      for (const height of [8, 10, 16, 24, 40, 60]) {
        const lines = renderSideBySide(
          {
            file: replacementFile(),
            verticalOffset: 0,
            horizontalOffset: 0,
            height,
          },
          width,
          plainStyler,
        );

        expect(lines).toHaveLength(height);
        for (const line of lines) expect(visibleWidth(line)).toBe(width);
      }
    }
  });
});

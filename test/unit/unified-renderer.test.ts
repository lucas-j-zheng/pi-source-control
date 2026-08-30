import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import {
  expandTabs,
  padToWidth,
  sliceColumns,
} from "../../src/diff/line-slicing.ts";
import { parseUnifiedDiff } from "../../src/diff/unified-parser.ts";
import type { ChangedFile, DiffReview } from "../../src/model/diff.ts";
import type { ReviewComment } from "../../src/model/review-comment.ts";
import { SourceControlView } from "../../src/ui/source-control-view.ts";
import { plainStyler, type Styler } from "../../src/ui/theme.ts";
import { createBuffer } from "../../src/ui/line-editor.ts";
import {
  buildUnifiedRows,
  hunkStartRows,
  placeholderFor,
  renderUnifiedDiff,
} from "../../src/ui/unified-renderer.ts";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture(name: string): string {
  return readFileSync(`${fixtureDirectory}/${name}`, "utf8");
}

function modifiedFile(): ChangedFile {
  const [file] = parseUnifiedDiff(fixture("modified.diff"), {
    group: "working",
  });
  if (file === undefined) throw new Error("modified.diff did not contain a file");
  return file;
}

function render(file: ChangedFile, verticalOffset = 0, height = 8): string[] {
  return renderUnifiedDiff(
    { file, verticalOffset, horizontalOffset: 0, height },
    60,
    plainStyler,
  );
}

function comment(
  file: ChangedFile,
  overrides: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id: `${file.id}:0:0`,
    fileId: file.id,
    filePath: file.newPath,
    anchor: { hunkIndex: 0, lineIndex: 0 },
    oldLineNumber: 10,
    newLineNumber: 10,
    lineKind: "context",
    lineText: "const userId = getUserId();",
    contextText: " const userId = getUserId();",
    scopeLabel: "working tree",
    body: "Please check this line.",
    createdAt: 1,
    ...overrides,
  };
}

function viewFor(file: ChangedFile, height = 10): SourceControlView {
  const review: DiffReview = {
    repositoryRoot: "/repo",
    scope: { kind: "workspace" },
    groups: [
      { id: "working", title: "Working Tree", files: [file] },
      { id: "staged", title: "Staged Changes", files: [] },
    ],
    generatedAt: 0,
  };
  return new SourceControlView({
    data: {
      initialReview: review,
      recentCommits: [],
      async loadCommit() {
        return review;
      },
      async refresh() {
        return { review, recentCommits: [] };
      },
    },
    host: { requestRender: () => undefined, rows: () => height },
    styler: plainStyler,
    initialSourceId: "working",
    submitReview: () => undefined,
    onClose: () => undefined,
  });
}

describe("unified renderer", () => {
  it("renders old and new gutters with markers", () => {
    const rows = buildUnifiedRows(modifiedFile(), plainStyler, 40, 0);

    expect(rows[2]?.text).toBe(
      "  10   10  const userId = getUserId();".padEnd(51),
    );
    expect(rows[3]?.text).toBe(
      "  11      -const oldToken = issueToken(userId);".padEnd(51),
    );
    expect(rows[4]?.text).toBe(
      "       11 +const token = issueToken(userId);".padEnd(51),
    );
  });

  it("hunk headers are distinct rows and hunkStartRows points at them", () => {
    const files = parseUnifiedDiff(fixture("multi.diff"), { group: "working" });
    const file = files[1];
    if (file === undefined) throw new Error("multi.diff did not contain two files");
    const rows = buildUnifiedRows(file, plainStyler, 60, 0);

    expect(hunkStartRows(file)).toEqual([1, 5]);
    expect(
      rows.flatMap((row, index) => (row.isHunkHeader ? [index] : [])),
    ).toEqual([1, 5]);
    expect(rows[1]?.text.trim()).toBe(file.hunks[0]?.header);
    expect(rows[5]?.text.trim()).toBe(file.hunks[1]?.header);
  });

  it("vertical offset windows rows and clamps past the end", () => {
    const file = modifiedFile();
    const allRows = buildUnifiedRows(file, plainStyler, 49, 0).map((row) =>
      padToWidth(row.text, 60),
    );

    expect(render(file, 2, 3)).toEqual(allRows.slice(2, 5));
    expect(render(file, 10_000, 3)).toEqual(allRows.slice(-3));
  });

  it("horizontal offset slices code columns", () => {
    const rows = buildUnifiedRows(modifiedFile(), plainStyler, 20, 6);

    expect(rows[2]?.text.slice(11)).toBe("userId = getUserId()");
    expect(rows[3]?.text.slice(10)).toBe("-oldToken = issueToke");
    expect(rows[4]?.text.slice(10)).toBe("+token = issueToken(u");
  });

  it("tabs are expanded to four columns", () => {
    expect(expandTabs("\tvalue")).toBe("    value");
    expect(expandTabs("a\tvalue")).toBe("a   value");

    const file = modifiedFile();
    const line = file.hunks[0]?.lines[0];
    if (line === undefined) throw new Error("modified.diff did not contain lines");
    line.content = "\tvalue";

    expect(
      buildUnifiedRows(file, plainStyler, 12, 0)[2]?.text.slice(11),
    ).toBe("    value   ");
  });

  it("no-newline marker row follows the affected line", () => {
    const [file] = parseUnifiedDiff(fixture("no-newline.diff"), {
      group: "working",
    });
    if (file === undefined) throw new Error("no-newline.diff did not contain a file");
    const rows = buildUnifiedRows(file, plainStyler, 32, 0);

    expect(rows[2]?.text.slice(10).trimEnd()).toBe("-before");
    expect(rows[3]?.text.trim()).toBe("\\ No newline at end of file");
    expect(rows[4]?.text.slice(10).trimEnd()).toBe("+after");
    expect(rows[5]?.text.trim()).toBe("\\ No newline at end of file");
    expect(rows[3]).toMatchObject({ hunkIndex: 0, isHunkHeader: false });
    expect(rows[5]).toMatchObject({ hunkIndex: 0, isHunkHeader: false });
  });

  it("the cursor row is highlighted and no other row is", () => {
    const bg = vi.fn((_role: "selectedBg", text: string) => `<selected>${text}</selected>`);
    const styler: Styler = { ...plainStyler, bg };
    const cursor = { hunkIndex: 0, lineIndex: 1 };
    const rows = buildUnifiedRows(modifiedFile(), styler, 40, 0, cursor);

    expect(bg).toHaveBeenCalledTimes(1);
    expect(rows.filter((row) => row.text.includes("<selected>"))).toHaveLength(1);
    expect(rows.find((row) => row.text.includes("<selected>"))?.anchor).toEqual(
      cursor,
    );
  });

  it("rows carry anchors for content lines only", () => {
    const [file] = parseUnifiedDiff(fixture("no-newline.diff"), {
      group: "working",
    });
    if (file === undefined) throw new Error("no-newline.diff did not contain a file");
    const rows = buildUnifiedRows(file, plainStyler, 32, 0);

    expect(rows[0]?.anchor).toBeUndefined();
    expect(rows[1]?.anchor).toBeUndefined();
    expect(rows[2]?.anchor).toEqual({ hunkIndex: 0, lineIndex: 0 });
    expect(rows[3]?.anchor).toBeUndefined();
    expect(rows[4]?.anchor).toEqual({ hunkIndex: 0, lineIndex: 1 });
    expect(rows[5]?.anchor).toBeUndefined();
  });

  it("a comment renders directly beneath its anchored line", () => {
    const file = modifiedFile();
    const rows = buildUnifiedRows(
      file,
      plainStyler,
      40,
      0,
      undefined,
      true,
      [comment(file)],
    );
    const anchoredRow = rows.findIndex((row) =>
      row.anchor?.hunkIndex === 0 && row.anchor.lineIndex === 0
    );

    expect(rows[anchoredRow + 1]).toMatchObject({
      isComment: true,
      hunkIndex: 0,
      isHunkHeader: false,
    });
    expect(rows[anchoredRow + 1]?.text.slice(11).trimEnd()).toBe(
      "│ 💬 Please check this line.",
    );
  });

  it("a long comment body wraps within the code width", () => {
    const file = modifiedFile();
    const rows = buildUnifiedRows(
      file,
      plainStyler,
      20,
      0,
      undefined,
      true,
      [comment(file, { body: "abcdefghijklmnopqrstuvwxyz0123456789" })],
    );
    const commentRows = rows.filter((row) => row.isComment === true);

    expect(commentRows).toHaveLength(3);
    expect(commentRows.map((row) => row.text.slice(11).trimEnd())).toEqual([
      "│ 💬 abcdefghijklmno",
      "│    pqrstuvwxyz0123",
      "│    456789",
    ]);
    for (const row of commentRows) expect(visibleWidth(row.text)).toBe(31);
  });

  it("two comments on one line render in creation order", () => {
    const file = modifiedFile();
    const rows = buildUnifiedRows(
      file,
      plainStyler,
      40,
      0,
      undefined,
      true,
      [
        comment(file, { id: "later", body: "later", createdAt: 20 }),
        comment(file, { id: "earlier", body: "earlier", createdAt: 10 }),
      ],
    );

    expect(
      rows.filter((row) => row.isComment).map((row) => row.text.trimEnd()),
    ).toEqual([
      "           │ 💬 earlier",
      "           │ 💬 later",
    ]);
  });

  it("comment rows are not anchorable and the cursor skips them", () => {
    const file = modifiedFile();
    const queued = comment(file);
    const rows = buildUnifiedRows(
      file,
      plainStyler,
      40,
      0,
      undefined,
      true,
      [queued],
    );
    expect(rows.filter((row) => row.isComment).every((row) =>
      row.anchor === undefined
    )).toBe(true);

    const subject = viewFor(file);
    subject.dispatch({ type: "add-comment", comment: queued });
    subject.dispatch({ type: "focus-diff" });
    subject.dispatch({ type: "move", delta: 1 });
    expect(subject.getState().cursorByFile.get(file.id)).toEqual({
      hunkIndex: 0,
      lineIndex: 1,
    });
  });

  it("rowForAnchor accounts for comment rows above the cursor", () => {
    const file = modifiedFile();
    const subject = viewFor(file);
    subject.render(60);
    subject.dispatch({
      type: "add-comment",
      comment: comment(file, { body: "x".repeat(100) }),
    });
    subject.dispatch({ type: "focus-diff" });
    subject.dispatch({ type: "move", delta: 4 });

    expect(subject.getState().cursorByFile.get(file.id)).toEqual({
      hunkIndex: 0,
      lineIndex: 4,
    });
    expect(subject.getState().verticalOffsetByFile.get(file.id)).toBe(4);
  });

  it("no comments produces identical output to before", () => {
    const file = modifiedFile();
    const input = {
      file,
      verticalOffset: 0,
      horizontalOffset: 0,
      height: 8,
    };

    expect(renderUnifiedDiff(input, 60, plainStyler, [])).toEqual(
      renderUnifiedDiff(input, 60, plainStyler),
    );
    expect(buildUnifiedRows(file, plainStyler, 49, 0, undefined, true, []))
      .toEqual(buildUnifiedRows(file, plainStyler, 49, 0));
  });

  it("comment rows are width-safe at every test width", () => {
    const ansiStyler: Styler = {
      fg: (_role, text) => `\u001b[32m${text}\u001b[0m`,
      bg: (_role, text) => `\u001b[48;5;236m${text}\u001b[0m`,
      bold: (text) => `\u001b[1m${text}\u001b[0m`,
    };
    const file = modifiedFile();
    const queued = comment(file, {
      body: "A long comment with ANSI \u001b[31mcolored text\u001b[0m that must wrap safely. ".repeat(4),
    });

    for (const width of [50, 60, 89, 90, 110, 129, 130, 160, 220]) {
      const lines = renderUnifiedDiff(
        { file, verticalOffset: 0, horizontalOffset: 0, height: 20 },
        width,
        ansiStyler,
        [queued],
      );
      for (const line of lines) expect(visibleWidth(line)).toBe(width);
    }
  });

  it("the composer renders beneath the line being commented on", () => {
    const file = modifiedFile();
    const rows = buildUnifiedRows(file, plainStyler, 60, 0, undefined, true, [], {
      anchor: { hunkIndex: 0, lineIndex: 1 },
      buffer: { text: "needs a test", caret: 12 },
    });
    const commented = rows.findIndex((row) =>
      row.anchor?.lineIndex === 1 && row.anchor.hunkIndex === 0
    );

    expect(rows[commented + 1]?.isComment).toBe(true);
    expect(rows[commented + 1]?.text.trimEnd()).toBe(
      "           │ 💬 needs a test",
    );
    expect(rows[commented + 2]?.text.trimEnd()).toBe(
      "           │    Enter save · Esc cancel · Alt+Enter newline",
    );
    expect(rows[commented + 1]?.anchor).toBeUndefined();
  });

  it("the composer replaces the comment it is editing", () => {
    const file = modifiedFile();
    const queued = comment(file, { body: "original" });
    const rows = buildUnifiedRows(
      file,
      plainStyler,
      40,
      0,
      undefined,
      true,
      [queued],
      {
        anchor: queued.anchor,
        buffer: createBuffer("original, edited"),
        existingId: queued.id,
      },
    );
    const commentText = rows
      .filter((row) => row.isComment)
      .map((row) => row.text.trimEnd());

    expect(commentText.some((text) => text.includes("original, edited"))).toBe(
      true,
    );
    expect(commentText.some((text) => text.endsWith("💬 original"))).toBe(false);
  });

  it("composer rows are width-safe at every test width", () => {
    const ansiStyler: Styler = {
      fg: (_role, text) => `\u001b[32m${text}\u001b[0m`,
      bg: (_role, text) => `\u001b[48;5;236m${text}\u001b[0m`,
      bold: (text) => `\u001b[1m${text}\u001b[0m`,
    };
    const file = modifiedFile();
    const composing = {
      anchor: { hunkIndex: 0, lineIndex: 0 },
      buffer: createBuffer(
        "A composed comment long enough to wrap across several rows. ".repeat(3),
      ),
    };

    for (const width of [50, 60, 89, 90, 110, 129, 130, 160, 220]) {
      const lines = renderUnifiedDiff(
        { file, verticalOffset: 0, horizontalOffset: 0, height: 20 },
        width,
        ansiStyler,
        [],
        composing,
      );
      for (const line of lines) expect(visibleWidth(line)).toBe(width);
    }
  });

  it("cursor rendering is width-safe at every test width", () => {
    const ansiStyler: Styler = {
      fg: (_role, text) => `\u001b[32m${text}\u001b[0m`,
      bg: (_role, text) => `\u001b[48;5;236m${text}\u001b[0m`,
      bold: (text) => `\u001b[1m${text}\u001b[0m`,
    };
    const file = modifiedFile();

    for (const width of [50, 60, 89, 90, 110, 129, 130, 160, 220]) {
      const lines = renderUnifiedDiff(
        {
          file,
          verticalOffset: 0,
          horizontalOffset: 0,
          height: 8,
          cursor: { hunkIndex: 0, lineIndex: 0 },
        },
        width,
        ansiStyler,
      );

      for (const line of lines) expect(visibleWidth(line)).toBe(width);
    }
  });

  it("placeholders for binary, oversized, unmerged, empty and no file", () => {
    const base = modifiedFile();
    const binary = { ...base, isBinary: true, hunks: [] };
    const oversized = { ...base, isOversized: true, hunks: [] };
    const unmerged: ChangedFile = {
      ...base,
      status: "unmerged",
      hunks: [],
    };
    const empty = { ...base, hunks: [] };
    const cases: Array<[ChangedFile | undefined, string]> = [
      [binary, "Binary file changed. Text diff is unavailable."],
      [
        oversized,
        "Diff omitted because this file exceeds the configured review size limit.",
      ],
      [unmerged, "Unmerged file. Resolve the conflict to view a diff."],
      [empty, "No textual changes."],
      [undefined, "No file selected."],
    ];

    for (const [file, message] of cases) {
      expect(placeholderFor(file)).toBe(message);
      const lines = renderUnifiedDiff(
        { file, verticalOffset: 0, horizontalOffset: 0, height: 4 },
        80,
        plainStyler,
      );
      expect(lines[1]?.trimEnd()).toBe(message);
      expect(lines[0]?.trim()).toBe("");
    }
  });

  it("output has exactly height lines at every width", () => {
    const file = modifiedFile();

    for (const width of [50, 60, 89, 90, 110, 129, 130, 160, 220]) {
      for (const height of [8, 10, 16, 24, 40, 60]) {
        const lines = renderUnifiedDiff(
          { file, verticalOffset: 0, horizontalOffset: 0, height },
          width,
          plainStyler,
        );

        expect(lines).toHaveLength(height);
        for (const line of lines) expect(visibleWidth(line)).toBe(width);
      }
    }
  });

  it("sliceColumns pads and clips", () => {
    expect(sliceColumns("abcdef", 2, 3)).toBe("cde");
    expect(sliceColumns("abcdef", 4, 4)).toBe("ef  ");
    expect(sliceColumns("abcdef", 20, 4)).toBe("    ");
  });

  it("padToWidth pads and truncates ANSI strings", () => {
    const red = "\u001b[31mabcdef\u001b[0m";
    const padded = padToWidth("abc", 6);
    const truncated = padToWidth(red, 4);

    expect(padded).toBe("abc   ");
    expect(visibleWidth(truncated)).toBe(4);
    expect(truncated).toContain("\u001b[31m");
    expect(truncated).toContain("...");
  });
});

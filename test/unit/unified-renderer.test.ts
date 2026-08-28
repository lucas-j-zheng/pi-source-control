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
import type { ChangedFile } from "../../src/model/diff.ts";
import { plainStyler, type Styler } from "../../src/ui/theme.ts";
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

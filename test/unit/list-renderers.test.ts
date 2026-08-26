import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import type { ChangedFile, DiffReview, FileStatus, SourceListItem } from "../../src/model/diff.ts";
import { renderFileList } from "../../src/ui/file-list-renderer.ts";
import { renderFooter } from "../../src/ui/footer-renderer.ts";
import { renderHeader } from "../../src/ui/review-header-renderer.ts";
import { renderSourceList, statusLetter } from "../../src/ui/source-list-renderer.ts";
import { plainStyler } from "../../src/ui/theme.ts";

const sources: SourceListItem[] = [
  { kind: "working", id: "working", label: "Working Tree" },
  { kind: "staged", id: "staged", label: "Staged Changes" },
  {
    kind: "commit",
    id: "commit:1111111111111111111111111111111111111111",
    commitOid: "1111111111111111111111111111111111111111",
    shortOid: "1111111",
    subject: "First commit subject",
    author: "Lucas",
    authoredAt: "2026-08-25",
    parentOids: [],
  },
  {
    kind: "commit",
    id: "commit:2222222222222222222222222222222222222222",
    commitOid: "2222222222222222222222222222222222222222",
    shortOid: "2222222",
    subject: "Second commit subject",
    author: "Lucas",
    authoredAt: "2026-08-24",
    parentOids: [],
  },
  {
    kind: "commit",
    id: "commit:3333333333333333333333333333333333333333",
    commitOid: "3333333333333333333333333333333333333333",
    shortOid: "3333333",
    subject: "Third commit subject",
    author: "Lucas",
    authoredAt: "2026-08-23",
    parentOids: [],
  },
];

function file(id: string, status: FileStatus, name: string, directory: string): ChangedFile {
  return {
    id,
    group: "working",
    status,
    newPath: directory ? `${directory}/${name}` : name,
    displayName: name,
    displayDirectory: directory,
    additions: 12,
    deletions: 3,
    isBinary: false,
    isOversized: false,
    rawPatch: "",
    patchFingerprint: id,
    hunks: [],
  };
}

const files = [
  file("working:src/session.ts", "modified", "session-controller-with-long-name.ts", "src/api/controllers"),
  file("working:src/new.ts", "added", "new.ts", "src"),
  file("working:src/old.ts", "deleted", "old.ts", "src"),
  file("working:README.md", "untracked", "README.md", ""),
];

const workspaceReview: DiffReview = {
  repositoryRoot: "/repo",
  scope: { kind: "workspace" },
  groups: [{ id: "working", title: "Working Tree", files }],
  generatedAt: 0,
};

const sourceInput = {
  items: sources,
  counts: { working: 4, staged: 2, [sources[2]!.id]: 1 },
  selectedId: "working",
  focused: true,
  scrollOffset: 0,
  maxRows: 20,
};

const fileInput = {
  files,
  selectedId: files[0]!.id,
  reviewed: new Set([files[0]!.id]),
  focused: true,
  scrollOffset: 0,
  maxRows: 20,
  title: "FILES CHANGED",
};

describe("list renderers", () => {
  it("source list marks the selected source and shows counts", () => {
    const result = renderSourceList(sourceInput, 50, plainStyler);
    expect(result.lines[1]).toContain("> W Working Tree");
    expect(result.lines[1]).toMatch(/\(4\)\s*$/u);
    expect(result.lines[2]).toContain("  S Staged Changes");
    expect(result.lines[5]).toContain("● 1111111 First commit subject");
  });

  it("source list rowIds align with lines and headings are undefined", () => {
    const result = renderSourceList(sourceInput, 50, plainStyler);
    expect(result.rowIds).toHaveLength(result.lines.length);
    expect(result.rowIds[0]).toBeUndefined();
    expect(result.rowIds[1]).toBe("working");
    expect(result.rowIds[3]).toBeUndefined();
    expect(result.rowIds[4]).toBeUndefined();
  });

  it("source list windows rows by scrollOffset and maxRows", () => {
    const result = renderSourceList({ ...sourceInput, scrollOffset: 2, maxRows: 3 }, 50, plainStyler);
    expect(result.lines).toHaveLength(3);
    expect(result.rowIds).toEqual(["staged", undefined, undefined]);
  });

  it("file list shows reviewed marker and status letters", () => {
    const result = renderFileList(fileInput, 90, plainStyler);
    expect(result.lines[1]).toContain("> ✓ M session-controller-with-long-name.ts");
    expect(result.lines[2]).toContain("A new.ts");
    expect(result.lines[3]).toContain("D old.ts");
    expect(result.lines[4]).toContain("U README.md");
  });

  it("file list drops counts then directory as width shrinks", () => {
    const wide = renderFileList(fileInput, 90, plainStyler).lines[1]!;
    const medium = renderFileList(fileInput, 70, plainStyler).lines[1]!;
    const narrow = renderFileList(fileInput, 60, plainStyler).lines[1]!;
    expect(wide).toContain("+12 −3");
    expect(medium).toContain("src/api/controllers");
    expect(medium).not.toContain("+12 −3");
    expect(narrow).toContain("session-controller-with-long-name.ts");
    expect(narrow).not.toContain("src/api/controllers");
    expect(narrow).not.toContain("+12 −3");
  });

  it("empty file list shows No changes", () => {
    const result = renderFileList({ ...fileInput, files: [] }, 50, plainStyler);
    expect(result.lines[0]).toContain("FILES CHANGED (0)");
    expect(result.lines[1]).toContain("No changes");
    expect(result.rowIds).toEqual([undefined, undefined]);
  });

  it("statusLetter maps every status", () => {
    expect(
      Object.fromEntries(
        (["modified", "added", "deleted", "renamed", "copied", "untracked", "unmerged", "type-changed"] as const).map(
          (status) => [status, statusLetter(status)],
        ),
      ),
    ).toEqual({
      modified: "M",
      added: "A",
      deleted: "D",
      renamed: "R",
      copied: "C",
      untracked: "U",
      unmerged: "!",
      "type-changed": "T",
    });
  });

  it("header for workspace, commit with merge parents, and range", () => {
    expect(renderHeader(workspaceReview, files[0], "unified", 160, plainStyler)[0]).toContain(
      "SOURCE CONTROL · src/api/controllers/session-controller-with-long-name.ts · UNIFIED -/+",
    );

    const commit: DiffReview = {
      ...workspaceReview,
      scope: {
        kind: "commit",
        requestedRevision: "HEAD",
        commitOid: "abcdef0123456789",
        parentCount: 2,
      },
      metadata: {
        oid: "abcdef0123456789",
        shortOid: "abcdef0",
        subject: "Merge feature",
        authorName: "Lucas",
        authoredAt: "2026-08-25",
        parentOids: ["1", "2"],
      },
    };
    expect(renderHeader(commit, files[0], "side-by-side", 160, plainStyler)[0]).toContain(
      "COMMIT abcdef0 · Merge feature · src/api/controllers/session-controller-with-long-name.ts · SIDE-BY-SIDE · parent 1/2",
    );

    const range: DiffReview = {
      ...workspaceReview,
      scope: {
        kind: "range",
        requestedExpression: "main...feature",
        mode: "three-dot",
        leftOid: "1111111111111111",
        rightOid: "2222222222222222",
        effectiveBaseOid: "3333333333333333",
      },
    };
    expect(renderHeader(range, undefined, "unified", 160, plainStyler)[0]).toContain(
      "RANGE main...feature · 3333333 → 2222222 · merge-base comparison · UNIFIED -/+",
    );
  });

  it("footer normal, compact, notice and help variants", () => {
    const base = {
      reviewedCount: 1,
      totalCount: 4,
      focusedPane: "files" as const,
      compact: false,
      helpVisible: false,
    };
    expect(renderFooter(base, 160, plainStyler)[0]).toContain("1/4 reviewed · Tab pane");
    expect(renderFooter({ ...base, compact: true }, 50, plainStyler)[0]).toContain("? help · q close");
    expect(renderFooter({ ...base, notice: "Wider terminal required" }, 80, plainStyler)[0]).toContain(
      "1/4 reviewed · Wider terminal required",
    );
    const help = renderFooter({ ...base, helpVisible: true }, 80, plainStyler);
    expect(help[0]).toContain("1/4 reviewed");
    expect(help).toHaveLength(16);
    expect(help.some((line) => line.includes("Space  Mark/unmark"))).toBe(true);
  });

  it("every renderer is width-safe at all test widths", () => {
    const widths = [50, 60, 89, 90, 110, 129, 130, 160, 220];
    for (const width of widths) {
      const sourceRows = renderSourceList(sourceInput, width, plainStyler).lines;
      const fileRows = renderFileList(fileInput, width, plainStyler).lines;
      const otherLines = [
        ...renderHeader(workspaceReview, files[0], "unified", width, plainStyler),
        ...renderFooter({ reviewedCount: 1, totalCount: 4, focusedPane: "diff", compact: false, helpVisible: false }, width, plainStyler),
        ...renderFooter({ reviewedCount: 1, totalCount: 4, focusedPane: "diff", compact: false, helpVisible: true }, width, plainStyler),
      ];
      for (const line of [...sourceRows, ...fileRows, ...otherLines]) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      for (const line of [...sourceRows, ...fileRows]) {
        expect(visibleWidth(line)).toBe(width);
      }
    }
  });
});

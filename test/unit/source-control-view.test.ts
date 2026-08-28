import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { parseUnifiedDiff } from "../../src/diff/unified-parser.ts";
import type {
  ChangedFile,
  DiffReview,
  SourceListItem,
} from "../../src/model/diff.ts";
import {
  SourceControlView,
  type ViewDataSource,
} from "../../src/ui/source-control-view.ts";
import { plainStyler, type Styler } from "../../src/ui/theme.ts";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture(name: string): string {
  return readFileSync(`${fixtureDirectory}/${name}`, "utf8");
}

function workspaceReview(files = workingFiles()): DiffReview {
  return {
    repositoryRoot: "/repo",
    scope: { kind: "workspace" },
    groups: [
      { id: "working", title: "Working Tree", files },
      { id: "staged", title: "Staged Changes", files: [] },
    ],
    generatedAt: 1,
  };
}

function workingFiles(): ChangedFile[] {
  return parseUnifiedDiff(fixture("multi.diff"), { group: "working" });
}

function commitReview(commitOid = "a".repeat(40)): DiffReview {
  return {
    repositoryRoot: "/repo",
    scope: {
      kind: "commit",
      requestedRevision: commitOid,
      commitOid,
      parentCount: 1,
    },
    groups: [
      {
        id: "commit",
        title: "FILES CHANGED",
        files: parseUnifiedDiff(fixture("added.diff"), { group: "commit" }),
      },
    ],
    metadata: {
      oid: commitOid,
      shortOid: commitOid.slice(0, 7),
      subject: "Add a new file",
      authorName: "Author",
      authoredAt: "2026-08-25",
      parentOids: ["b".repeat(40)],
    },
    generatedAt: 2,
  };
}

function commitItem(review = commitReview()): SourceListItem {
  if (review.scope.kind !== "commit") throw new Error("expected commit review");
  const metadata = review.metadata;
  if (metadata === undefined || !("subject" in metadata)) {
    throw new Error("expected commit metadata");
  }
  return {
    kind: "commit",
    id: `commit:${metadata.oid}`,
    commitOid: metadata.oid,
    shortOid: metadata.shortOid,
    subject: metadata.subject,
    author: metadata.authorName,
    authoredAt: metadata.authoredAt,
    parentOids: metadata.parentOids,
  };
}

class FakeHost {
  rowCount = 24;
  renders = 0;

  requestRender(): void {
    this.renders += 1;
  }

  rows(): number {
    return this.rowCount;
  }
}

function dataSource(options: {
  initialReview?: DiffReview;
  recentCommits?: SourceListItem[];
  loadCommit?: ViewDataSource["loadCommit"];
  refresh?: ViewDataSource["refresh"];
} = {}): ViewDataSource {
  const initialReview = options.initialReview ?? workspaceReview();
  return {
    initialReview,
    recentCommits: options.recentCommits ?? [],
    loadCommit:
      options.loadCommit ??
      (async () => {
        return commitReview();
      }),
    refresh:
      options.refresh ??
      (async () => ({ review: initialReview, recentCommits: [] })),
  };
}

function view(options: {
  host?: FakeHost;
  data?: ViewDataSource;
  styler?: Styler;
  onClose?: () => void;
} = {}): SourceControlView {
  return new SourceControlView({
    data: options.data ?? dataSource(),
    host: options.host ?? new FakeHost(),
    styler: options.styler ?? plainStyler,
    initialSourceId: "working",
    onClose: options.onClose ?? (() => undefined),
  });
}

describe("source control view", () => {
  it("opens in unified mode focused on sources with working tree selected", () => {
    const subject = view();

    expect(subject.getState()).toMatchObject({
      viewMode: "unified",
      focusedPane: "sources",
      selectedSourceId: "working",
    });
    expect(subject.render(160).join("\n")).toContain("UNIFIED -/+");
  });

  it("selecting a file updates the diff pane immediately", () => {
    const subject = view();
    const files = workingFiles();
    const selected = files[1];
    if (selected === undefined) throw new Error("multi.diff needs a second file");

    subject.dispatch({ type: "select-file", fileId: selected.id });
    const output = subject.render(160).join("\n");

    expect(output).toContain(selected.hunks[0]?.header);
    expect(output).toContain("src/api/session.ts");
  });

  it("selecting a commit lazily loads it once and renders its files", async () => {
    const review = commitReview();
    const item = commitItem(review);
    const loadCommit = vi.fn(async () => review);
    const subject = view({
      data: dataSource({ recentCommits: [item], loadCommit }),
    });

    subject.dispatch({ type: "select-source", sourceId: item.id });
    expect(subject.render(160).join("\n")).toContain("Loading…");
    await vi.waitFor(() => expect(subject.getState().selectedFileId).toBeDefined());
    subject.dispatch({ type: "select-source", sourceId: "working" });
    subject.dispatch({ type: "select-source", sourceId: item.id });

    expect(loadCommit).toHaveBeenCalledTimes(1);
    expect(subject.render(160).join("\n")).toContain("new-file.ts");
  });

  it("q closes and calls onClose", () => {
    const onClose = vi.fn();
    const subject = view({ onClose });

    subject.handleInput("q");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refresh preserves reviewed state only for unchanged fingerprints", async () => {
    const before = workingFiles();
    const first = before[0];
    const second = before[1];
    if (first === undefined || second === undefined) {
      throw new Error("multi.diff needs two files");
    }
    const after = before.map((file, index) =>
      index === 1
        ? { ...file, patchFingerprint: `${file.patchFingerprint}-changed` }
        : file,
    );
    const refresh = vi.fn(async () => ({
      review: workspaceReview(after),
      recentCommits: [],
    }));
    const subject = view({
      data: dataSource({ initialReview: workspaceReview(before), refresh }),
    });
    subject.dispatch({ type: "toggle-reviewed" });
    subject.dispatch({ type: "select-file", fileId: second.id });
    subject.dispatch({ type: "toggle-reviewed" });

    subject.dispatch({ type: "refresh" });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(subject.getState().reviewedFingerprints).toEqual(
        new Set([first.patchFingerprint]),
      ),
    );
  });

  it("theme invalidate clears the render cache", () => {
    const fg = vi.fn((_role, text: string) => text);
    const styler: Styler = {
      fg,
      bg: vi.fn((_role, text: string) => text),
      bold: vi.fn((text: string) => text),
    };
    const subject = view({ styler });

    subject.render(160);
    const calls = fg.mock.calls.length;
    subject.render(160);
    expect(fg).toHaveBeenCalledTimes(calls);
    subject.invalidate();
    subject.render(160);

    expect(fg.mock.calls.length).toBeGreaterThan(calls);
  });

  it("render cache returns the same array for identical inputs", () => {
    const subject = view();

    expect(subject.render(160)).toBe(subject.render(160));
  });

  it("narrow mode renders one pane and Enter/Esc walk the screens", () => {
    const host = new FakeHost();
    const subject = view({ host });
    const sources = subject.render(60).join("\n");
    expect(sources).toContain("WORKSPACE");
    expect(sources).not.toContain("OLD  NEW");

    subject.handleInput("\r");
    const files = subject.render(60).join("\n");
    expect(subject.getState().focusedPane).toBe("files");
    expect(files).toContain("Working Tree");
    expect(files).not.toContain("WORKSPACE");

    subject.handleInput("\r");
    expect(subject.getState().focusedPane).toBe("diff");
    expect(subject.render(60).join("\n")).toContain("OLD  NEW");
    subject.handleInput("\u001b");
    expect(subject.getState().focusedPane).toBe("files");
    subject.handleInput("\u001b");
    expect(subject.getState().focusedPane).toBe("sources");
  });

  it("Esc from the diff pane in wide mode returns focus to the file list without closing", () => {
    const onClose = vi.fn();
    const subject = view({ onClose });
    subject.render(160);
    subject.dispatch({ type: "focus-diff" });

    subject.handleInput("\u001b");

    expect(subject.getState().focusedPane).toBe("files");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a data-source error surfaces as a footer notice", async () => {
    const review = commitReview();
    const item = commitItem(review);
    const subject = view({
      data: dataSource({
        recentCommits: [item],
        loadCommit: async () => {
          throw new Error("Commit could not be loaded\ninternal detail");
        },
      }),
    });

    subject.dispatch({ type: "select-source", sourceId: item.id });
    await vi.waitFor(() =>
      expect(subject.getState().notice).toBe("Commit could not be loaded"),
    );

    expect(subject.render(160).join("\n")).toContain(
      "Commit could not be loaded",
    );
    expect(subject.render(160).join("\n")).not.toContain("internal detail");
  });
});

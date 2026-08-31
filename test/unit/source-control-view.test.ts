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

function commitReviewOf(commitOid: string, patch: string): DiffReview {
  return {
    ...commitReview(commitOid),
    groups: [
      {
        id: "commit",
        title: "FILES CHANGED",
        files: parseUnifiedDiff(patch, { group: "commit" }),
      },
    ],
  };
}

function longFile(): ChangedFile[] {
  const body = Array.from({ length: 30 }, (_, index) => ` line ${index + 1}`);
  return parseUnifiedDiff(
    [
      "diff --git a/src/long.ts b/src/long.ts",
      "index 4444444..5555555 100644",
      "--- a/src/long.ts",
      "+++ b/src/long.ts",
      "@@ -1,30 +1,31 @@",
      ...body,
      "+line 31",
      "",
    ].join("\n"),
    { group: "working" },
  );
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
  submitReview?: (message: string, commentCount: number) => void;
  onClose?: () => void;
} = {}): SourceControlView {
  return new SourceControlView({
    data: options.data ?? dataSource(),
    host: options.host ?? new FakeHost(),
    styler: options.styler ?? plainStyler,
    initialSourceId: "working",
    submitReview: options.submitReview ?? (() => undefined),
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

  it("a commit whose load failed can be selected again and retries", async () => {
    const review = commitReview();
    const item = commitItem(review);
    let attempts = 0;
    const loadCommit = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Commit could not be loaded");
      return review;
    });
    const subject = view({
      data: dataSource({ recentCommits: [item], loadCommit }),
    });

    subject.dispatch({ type: "select-source", sourceId: item.id });
    await vi.waitFor(() =>
      expect(subject.getState().notice).toBe("Commit could not be loaded")
    );
    expect(subject.getState().pendingSourceId).toBeUndefined();

    subject.dispatch({ type: "select-source", sourceId: item.id });
    await vi.waitFor(() =>
      expect(subject.getState().selectedFileId).toBe("commit:src/new-file.ts")
    );

    expect(loadCommit).toHaveBeenCalledTimes(2);
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

  it("the render cache does not grow without bound", () => {
    const subject = view();
    const oldestFrame = subject.render(100);
    for (const width of [101, 102, 103, 104]) subject.render(width);

    expect(subject.render(100)).not.toBe(oldestFrame);
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

  it("composing routes every key to the buffer instead of the bindings", () => {
    const onClose = vi.fn();
    const subject = view({ onClose });
    subject.render(160);
    subject.dispatch({ type: "focus-diff" });
    subject.handleInput("c");

    expect(subject.getState().composing).toBeDefined();

    for (const key of ["q", "j", "\t", "v"]) subject.handleInput(key);


    expect(onClose).not.toHaveBeenCalled();
    expect(subject.getState()).toMatchObject({
      focusedPane: "diff",
      viewMode: "unified",
    });
    expect(subject.getState().composing?.buffer.text).toBe("qjv");

    const composingOutput = subject.render(160).join("\n");
    expect(composingOutput).toContain("Composing comment");
    // The composer's own hint row — the footer banner alone would not have it.
    expect(composingOutput).toContain("Alt+Enter newline");

    subject.handleInput("\r");

    expect(subject.getState().composing).toBeUndefined();
    expect(subject.getState().comments).toHaveLength(1);
    expect(subject.getState().comments[0]?.body).toBe("qjv");
    expect(subject.render(160).join("\n")).toContain("1 comment");
  });

  it("the composer is on screen when c is pressed on the last line of a long diff", () => {
    const host = new FakeHost();
    host.rowCount = 16;
    const subject = view({
      host,
      data: dataSource({ initialReview: workspaceReview(longFile()) }),
    });
    subject.render(160);
    subject.dispatch({ type: "focus-diff" });
    subject.dispatch({ type: "end" });
    subject.handleInput("c");

    const output = subject.render(160);
    expect(output).toHaveLength(16);
    const body = output.join("\n");
    expect(body).toContain("line 31");
    expect(body).toContain("💬");
    expect(body).toContain("Alt+Enter newline");
  });

  it("the composer stays on screen when the terminal shrinks mid-draft", () => {
    const host = new FakeHost();
    host.rowCount = 40;
    const subject = view({
      host,
      data: dataSource({ initialReview: workspaceReview(longFile()) }),
    });
    subject.render(160);
    subject.dispatch({ type: "focus-diff" });
    subject.dispatch({ type: "end" });
    subject.handleInput("c");
    for (const key of "draft") subject.handleInput(key);
    subject.render(160);

    host.rowCount = 16;
    const resizedFrame = subject.render(160).join("\n");

    expect(resizedFrame).toContain("Alt+Enter newline");
  });

  it("a comment on one commit is untouched by the same file in another commit", async () => {
    const firstOid = "a".repeat(40);
    const secondOid = "c".repeat(40);
    const first = commitReviewOf(firstOid, fixture("added.diff"));
    const second = commitReviewOf(
      secondOid,
      fixture("added.diff").replace("42", "43"),
    );
    const subject = view({
      data: dataSource({
        recentCommits: [commitItem(first), commitItem(second)],
        loadCommit: async (commitOid) =>
          commitOid === firstOid ? first : second,
      }),
    });
    const comment = async (sourceId: string, body: string): Promise<void> => {
      subject.dispatch({ type: "select-source", sourceId });
      await vi.waitFor(() =>
        expect(subject.getState().selectedFileId).toBe("commit:src/new-file.ts"),
      );
      subject.dispatch({ type: "focus-diff" });
      subject.handleInput("c");
      expect(subject.getState().composing?.buffer.text).toBe("");
      for (const key of body) subject.handleInput(key);
      subject.handleInput("\r");
    };

    await comment(`commit:${firstOid}`, "first");
    await comment(`commit:${secondOid}`, "second");

    expect(subject.getState().comments.map((entry) => entry.body)).toEqual([
      "first",
      "second",
    ]);

    subject.handleInput("d");

    expect(subject.getState().comments.map((entry) => entry.body)).toEqual([
      "first",
    ]);
  });

  it("a refresh landing mid-compose drops a draft its file no longer matches", async () => {
    const before = workingFiles();
    const after = before.map((file, index) =>
      index === 0
        ? { ...file, patchFingerprint: `${file.patchFingerprint}-changed` }
        : file,
    );
    let settle = (): void => undefined;
    const subject = view({
      data: dataSource({
        initialReview: workspaceReview(before),
        refresh: async () =>
          new Promise((resolve) => {
            settle = () =>
              resolve({
                review: workspaceReview(after),
                recentCommits: [],
              });
          }),
      }),
    });
    subject.render(160);
    subject.handleInput("g");
    subject.dispatch({ type: "focus-diff" });
    subject.handleInput("c");
    for (const key of "draft") subject.handleInput(key);

    settle();

    await vi.waitFor(() =>
      expect(subject.getState().composing).toBeUndefined(),
    );
    expect(subject.getState().notice).toBe(
      "Comment draft dropped after refresh.",
    );
    expect(subject.getState().comments).toEqual([]);
  });

  it("a refresh that changes nothing keeps the draft", async () => {
    const refresh = vi.fn(async () => ({
      review: workspaceReview(),
      recentCommits: [],
    }));
    const subject = view({ data: dataSource({ refresh }) });
    subject.render(160);
    subject.handleInput("g");
    subject.dispatch({ type: "focus-diff" });
    subject.handleInput("c");
    for (const key of "draft") subject.handleInput(key);

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(subject.getState().pendingSourceId).toBeUndefined(),
    );

    expect(subject.getState().composing?.buffer.text).toBe("draft");
    expect(subject.getState().notice).toBeUndefined();
  });

  it("a notice while composing is shown next to the composing banner", () => {
    const subject = view();
    subject.render(160);
    subject.dispatch({ type: "focus-diff" });
    subject.handleInput("c");
    subject.dispatch({ type: "set-notice", notice: "1 comment dropped after refresh." });

    const output = subject.render(160).join("\n");
    expect(output).toContain("1 comment dropped after refresh.");
    expect(output).toContain("Composing comment");
  });

  it("Esc while composing discards the draft and keeps the reviewer open", () => {
    const onClose = vi.fn();
    const subject = view({ onClose });
    subject.render(160);
    subject.dispatch({ type: "focus-diff" });
    subject.handleInput("c");
    subject.handleInput("x");
    subject.handleInput("\u001b");

    expect(subject.getState().composing).toBeUndefined();
    expect(subject.getState().comments).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("submitting hands the command layer the message and the comment count", () => {
    const submitReview = vi.fn<(message: string, commentCount: number) => void>();
    const onClose = vi.fn();
    const subject = view({ submitReview, onClose });
    subject.render(160);
    subject.dispatch({ type: "focus-diff" });
    subject.handleInput("c");
    subject.handleInput("Rename this.");
    subject.handleInput("\r");
    subject.dispatch({ type: "submit-comments" });

    expect(submitReview).toHaveBeenCalledOnce();
    const [message, commentCount] = submitReview.mock.calls[0] ?? [];
    expect(message).toContain("Rename this.");
    expect(commentCount).toBe(1);
    expect(onClose).toHaveBeenCalledOnce();
    expect(subject.getState().comments).toEqual([]);
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

  it("a repeated identical error notice still repaints", () => {
    const subject = view({
      data: dataSource({ initialReview: workspaceReview([]) }),
    });
    const internals = subject as unknown as {
      loadingSourceIds: Set<string>;
      setNotice(notice: string): void;
    };
    subject.dispatch({ type: "set-notice", notice: "Commit load timed out" });
    internals.loadingSourceIds.add("working");
    expect(subject.render(160).join("\n")).toContain("Loading…");

    internals.loadingSourceIds.delete("working");
    internals.setNotice("Commit load timed out");
    const repainted = subject.render(160).join("\n");

    expect(repainted).toContain("Commit load timed out");
    expect(repainted).not.toContain("Loading…");
  });
});

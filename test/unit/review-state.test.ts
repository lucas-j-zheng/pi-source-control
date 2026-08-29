import { describe, expect, it, vi } from "vitest";

import type {
  ChangedFile,
  DiffGroupId,
  SourceListItem,
} from "../../src/model/diff.ts";
import type { ReviewComment } from "../../src/model/review-comment.ts";
import {
  createInitialState,
  reduce,
  type LineAnchor,
  type ReviewEnv,
  type ReviewSessionState,
  type UiAction,
} from "../../src/model/review-state.ts";
import { computeLayout, type Layout } from "../../src/ui/layout.ts";
import { SourceControlView } from "../../src/ui/source-control-view.ts";
import { plainStyler } from "../../src/ui/theme.ts";

const sources: SourceListItem[] = [
  { kind: "working", id: "working", label: "Working Tree" },
  { kind: "staged", id: "staged", label: "Staged Changes" },
  {
    kind: "commit",
    id: "commit:one",
    commitOid: "one",
    shortOid: "one",
    subject: "One",
    author: "Author",
    authoredAt: "2026-01-01",
    parentOids: [],
  },
  {
    kind: "commit",
    id: "commit:two",
    commitOid: "two",
    shortOid: "two",
    subject: "Two",
    author: "Author",
    authoredAt: "2026-01-02",
    parentOids: ["one"],
  },
];

function changedFile(sourceId: string, index: number): ChangedFile {
  const group: DiffGroupId = sourceId.startsWith("commit:")
    ? "commit"
    : (sourceId as "working" | "staged");
  return {
    id: `${sourceId}:file-${index}`,
    group,
    status: "modified",
    newPath: `${sourceId}/file-${index}.ts`,
    displayName: `file-${index}.ts`,
    displayDirectory: sourceId,
    additions: index,
    deletions: 0,
    isBinary: false,
    isOversized: false,
    rawPatch: `patch-${sourceId}-${index}`,
    patchFingerprint: `fingerprint-${sourceId}-${index}`,
    hunks: [],
  };
}

const allFiles = new Map(
  sources.map((source) => [
    source.id,
    [0, 1, 2].map((index) => changedFile(source.id, index)),
  ]),
);

interface EnvOptions {
  layout?: Layout;
  unloaded?: Set<string>;
  rowCount?: (file: ChangedFile, mode: ReviewSessionState["viewMode"]) => number;
  customSources?: SourceListItem[];
}

const diffAnchors: LineAnchor[] = Array.from(
  { length: 3 },
  (_, hunkIndex) =>
    Array.from({ length: 10 }, (_unused, lineIndex) => ({
      hunkIndex,
      lineIndex,
    })),
).flat();

function anchorPosition(anchor: LineAnchor): number {
  return diffAnchors.findIndex(
    (candidate) =>
      candidate.hunkIndex === anchor.hunkIndex &&
      candidate.lineIndex === anchor.lineIndex,
  );
}

function fakeEnv(options: EnvOptions = {}): ReviewEnv {
  const envSources = options.customSources ?? sources;
  return {
    layout: options.layout ?? computeLayout(220, 10),
    sources: envSources,
    filesForSource(sourceId) {
      return options.unloaded?.has(sourceId) ? [] : (allFiles.get(sourceId) ?? []);
    },
    fileById(fileId) {
      return [...allFiles.values()].flat().find((file) => file.id === fileId);
    },
    diffRowCount(file, mode) {
      return options.rowCount?.(file, mode) ?? 40;
    },
    hunkRows() {
      return [1, 15, 30];
    },
    lineAnchors() {
      return diffAnchors;
    },
    rowForAnchor(_file, anchor, mode) {
      const position = anchorPosition(anchor);
      if (position < 0) return -1;
      return mode === "unified"
        ? position + anchor.hunkIndex + 2
        : Math.floor(position / 2) + anchor.hunkIndex + 2;
    },
  };
}

function apply(
  state: ReviewSessionState,
  action: UiAction,
  env: ReviewEnv,
): ReviewSessionState {
  return reduce(state, action, env).state;
}

function reviewComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "working:file-0:0:0",
    fileId: "working:file-0",
    filePath: "working/file-0.ts",
    anchor: { hunkIndex: 0, lineIndex: 0 },
    newLineNumber: 1,
    lineKind: "addition",
    lineText: "value",
    contextText: "+value",
    scopeLabel: "working tree",
    body: "Please fix this.",
    createdAt: 1,
    ...overrides,
  };
}

describe("review state", () => {
  it("initial state is unified, focused on sources, with the first file selected", () => {
    const state = createInitialState("working", fakeEnv());

    expect(state).toMatchObject({
      focusedPane: "sources",
      selectedSourceId: "working",
      selectedFileId: "working:file-0",
      viewMode: "unified",
      version: 0,
    });
    expect(state.selectedFileBySource.get("working")).toBe("working:file-0");
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 0,
    });
  });

  it("selecting a file places the cursor on its first changed line", () => {
    const env = fakeEnv();
    const state = apply(
      createInitialState("working", env),
      { type: "select-file", fileId: "working:file-1" },
      env,
    );

    expect(state.cursorByFile.get("working:file-1")).toEqual({
      hunkIndex: 0,
      lineIndex: 0,
    });
  });

  it("moving source selection replaces the file list and selects its first file", () => {
    const env = fakeEnv();
    const state = apply(createInitialState("working", env), { type: "move", delta: 1 }, env);

    expect(state.selectedSourceId).toBe("staged");
    expect(state.selectedFileId).toBe("staged:file-0");
  });

  it("selecting an unloaded commit emits load-source", () => {
    const env = fakeEnv({ unloaded: new Set(["commit:one"]) });
    const result = reduce(
      createInitialState("working", env),
      { type: "select-source", sourceId: "commit:one" },
      env,
    );

    expect(result.effects).toEqual([
      { type: "load-source", sourceId: "commit:one" },
    ]);
    expect(result.state.selectedFileId).toBeUndefined();
    expect(result.state.pendingSourceId).toBe("commit:one");
    expect(
      reduce(result.state, { type: "select-source", sourceId: "commit:one" }, env)
        .effects,
    ).toEqual([]);
  });

  it("returning to a previously selected source restores its prior file", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "select-file", fileId: "working:file-2" }, env);
    state = apply(state, { type: "select-source", sourceId: "staged" }, env);
    state = apply(state, { type: "select-source", sourceId: "working" }, env);

    expect(state.selectedFileId).toBe("working:file-2");
  });

  it("file moves clamp at both ends", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "enter" }, env);
    state = apply(state, { type: "move", delta: -10 }, env);
    expect(state.selectedFileId).toBe("working:file-0");

    state = apply(state, { type: "move", delta: 10 }, env);
    expect(state.selectedFileId).toBe("working:file-2");
    state = apply(state, { type: "move", delta: 1 }, env);
    expect(state.selectedFileId).toBe("working:file-2");
  });

  it("moving in the diff pane moves the cursor one line at a time and clamps at both ends", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);
    state = apply(state, { type: "move", delta: 1 }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 1,
    });
    state = apply(state, { type: "move", delta: 100 }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 2,
      lineIndex: 9,
    });

    state = apply(state, { type: "move", delta: -100 }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 0,
    });
  });

  it("page and half-page move the cursor by a viewport and clamp", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);
    state = apply(state, { type: "page", delta: 1 }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 5,
    });
    state = apply(state, { type: "half-page", delta: 1 }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 8,
    });
    state = apply(state, { type: "end" }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 2,
      lineIndex: 9,
    });
    state = apply(state, { type: "home" }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 0,
    });
  });

  it("the viewport follows the cursor when it would leave the body height", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);
    state = apply(state, { type: "move", delta: 3 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0") ?? 0).toBe(0);
    state = apply(state, { type: "move", delta: 1 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(1);
    state = apply(state, { type: "move", delta: 1 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(2);
  });

  it("half-page moves list selection by half the body height", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "half-page", delta: 1 }, env);
    expect(state.selectedSourceId).toBe("commit:two");

    state = apply(state, { type: "half-page", delta: -1 }, env);
    expect(state.selectedSourceId).toBe("working");
    state = apply(state, { type: "enter" }, env);
    state = apply(state, { type: "half-page", delta: 1 }, env);
    expect(state.selectedFileId).toBe("working:file-2");
  });

  it("five-line move clamps at list and diff bounds", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "move", delta: 5 }, env);
    expect(state.selectedSourceId).toBe("commit:two");
    state = apply(state, { type: "move", delta: -5 }, env);
    expect(state.selectedSourceId).toBe("working");

    state = apply(state, { type: "focus-diff" }, env);
    state = apply(state, { type: "move", delta: 5 }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 5,
    });
    state = apply(state, { type: "move", delta: 100 }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 2,
      lineIndex: 9,
    });
    state = apply(state, { type: "move", delta: -100 }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 0,
    });
  });

  it("next and previous hunk move the cursor to the first line of that hunk", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "next-hunk" }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 1,
      lineIndex: 0,
    });
    expect(state.selectedHunkByFile.get("working:file-0")).toBe(1);
    state = apply(state, { type: "next-hunk" }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 2,
      lineIndex: 0,
    });
    state = apply(state, { type: "prev-hunk" }, env);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 1,
      lineIndex: 0,
    });
  });

  it("scroll-view moves the viewport without moving the cursor while it stays visible", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);
    const cursor = state.cursorByFile.get("working:file-0");

    state = apply(state, { type: "scroll-view", delta: 1 }, env);

    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(1);
    expect(state.cursorByFile.get("working:file-0")).toBe(cursor);
  });

  it("scroll-view pulls the cursor into view once it would scroll off", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);

    state = apply(state, { type: "scroll-view", delta: 3 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(3);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 1,
    });

    state = apply(state, { type: "move", delta: 7 }, env);
    state = apply(state, { type: "scroll-view", delta: -5 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(0);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 3,
    });
  });

  it("scroll-view clamps at the top and bottom of the diff", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);

    state = apply(state, { type: "scroll-view", delta: 100 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(34);

    state = apply(state, { type: "scroll-view", delta: -100 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(0);
  });

  it("scroll-view is a no-op on the source and file lists", () => {
    const env = fakeEnv();
    let sourceState = createInitialState("working", env);
    sourceState = apply(
      sourceState,
      { type: "set-notice", notice: "Keep this notice" },
      env,
    );
    const sourceResult = reduce(
      sourceState,
      { type: "scroll-view", delta: 1 },
      env,
    );
    expect(sourceResult.state).toBe(sourceState);
    expect(sourceResult.state.notice).toBe("Keep this notice");

    let fileState = apply(sourceState, { type: "enter" }, env);
    fileState = apply(
      fileState,
      { type: "set-notice", notice: "Keep this notice too" },
      env,
    );
    const fileResult = reduce(
      fileState,
      { type: "scroll-view", delta: -1 },
      env,
    );
    expect(fileResult.state).toBe(fileState);
    expect(fileResult.state.notice).toBe("Keep this notice too");
  });

  it("wheel scrolling also pulls the cursor into view", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(
      state,
      { type: "set-scroll", pane: "diff", offset: 12 },
      env,
    );

    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(12);
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 1,
      lineIndex: 0,
    });

    state = apply(
      state,
      { type: "set-scroll", pane: "diff", offset: 0 },
      env,
    );
    expect(state.cursorByFile.get("working:file-0")).toEqual({
      hunkIndex: 0,
      lineIndex: 3,
    });
  });

  it("the cursor survives toggling to side-by-side and back", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);
    state = apply(state, { type: "move", delta: 7 }, env);
    const cursor = state.cursorByFile.get("working:file-0");

    state = apply(state, { type: "toggle-view" }, env);
    expect(state.cursorByFile.get("working:file-0")).toBe(cursor);
    state = apply(state, { type: "toggle-view" }, env);
    expect(state.cursorByFile.get("working:file-0")).toBe(cursor);
  });

  it("focus cycles with Tab and Shift+Tab", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-next" }, env);
    expect(state.focusedPane).toBe("files");
    state = apply(state, { type: "focus-next" }, env);
    expect(state.focusedPane).toBe("diff");
    state = apply(state, { type: "focus-next" }, env);
    expect(state.focusedPane).toBe("sources");
    state = apply(state, { type: "focus-prev" }, env);
    expect(state.focusedPane).toBe("diff");
  });

  it("back steps diff to files to sources in wide mode then closes", () => {
    const env = fakeEnv({ layout: computeLayout(160, 10) });
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);

    state = apply(state, { type: "back" }, env);
    expect(state.focusedPane).toBe("files");
    state = apply(state, { type: "back" }, env);
    expect(state.focusedPane).toBe("sources");
    expect(reduce(state, { type: "back" }, env).effects).toEqual([
      { type: "close" },
    ]);
  });

  it("back steps the same way in medium and narrow modes", () => {
    for (const width of [110, 60]) {
      const env = fakeEnv({ layout: computeLayout(width, 10) });
      let state = apply(
        createInitialState("working", env),
        { type: "focus-diff" },
        env,
      );

      state = apply(state, { type: "back" }, env);
      expect(state.focusedPane).toBe("files");
      state = apply(state, { type: "back" }, env);
      expect(state.focusedPane).toBe("sources");
      expect(reduce(state, { type: "back" }, env).effects).toEqual([
        { type: "close" },
      ]);
    }
  });

  it("back preserves selection, scroll offsets and the line cursor", () => {
    const env = fakeEnv({ layout: computeLayout(160, 10) });
    const initial = createInitialState("working", env);
    const state: ReviewSessionState = {
      ...initial,
      focusedPane: "diff",
      selectedSourceId: "staged",
      selectedFileId: "staged:file-2",
      selectedFileBySource: new Map([
        ["working", "working:file-1"],
        ["staged", "staged:file-2"],
      ]),
      sourceScrollOffset: 2,
      fileScrollOffset: 1,
      verticalOffsetByFile: new Map([["staged:file-2", 12]]),
      horizontalOffsetByFile: new Map([["staged:file-2", 8]]),
      selectedHunkByFile: new Map([["staged:file-2", 1]]),
      cursorByFile: new Map([
        ["staged:file-2", { hunkIndex: 1, lineIndex: 4 }],
      ]),
    };
    const preserved = {
      selectedSourceId: state.selectedSourceId,
      selectedFileId: state.selectedFileId,
      selectedFileBySource: state.selectedFileBySource,
      sourceScrollOffset: state.sourceScrollOffset,
      fileScrollOffset: state.fileScrollOffset,
      verticalOffsetByFile: state.verticalOffsetByFile,
      horizontalOffsetByFile: state.horizontalOffsetByFile,
      selectedHunkByFile: state.selectedHunkByFile,
      cursorByFile: state.cursorByFile,
    };

    const files = apply(state, { type: "back" }, env);
    const sourcesState = apply(files, { type: "back" }, env);

    expect(files).toMatchObject(preserved);
    expect(sourcesState).toMatchObject(preserved);
  });

  it("q closes immediately from every pane", () => {
    const env = fakeEnv({ layout: computeLayout(160, 10) });
    for (const focusedPane of ["sources", "files", "diff"] as const) {
      const state = {
        ...createInitialState("working", env),
        focusedPane,
      };
      expect(reduce(state, { type: "close" }, env).effects).toEqual([
        { type: "close" },
      ]);
    }
  });

  it("toggle-view is refused with a notice when side-by-side is not allowed", () => {
    const env = fakeEnv({ layout: computeLayout(90, 10) });
    const state = apply(createInitialState("working", env), { type: "toggle-view" }, env);

    expect(state.viewMode).toBe("unified");
    expect(state.notice).toBe("Side-by-side requires a wider terminal");
  });

  it("toggle-view switches mode when allowed and clamps the offset", () => {
    const env = fakeEnv({
      layout: computeLayout(220, 10),
      rowCount: (_file, mode) => (mode === "unified" ? 40 : 10),
    });
    let state = createInitialState("working", env);
    state = apply(state, { type: "set-scroll", pane: "diff", offset: 34 }, env);
    state = apply(state, { type: "toggle-view" }, env);

    expect(state.viewMode).toBe("side-by-side");
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(4);
  });

  it("toggle-reviewed keys on patch fingerprint", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "toggle-reviewed" }, env);
    expect(state.reviewedFingerprints).toEqual(
      new Set(["fingerprint-working-0"]),
    );
    state = apply(state, { type: "toggle-reviewed" }, env);
    expect(state.reviewedFingerprints).toEqual(new Set());
  });

  it("refresh emits a refresh effect", () => {
    const env = fakeEnv();
    expect(
      reduce(createInitialState("working", env), { type: "refresh" }, env)
        .effects,
    ).toEqual([{ type: "refresh" }]);
  });

  it("c on a line emits a compose-comment effect for that anchor", () => {
    const env = fakeEnv();
    const state = createInitialState("working", env);
    const file = allFiles.get("working")?.[0];
    if (file === undefined) throw new Error("expected a working file");

    expect(reduce(state, { type: "compose-comment" }, env).effects).toEqual([
      {
        type: "compose-comment",
        file,
        anchor: { hunkIndex: 0, lineIndex: 0 },
      },
    ]);
  });

  it("add-comment queues a comment and a second comment on the same line replaces it", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    const first = reviewComment();
    const replacement = reviewComment({ body: "Use the safer value." });

    state = apply(state, { type: "add-comment", comment: first }, env);
    state = apply(state, { type: "add-comment", comment: replacement }, env);

    expect(state.comments).toEqual([replacement]);
    expect(reduce(state, { type: "compose-comment" }, env).effects[0]).toMatchObject({
      type: "compose-comment",
      existingBody: "Use the safer value.",
    });
  });

  it("c with no anchorable line sets a notice", () => {
    const env = { ...fakeEnv(), lineAnchors: () => [] };
    const result = reduce(
      createInitialState("working", env),
      { type: "compose-comment" },
      env,
    );

    expect(result.effects).toEqual([]);
    expect(result.state.notice).toBe("Nothing to comment on here.");
  });

  it("d removes the comment on the cursor line", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(
      state,
      { type: "add-comment", comment: reviewComment() },
      env,
    );

    state = apply(state, { type: "delete-comment" }, env);

    expect(state.comments).toEqual([]);
  });

  it("submit-comments emits submit-review then close and clears the queue", () => {
    const env = fakeEnv();
    const state = apply(
      createInitialState("working", env),
      { type: "add-comment", comment: reviewComment() },
      env,
    );

    const result = reduce(state, { type: "submit-comments" }, env);

    expect(result.effects.map((effect) => effect.type)).toEqual([
      "submit-review",
      "close",
    ]);
    expect(result.effects[0]).toMatchObject({
      type: "submit-review",
      message: expect.stringContaining("Please fix this."),
    });
    expect(result.state.comments).toEqual([]);
  });

  it("submit-comments with no comments sets a notice and does not close", () => {
    const env = fakeEnv();
    const result = reduce(
      createInitialState("working", env),
      { type: "submit-comments" },
      env,
    );

    expect(result.effects).toEqual([]);
    expect(result.state.notice).toBe("No comments to submit.");
  });

  it("refresh keeps comments on unchanged patches and drops the rest", async () => {
    const before = [changedFile("working", 0), changedFile("working", 1)];
    const after = [
      before[0]!,
      { ...before[1]!, patchFingerprint: "changed-fingerprint" },
    ];
    const makeReview = (files: ChangedFile[]) => ({
      repositoryRoot: "/repo",
      scope: { kind: "workspace" as const },
      groups: [
        { id: "working" as const, title: "Working Tree", files },
        { id: "staged" as const, title: "Staged Changes", files: [] },
      ],
      generatedAt: 0,
    });
    const subject = new SourceControlView({
      data: {
        initialReview: makeReview(before),
        recentCommits: [],
        async loadCommit() {
          return makeReview(after);
        },
        async refresh() {
          return { review: makeReview(after), recentCommits: [] };
        },
      },
      host: { requestRender: () => undefined, rows: () => 24 },
      styler: plainStyler,
      initialSourceId: "working",
      composeComment: async () => undefined,
      submitReview: () => undefined,
      onClose: () => undefined,
    });
    subject.dispatch({ type: "add-comment", comment: reviewComment() });
    subject.dispatch({
      type: "add-comment",
      comment: reviewComment({
        id: "working:file-1:0:0",
        fileId: "working:file-1",
        filePath: "working/file-1.ts",
      }),
    });

    subject.dispatch({ type: "refresh" });

    await vi.waitFor(() => expect(subject.getState().comments).toHaveLength(1));
    expect(subject.getState().comments[0]?.fileId).toBe("working:file-0");
    expect(subject.getState().notice).toBe(
      "1 comment dropped after refresh.",
    );
  });

  it("list scroll offsets keep the selection visible", () => {
    const shortLayout = { ...computeLayout(220, 10), bodyHeight: 2 };
    const env = fakeEnv({ layout: shortLayout });
    let state = createInitialState("working", env);
    state = apply(state, { type: "move", delta: 3 }, env);
    expect(state.sourceScrollOffset).toBe(2);

    state = apply(state, { type: "select-source", sourceId: "working" }, env);
    state = apply(state, { type: "enter" }, env);
    state = apply(state, { type: "move", delta: 2 }, env);
    expect(state.fileScrollOffset).toBe(1);
  });

  it("version increments on every state change and unknown ids are ignored", () => {
    const env = fakeEnv();
    const initial = createInitialState("working", env);
    const focused = reduce(initial, { type: "focus-next" }, env).state;
    const helped = reduce(focused, { type: "toggle-help" }, env).state;
    expect(focused.version).toBe(1);
    expect(helped.version).toBe(2);

    const unknownSource = reduce(
      helped,
      { type: "select-source", sourceId: "missing" },
      env,
    );
    const unknownFile = reduce(
      helped,
      { type: "select-file", fileId: "missing" },
      env,
    );
    expect(unknownSource).toEqual({ state: helped, effects: [] });
    expect(unknownSource.state).toBe(helped);
    expect(unknownFile.state).toBe(helped);
  });
});

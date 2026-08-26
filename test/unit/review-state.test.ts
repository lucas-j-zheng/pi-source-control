import { describe, expect, it } from "vitest";

import type {
  ChangedFile,
  DiffGroupId,
  SourceListItem,
} from "../../src/model/diff.ts";
import {
  createInitialState,
  reduce,
  type ReviewEnv,
  type ReviewSessionState,
  type UiAction,
} from "../../src/model/review-state.ts";
import { computeLayout, type Layout } from "../../src/ui/layout.ts";

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
  };
}

function apply(
  state: ReviewSessionState,
  action: UiAction,
  env: ReviewEnv,
): ReviewSessionState {
  return reduce(state, action, env).state;
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

  it("diff scrolling is bounded by row count and body height", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);
    state = apply(state, { type: "move", delta: 100 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(34);

    state = apply(state, { type: "move", delta: -100 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(0);
  });

  it("page, home and end move the diff viewport", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "focus-diff" }, env);
    state = apply(state, { type: "page", delta: 1 }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(5);
    state = apply(state, { type: "end" }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(34);
    state = apply(state, { type: "home" }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(0);
  });

  it("next and previous hunk land on hunk rows", () => {
    const env = fakeEnv();
    let state = createInitialState("working", env);
    state = apply(state, { type: "next-hunk" }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(1);
    expect(state.selectedHunkByFile.get("working:file-0")).toBe(0);
    state = apply(state, { type: "next-hunk" }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(15);
    state = apply(state, { type: "prev-hunk" }, env);
    expect(state.verticalOffsetByFile.get("working:file-0")).toBe(1);
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

  it("enter advances focus and escape walks back in narrow mode then closes", () => {
    const env = fakeEnv({ layout: computeLayout(60, 10) });
    let state = createInitialState("working", env);
    state = apply(state, { type: "enter" }, env);
    state = apply(state, { type: "enter" }, env);
    expect(state.focusedPane).toBe("diff");
    state = apply(state, { type: "back" }, env);
    expect(state.focusedPane).toBe("files");
    state = apply(state, { type: "back" }, env);
    expect(state.focusedPane).toBe("sources");
    expect(reduce(state, { type: "back" }, env).effects).toEqual([
      { type: "close" },
    ]);
  });

  it("q always closes", () => {
    for (const layout of [computeLayout(60, 10), computeLayout(220, 10)]) {
      const env = fakeEnv({ layout });
      const state = apply(createInitialState("working", env), { type: "focus-diff" }, env);
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
    state = apply(state, { type: "focus-diff" }, env);
    state = apply(state, { type: "end" }, env);
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

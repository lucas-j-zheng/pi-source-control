import type { ChangedFile, SourceListItem } from "./diff.ts";
import type { Layout } from "../ui/layout.ts";

export type FocusedPane = "sources" | "files" | "diff";

export interface LineAnchor {
  hunkIndex: number;
  lineIndex: number;
}

export function anchorEquals(
  a: LineAnchor | undefined,
  b: LineAnchor | undefined,
): boolean {
  return a === b ||
    (a !== undefined &&
      b !== undefined &&
      a.hunkIndex === b.hunkIndex &&
      a.lineIndex === b.lineIndex);
}

export interface ReviewSessionState {
  focusedPane: FocusedPane;
  selectedSourceId: string;
  selectedFileId?: string;
  selectedFileBySource: Map<string, string>;
  sourceScrollOffset: number;
  fileScrollOffset: number;
  viewMode: "unified" | "side-by-side";
  maximizedDiff: boolean;
  reviewedFingerprints: Set<string>;
  verticalOffsetByFile: Map<string, number>;
  horizontalOffsetByFile: Map<string, number>;
  selectedHunkByFile: Map<string, number>;
  cursorByFile: Map<string, LineAnchor>;
  pendingSourceId?: string;
  helpVisible: boolean;
  notice?: string;
  version: number;
}

export type UiAction =
  | { type: "move"; delta: number }
  | { type: "scroll-view"; delta: number }
  | { type: "page"; delta: number }
  | { type: "half-page"; delta: number }
  | { type: "home" }
  | { type: "end" }
  | { type: "focus-next" }
  | { type: "focus-prev" }
  | { type: "enter" }
  | { type: "back" }
  | { type: "close" }
  | { type: "next-hunk" }
  | { type: "prev-hunk" }
  | { type: "scroll-horizontal"; delta: number }
  | { type: "toggle-view" }
  | { type: "toggle-reviewed" }
  | { type: "refresh" }
  | { type: "toggle-help" }
  | { type: "select-source"; sourceId: string }
  | { type: "select-file"; fileId: string }
  | { type: "focus-diff" }
  | {
      type: "set-scroll";
      pane: "sources" | "files" | "diff";
      offset: number;
    }
  | { type: "set-notice"; notice?: string };

export interface ReviewEnv {
  layout: Layout;
  sources: SourceListItem[];
  filesForSource(sourceId: string): ChangedFile[];
  fileById(fileId: string): ChangedFile | undefined;
  diffRowCount(
    file: ChangedFile,
    mode: "unified" | "side-by-side",
  ): number;
  hunkRows(
    file: ChangedFile,
    mode: "unified" | "side-by-side",
  ): number[];
  lineAnchors(file: ChangedFile): LineAnchor[];
  rowForAnchor(
    file: ChangedFile,
    anchor: LineAnchor,
    mode: "unified" | "side-by-side",
  ): number;
}

export type ReviewEffect =
  | { type: "close" }
  | { type: "refresh" }
  | { type: "load-source"; sourceId: string };

export interface ReduceResult {
  state: ReviewSessionState;
  effects: ReviewEffect[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function keepVisible(
  index: number,
  offset: number,
  itemCount: number,
  viewportHeight: number,
): number {
  if (itemCount === 0) return 0;

  const height = Math.max(1, viewportHeight);
  const maximum = Math.max(0, itemCount - height);
  if (index < offset) return clamp(index, 0, maximum);
  if (index >= offset + height) return clamp(index - height + 1, 0, maximum);
  return clamp(offset, 0, maximum);
}

function clearNotice(state: ReviewSessionState): ReviewSessionState {
  return state.notice === undefined ? state : { ...state, notice: undefined };
}

function finish(
  original: ReviewSessionState,
  state: ReviewSessionState,
  effects: ReviewEffect[] = [],
): ReduceResult {
  if (
    state === original ||
    (state.focusedPane === original.focusedPane &&
      state.selectedSourceId === original.selectedSourceId &&
      state.selectedFileId === original.selectedFileId &&
      state.selectedFileBySource === original.selectedFileBySource &&
      state.sourceScrollOffset === original.sourceScrollOffset &&
      state.fileScrollOffset === original.fileScrollOffset &&
      state.viewMode === original.viewMode &&
      state.maximizedDiff === original.maximizedDiff &&
      state.reviewedFingerprints === original.reviewedFingerprints &&
      state.verticalOffsetByFile === original.verticalOffsetByFile &&
      state.horizontalOffsetByFile === original.horizontalOffsetByFile &&
      state.selectedHunkByFile === original.selectedHunkByFile &&
      state.cursorByFile === original.cursorByFile &&
      state.pendingSourceId === original.pendingSourceId &&
      state.helpVisible === original.helpVisible &&
      state.notice === original.notice)
  ) {
    return { state: original, effects };
  }
  return { state: { ...state, version: original.version + 1 }, effects };
}

function withMapValue<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
): Map<K, V> | undefined {
  if (map.get(key) === value) return undefined;
  const next = new Map(map);
  next.set(key, value);
  return next;
}

function cursorForSelectedFile(
  cursorByFile: Map<string, LineAnchor>,
  file: ChangedFile,
  env: ReviewEnv,
): Map<string, LineAnchor> {
  const anchors = env.lineAnchors(file);
  const current = cursorByFile.get(file.id);
  if (anchors.some((anchor) => anchorEquals(anchor, current))) {
    return cursorByFile;
  }

  const firstAnchor = anchors[0];
  if (firstAnchor === undefined && current === undefined) return cursorByFile;

  const next = new Map(cursorByFile);
  if (firstAnchor === undefined) next.delete(file.id);
  else next.set(file.id, firstAnchor);
  return next;
}

function sourceSelection(
  state: ReviewSessionState,
  sourceId: string,
  env: ReviewEnv,
): { state: ReviewSessionState; effects: ReviewEffect[] } {
  const source = env.sources.find((item) => item.id === sourceId);
  if (source === undefined) return { state, effects: [] };

  const files = env.filesForSource(sourceId);
  const rememberedFileId = state.selectedFileBySource.get(sourceId);
  const selectedFile =
    files.find((file) => file.id === rememberedFileId) ?? files[0];
  const selectedFileId = selectedFile?.id;
  const sourceIndex = env.sources.indexOf(source);
  const fileIndex = selectedFile === undefined ? 0 : files.indexOf(selectedFile);
  const sourceScrollOffset = keepVisible(
    sourceIndex,
    state.sourceScrollOffset,
    env.sources.length,
    env.layout.bodyHeight,
  );
  const fileScrollOffset = keepVisible(
    fileIndex,
    state.fileScrollOffset,
    files.length,
    env.layout.bodyHeight,
  );

  let selectedFileBySource = state.selectedFileBySource;
  if (selectedFileId !== undefined) {
    selectedFileBySource =
      withMapValue(selectedFileBySource, sourceId, selectedFileId) ??
      selectedFileBySource;
  }

  let cursorByFile = state.cursorByFile;
  if (selectedFile !== undefined) {
    cursorByFile = cursorForSelectedFile(cursorByFile, selectedFile, env);
  }

  const shouldLoad =
    source.kind === "commit" &&
    files.length === 0 &&
    state.pendingSourceId !== sourceId;
  const effects: ReviewEffect[] = shouldLoad
    ? [{ type: "load-source", sourceId }]
    : [];

  const changed =
    state.selectedSourceId !== sourceId ||
    state.selectedFileId !== selectedFileId ||
    state.selectedFileBySource !== selectedFileBySource ||
    state.cursorByFile !== cursorByFile ||
    state.sourceScrollOffset !== sourceScrollOffset ||
    state.fileScrollOffset !== fileScrollOffset ||
    (shouldLoad && state.pendingSourceId !== sourceId);

  if (!changed) return { state, effects };
  return {
    state: {
      ...state,
      selectedSourceId: sourceId,
      selectedFileId,
      selectedFileBySource,
      cursorByFile,
      sourceScrollOffset,
      fileScrollOffset,
      pendingSourceId: shouldLoad ? sourceId : state.pendingSourceId,
    },
    effects,
  };
}

function fileSelection(
  state: ReviewSessionState,
  fileId: string,
  env: ReviewEnv,
): ReviewSessionState {
  const files = env.filesForSource(state.selectedSourceId);
  const index = files.findIndex((file) => file.id === fileId);
  if (index < 0 || env.fileById(fileId) === undefined) return state;

  const fileScrollOffset = keepVisible(
    index,
    state.fileScrollOffset,
    files.length,
    env.layout.bodyHeight,
  );
  const selectedFileBySource =
    withMapValue(
      state.selectedFileBySource,
      state.selectedSourceId,
      fileId,
    ) ?? state.selectedFileBySource;
  let cursorByFile = state.cursorByFile;
  const file = env.fileById(fileId);
  if (file !== undefined) {
    cursorByFile = cursorForSelectedFile(cursorByFile, file, env);
  }

  if (
    state.selectedFileId === fileId &&
    state.fileScrollOffset === fileScrollOffset &&
    state.selectedFileBySource === selectedFileBySource &&
    state.cursorByFile === cursorByFile
  ) {
    return state;
  }

  return {
    ...state,
    selectedFileId: fileId,
    selectedFileBySource,
    cursorByFile,
    fileScrollOffset,
  };
}

function selectedFile(
  state: ReviewSessionState,
  env: ReviewEnv,
): ChangedFile | undefined {
  return state.selectedFileId === undefined
    ? undefined
    : env.fileById(state.selectedFileId);
}

function verticalMaximum(
  state: ReviewSessionState,
  file: ChangedFile,
  env: ReviewEnv,
  mode = state.viewMode,
): number {
  return Math.max(0, env.diffRowCount(file, mode) - env.layout.bodyHeight);
}

function setDiffViewportOffset(
  state: ReviewSessionState,
  file: ChangedFile,
  offset: number,
  env: ReviewEnv,
): ReviewSessionState {
  const currentOffset = state.verticalOffsetByFile.get(file.id) ?? 0;
  if (offset === currentOffset) return state;

  const verticalOffsetByFile = new Map(state.verticalOffsetByFile);
  verticalOffsetByFile.set(file.id, offset);

  let cursorByFile = state.cursorByFile;
  const currentAnchor = cursorByFile.get(file.id);
  if (currentAnchor !== undefined) {
    const cursorRow = env.rowForAnchor(file, currentAnchor, state.viewMode);
    const viewportEnd = offset + env.layout.bodyHeight;
    if (cursorRow < offset || cursorRow >= viewportEnd) {
      const visibleAnchors = env.lineAnchors(file).filter((anchor) => {
        const row = env.rowForAnchor(file, anchor, state.viewMode);
        return row >= offset && row < viewportEnd;
      });
      const nextAnchor = offset > currentOffset
        ? visibleAnchors[0]
        : visibleAnchors.at(-1);
      if (
        nextAnchor !== undefined &&
        !anchorEquals(currentAnchor, nextAnchor)
      ) {
        cursorByFile = new Map(cursorByFile);
        cursorByFile.set(file.id, nextAnchor);
      }
    }
  }

  return { ...state, verticalOffsetByFile, cursorByFile };
}

function setCursorAndFollow(
  state: ReviewSessionState,
  file: ChangedFile,
  anchor: LineAnchor,
  env: ReviewEnv,
): ReviewSessionState {
  let cursorByFile = state.cursorByFile;
  if (!anchorEquals(cursorByFile.get(file.id), anchor)) {
    cursorByFile = new Map(cursorByFile);
    cursorByFile.set(file.id, anchor);
  }

  let verticalOffsetByFile = state.verticalOffsetByFile;
  const row = env.rowForAnchor(file, anchor, state.viewMode);
  if (row >= 0) {
    const currentOffset = verticalOffsetByFile.get(file.id) ?? 0;
    const offset = keepVisible(
      row,
      currentOffset,
      env.diffRowCount(file, state.viewMode),
      env.layout.bodyHeight,
    );
    if (offset !== currentOffset) {
      verticalOffsetByFile = new Map(verticalOffsetByFile);
      verticalOffsetByFile.set(file.id, offset);
    }
  }

  if (
    cursorByFile === state.cursorByFile &&
    verticalOffsetByFile === state.verticalOffsetByFile
  ) {
    return state;
  }
  return { ...state, cursorByFile, verticalOffsetByFile };
}

function moveDiffCursor(
  state: ReviewSessionState,
  delta: number,
  env: ReviewEnv,
): ReviewSessionState {
  const file = selectedFile(state, env);
  if (file === undefined) return state;
  const anchors = env.lineAnchors(file);
  if (anchors.length === 0) return state;

  const currentAnchor = state.cursorByFile.get(file.id);
  const foundIndex = anchors.findIndex((anchor) =>
    anchorEquals(anchor, currentAnchor)
  );
  const currentIndex = foundIndex < 0 ? 0 : foundIndex;
  const nextIndex = clamp(
    currentIndex + Math.trunc(delta),
    0,
    anchors.length - 1,
  );
  const anchor = anchors[nextIndex];
  return anchor === undefined ? state : setCursorAndFollow(state, file, anchor, env);
}

function moveList(
  state: ReviewSessionState,
  delta: number,
  env: ReviewEnv,
): { state: ReviewSessionState; effects: ReviewEffect[] } {
  if (state.focusedPane === "sources") {
    if (env.sources.length === 0) return { state, effects: [] };
    const ids = env.sources.map((source) => source.id);
    const current = ids.indexOf(state.selectedSourceId);
    const next =
      current < 0
        ? 0
        : clamp(current + Math.trunc(delta), 0, ids.length - 1);
    const sourceId = ids[next];
    if (sourceId === undefined || sourceId === state.selectedSourceId) {
      return { state, effects: [] };
    }
    return sourceSelection(state, sourceId, env);
  }

  if (state.focusedPane === "files") {
    const files = env.filesForSource(state.selectedSourceId);
    if (files.length === 0) return { state, effects: [] };
    const ids = files.map((file) => file.id);
    const current =
      state.selectedFileId === undefined ? -1 : ids.indexOf(state.selectedFileId);
    const next =
      current < 0
        ? 0
        : clamp(current + Math.trunc(delta), 0, ids.length - 1);
    const fileId = ids[next];
    return {
      state: fileId === undefined ? state : fileSelection(state, fileId, env),
      effects: [],
    };
  }

  return { state: moveDiffCursor(state, delta, env), effects: [] };
}

function moveToBoundary(
  state: ReviewSessionState,
  end: boolean,
  env: ReviewEnv,
): { state: ReviewSessionState; effects: ReviewEffect[] } {
  if (state.focusedPane === "sources") {
    const source = end ? env.sources.at(-1) : env.sources[0];
    if (source === undefined || source.id === state.selectedSourceId) {
      return { state, effects: [] };
    }
    return sourceSelection(state, source.id, env);
  }

  if (state.focusedPane === "files") {
    const files = env.filesForSource(state.selectedSourceId);
    const file = end ? files.at(-1) : files[0];
    return {
      state: file === undefined ? state : fileSelection(state, file.id, env),
      effects: [],
    };
  }

  const file = selectedFile(state, env);
  if (file === undefined) return { state, effects: [] };
  const anchors = env.lineAnchors(file);
  const anchor = end ? anchors.at(-1) : anchors[0];
  return {
    state: anchor === undefined
      ? state
      : setCursorAndFollow(state, file, anchor, env),
    effects: [],
  };
}

function moveHunk(
  state: ReviewSessionState,
  direction: 1 | -1,
  env: ReviewEnv,
): ReviewSessionState {
  const file = selectedFile(state, env);
  if (file === undefined) {
    return state.notice === "No hunks" ? state : { ...state, notice: "No hunks" };
  }
  const anchors = env.lineAnchors(file);
  const hunkIndexes = [...new Set(anchors.map((anchor) => anchor.hunkIndex))];
  if (hunkIndexes.length === 0) {
    return state.notice === "No hunks" ? state : { ...state, notice: "No hunks" };
  }

  const currentAnchor = state.cursorByFile.get(file.id) ?? anchors[0];
  const currentHunkPosition = Math.max(
    0,
    hunkIndexes.indexOf(currentAnchor?.hunkIndex ?? -1),
  );
  const targetPosition = clamp(
    currentHunkPosition + direction,
    0,
    hunkIndexes.length - 1,
  );
  const hunkIndex = hunkIndexes[targetPosition];
  const anchor = anchors.find((candidate) => candidate.hunkIndex === hunkIndex);
  if (hunkIndex === undefined || anchor === undefined) return state;

  const moved = setCursorAndFollow(state, file, anchor, env);
  const selectedHunkByFile =
    withMapValue(moved.selectedHunkByFile, file.id, hunkIndex) ??
    moved.selectedHunkByFile;
  return selectedHunkByFile === moved.selectedHunkByFile
    ? moved
    : { ...moved, selectedHunkByFile };
}

export function createInitialState(
  initialSourceId: string,
  env: ReviewEnv,
): ReviewSessionState {
  const firstFile = env.filesForSource(initialSourceId)[0];
  const firstAnchor = firstFile === undefined
    ? undefined
    : env.lineAnchors(firstFile)[0];
  return {
    focusedPane: "sources",
    selectedSourceId: initialSourceId,
    selectedFileId: firstFile?.id,
    selectedFileBySource:
      firstFile === undefined
        ? new Map()
        : new Map([[initialSourceId, firstFile.id]]),
    sourceScrollOffset: 0,
    fileScrollOffset: 0,
    viewMode: "unified",
    maximizedDiff: false,
    reviewedFingerprints: new Set(),
    verticalOffsetByFile: new Map(),
    horizontalOffsetByFile: new Map(),
    selectedHunkByFile: new Map(),
    cursorByFile:
      firstFile === undefined || firstAnchor === undefined
        ? new Map()
        : new Map([[firstFile.id, firstAnchor]]),
    helpVisible: false,
    version: 0,
  };
}

export function reduce(
  state: ReviewSessionState,
  action: UiAction,
  env: ReviewEnv,
): ReduceResult {
  if (
    action.type === "select-source" &&
    !env.sources.some((source) => source.id === action.sourceId)
  ) {
    return { state, effects: [] };
  }
  if (
    action.type === "select-file" &&
    (!env.fileById(action.fileId) ||
      !env
        .filesForSource(state.selectedSourceId)
        .some((file) => file.id === action.fileId))
  ) {
    return { state, effects: [] };
  }

  if (action.type === "set-notice") {
    const next =
      state.notice === action.notice
        ? state
        : { ...state, notice: action.notice };
    return finish(state, next);
  }

  if (action.type === "set-scroll") {
    const offset = Number.isFinite(action.offset)
      ? Math.max(0, Math.trunc(action.offset))
      : 0;
    let next = clearNotice(state);
    if (action.pane === "sources") {
      if (next.sourceScrollOffset !== offset) {
        next = { ...next, sourceScrollOffset: offset };
      }
    } else if (action.pane === "files") {
      if (next.fileScrollOffset !== offset) {
        next = { ...next, fileScrollOffset: offset };
      }
    } else {
      const file = selectedFile(next, env);
      if (file !== undefined) {
        next = setDiffViewportOffset(next, file, offset, env);
      }
    }
    return finish(state, next);
  }

  if (action.type === "scroll-view" && state.focusedPane !== "diff") {
    return { state, effects: [] };
  }

  const working = clearNotice(state);
  let next = working;
  let effects: ReviewEffect[] = [];

  switch (action.type) {
    case "move": {
      const result = moveList(working, action.delta, env);
      next = result.state;
      effects = result.effects;
      break;
    }
    case "scroll-view": {
      const file = selectedFile(working, env);
      if (file !== undefined) {
        const current = working.verticalOffsetByFile.get(file.id) ?? 0;
        const offset = clamp(
          current + Math.trunc(action.delta),
          0,
          verticalMaximum(working, file, env),
        );
        next = setDiffViewportOffset(working, file, offset, env);
      }
      break;
    }
    case "page": {
      const delta = Math.trunc(action.delta) * Math.max(1, env.layout.bodyHeight - 1);
      const result = moveList(working, delta, env);
      next = result.state;
      effects = result.effects;
      break;
    }
    case "half-page": {
      const delta =
        Math.trunc(action.delta) *
        Math.max(1, Math.floor(env.layout.bodyHeight / 2));
      const result = moveList(working, delta, env);
      next = result.state;
      effects = result.effects;
      break;
    }
    case "home":
    case "end": {
      const result = moveToBoundary(working, action.type === "end", env);
      next = result.state;
      effects = result.effects;
      break;
    }
    case "focus-next": {
      const order: FocusedPane[] = ["sources", "files", "diff"];
      const index = order.indexOf(working.focusedPane);
      next = { ...working, focusedPane: order[(index + 1) % order.length] ?? "sources" };
      break;
    }
    case "focus-prev": {
      const order: FocusedPane[] = ["sources", "files", "diff"];
      const index = order.indexOf(working.focusedPane);
      next = { ...working, focusedPane: order[(index + order.length - 1) % order.length] ?? "diff" };
      break;
    }
    case "enter":
      if (working.focusedPane === "sources") {
        next = { ...working, focusedPane: "files" };
      } else if (working.focusedPane === "files") {
        next = { ...working, focusedPane: "diff" };
      }
      break;
    case "back":
      if (working.focusedPane !== "sources") {
        next = {
          ...working,
          focusedPane: working.focusedPane === "diff" ? "files" : "sources",
        };
      } else {
        effects = [{ type: "close" }];
      }
      break;
    case "close":
      effects = [{ type: "close" }];
      break;
    case "next-hunk":
      next = moveHunk(working, 1, env);
      break;
    case "prev-hunk":
      next = moveHunk(working, -1, env);
      break;
    case "scroll-horizontal": {
      const file = selectedFile(working, env);
      if (file !== undefined) {
        const current = working.horizontalOffsetByFile.get(file.id) ?? 0;
        const offset = Math.max(0, current + Math.trunc(action.delta) * 8);
        if (offset === current) break;
        const horizontalOffsetByFile = withMapValue(
          working.horizontalOffsetByFile,
          file.id,
          offset,
        );
        if (horizontalOffsetByFile !== undefined) {
          next = { ...working, horizontalOffsetByFile };
        }
      }
      break;
    }
    case "toggle-view":
      if (!env.layout.sideBySideAllowed) {
        next =
          working.notice === "Side-by-side requires a wider terminal"
            ? working
            : {
                ...working,
                notice: "Side-by-side requires a wider terminal",
              };
      } else {
        const viewMode =
          working.viewMode === "unified" ? "side-by-side" : "unified";
        const file = selectedFile(working, env);
        let verticalOffsetByFile = working.verticalOffsetByFile;
        if (file !== undefined) {
          const current = verticalOffsetByFile.get(file.id) ?? 0;
          const offset = clamp(
            current,
            0,
            verticalMaximum(working, file, env, viewMode),
          );
          if (offset !== current) {
            verticalOffsetByFile =
              withMapValue(verticalOffsetByFile, file.id, offset) ??
              verticalOffsetByFile;
          }
        }
        next = { ...working, viewMode, verticalOffsetByFile };
      }
      break;
    case "toggle-reviewed": {
      const file = selectedFile(working, env);
      if (file !== undefined) {
        const reviewedFingerprints = new Set(working.reviewedFingerprints);
        if (reviewedFingerprints.has(file.patchFingerprint)) {
          reviewedFingerprints.delete(file.patchFingerprint);
        } else {
          reviewedFingerprints.add(file.patchFingerprint);
        }
        next = { ...working, reviewedFingerprints };
      }
      break;
    }
    case "refresh":
      next =
        working.pendingSourceId === undefined
          ? working
          : { ...working, pendingSourceId: undefined };
      effects = [{ type: "refresh" }];
      break;
    case "toggle-help":
      next = { ...working, helpVisible: !working.helpVisible };
      break;
    case "select-source": {
      const result = sourceSelection(working, action.sourceId, env);
      next =
        result.state.focusedPane === "sources"
          ? result.state
          : { ...result.state, focusedPane: "sources" };
      effects = result.effects;
      break;
    }
    case "select-file": {
      const selected = fileSelection(working, action.fileId, env);
      next =
        selected.focusedPane === "files"
          ? selected
          : { ...selected, focusedPane: "files" };
      break;
    }
    case "focus-diff":
      if (working.focusedPane !== "diff") {
        next = { ...working, focusedPane: "diff" };
      }
      break;
  }

  return finish(state, next, effects);
}

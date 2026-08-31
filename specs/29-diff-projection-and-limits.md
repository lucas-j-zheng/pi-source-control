# 29 — One memoized row projection, and a size limit on every reader

## Goal
Build a file's row model once per (file, mode, width, offset, comments, composer) instead of once per
anchor, and cap patch size in every reader. Scrolling a 2,000-line diff currently costs ~15 seconds
per keypress, and `/diff commit` has no size limit at all.

## Depends on
- 10-unified-renderer / 11-side-by-side-renderer (`buildUnifiedRows`, `buildSideBySideRows`)
- 12-review-state-and-input (`ReviewEnv`, `setDiffViewportOffset`, `setCursorAndFollow`)
- 04-workspace-review-reader (`applyPatchLimit`, `MAX_PATCH_BYTES` from `src/git/workspace-review-reader.ts`)

## Files
- create `src/ui/diff-projection.ts`
- modify `src/ui/source-control-view.ts`
- modify `src/model/review-state.ts`
- modify `src/git/workspace-review-reader.ts`, `src/git/commit-review-reader.ts`, `src/git/range-review-reader.ts`
- create `test/unit/diff-projection.test.ts`
- modify `test/unit/review-state.test.ts`

## Interfaces
```ts
// diff-projection.ts — a cached, style-free view of one file's row model
export interface Projection {
  rowCount: number;
  rowForAnchor(anchor: LineAnchor): number;   // -1 when absent
  anchors: readonly LineAnchor[];
  composerSpan?: { anchorRow: number; lastRow: number; rowCount: number };
}
export interface ProjectionKey {
  fileId: string; fingerprint: string; mode: "unified" | "side-by-side";
  width: number; horizontalOffset: number; commentsVersion: number; composerVersion: number;
}
export function createProjectionCache(build: (key: ProjectionKey, file: ChangedFile) => Projection): {
  get(key: ProjectionKey, file: ChangedFile): Projection;
  clear(): void;
};
```

## Behavior
- `SourceControlView` owns one `createProjectionCache`. `ReviewEnv.rowForAnchor`, `diffRowCount`,
  `lineAnchors` and `composerRows` all read from the projection for the current key, so a reducer
  action builds the row model **at most once**, not once per anchor.
- The cache holds the most recent 2 projections and is invalidated by a changed key — the fingerprint
  covers file content, and `commentsVersion`/`composerVersion` are monotonic counters bumped whenever
  the rendered comments or the composer buffer change.
- `setDiffViewportOffset` no longer calls `rowForAnchor` per anchor: it asks the projection for the
  anchors in the visible row range directly. Complexity per scroll keypress becomes O(N) once, not
  O(N²).
- The projection is style-free — it computes rows for measurement using the existing builders with
  `plainStyler`, so it can never diverge from what is rendered in row *count* or ordering.
- **Limits.** `applyPatchLimit` moves to a shared helper applied by all three readers, so commit and
  range reviews get the same `MAX_PATCH_BYTES` oversize placeholder the workspace reader has.
  A new `MAX_TOTAL_PATCH_BYTES` (32 MiB) caps the sum across files in one review; files past the
  budget are marked oversized rather than parsed. Untracked files are read through a concurrency
  limit of 8 with the same total budget, so a repository with 10,000 untracked files cannot exhaust
  memory before the first frame.

## Tests
`test/unit/diff-projection.test.ts`
- "a projection is built once per key and reused"
- "a changed fingerprint, width, mode or comment version rebuilds it"
- "rowForAnchor matches the renderer's row for every anchor" (fuzzed over generated files, both modes)
- "scrolling a 2,000-line file builds the row model a bounded number of times" — instrument the build
  callback and assert the count is < 5 per `scroll-view` action
`test/unit/review-state.test.ts`
- "viewport scrolling keeps the cursor visible without rebuilding per anchor"
Readers
- "a commit patch over the size limit is marked oversized" and the same for a range
- "a review whose files exceed the total budget marks the remainder oversized"

## Out of scope
Streaming git output. Virtualized rendering. Changing what a row looks like — this spec must not
alter a single rendered byte for files under the limits.

## Done when
`pnpm check` exits 0 with 8 new tests passing, all existing tests passing unchanged, and a benchmark
in the test showing a `scroll-view` dispatch on a 2,000-line file completes in under 250 ms.

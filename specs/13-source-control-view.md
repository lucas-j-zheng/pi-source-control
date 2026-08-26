# 13 — SourceControlView root component

## Goal
Compose layout, renderers, state and input into one `Component` that Pi can host via `ctx.ui.custom()`. It owns caching/invalidation and async source loading, and guarantees every rendered line fits.

## Depends on
- 08 (`computeLayout`, `Styler`), 09 (list/header/footer renderers), 10 (`renderUnifiedDiff`, `buildUnifiedRows`, `hunkStartRows`), 11 (`renderSideBySide`, `buildSideBySideRows`, `sbsHunkStartRows`), 12 (`reduce`, `createInitialState`, `actionForKey`, `computeHitTargets`, `ReviewEnv`)
- uses `visibleWidth` from `@earendil-works/pi-tui`

## Files
- create `src/ui/source-control-view.ts`
- create `test/unit/source-control-view.test.ts`, `test/unit/render-width.test.ts`

## Interfaces
```ts
export interface ViewHost { requestRender(): void; rows(): number; }  // adapter over Pi's tui
export interface ViewDataSource {
  initialReview: DiffReview;                       // workspace, commit or range review
  recentCommits: SourceListItem[];                 // [] in commit/range scope
  loadCommit(commitOid: string, signal?: AbortSignal): Promise<DiffReview>;
  refresh(signal?: AbortSignal): Promise<{ review: DiffReview; recentCommits: SourceListItem[] }>;
}
export interface SourceControlViewOptions { data: ViewDataSource; host: ViewHost; styler: Styler; initialSourceId: string; onClose(): void; }
export class SourceControlView {
  constructor(options: SourceControlViewOptions);
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  dispose(): void;
  getState(): ReviewSessionState;        // for tests
  getHitTargets(): HitTarget[];          // computed on last render
  dispatch(action: UiAction): void;      // runs reduce + effects; public for tests
}
```

## Behavior
- Sources: workspace scope → `[working, staged, ...recentCommits]` (source list shows `WORKSPACE` and `RECENT COMMITS`). Commit scope → a single commit item built from `review.metadata` (id `commit:<oid>`), no `WORKSPACE`/`RECENT COMMITS` headings. Range scope → a single row `{kind:"range"}`-like entry rendered as `R <expression>` with id `"range"`; the view may extend `SourceListItem` locally with a `range` variant in `src/model/diff.ts` (add `| { kind: "range"; id: "range"; label: string }`).
- Files per source: `working`/`staged` from the workspace review groups; commit ids from a `Map<oid, DiffReview>` cache filled by `loadCommit`; unloaded → `[]` plus `load-source` effect triggers `loadCommit` once (tracked by `pendingSourceId`; rerun only after refresh). While loading, the file list shows `Loading…` and the diff pane is blank; on completion `requestRender()`. Errors set `notice` to the `GitReviewError.message` first line.
- `render(width)`: `height = host.rows()`; `layout = computeLayout(width, height)`; body: wide/medium → left pane (source list on top, file list below, split so the source list gets `min(sourceRows, floor(bodyHeight/2))`) joined row-by-row with a `│` divider (accent when the right pane is focused, muted otherwise) to the right pane (unified or side-by-side at `rightWidth`); narrow → only the focused pane at full width. Output = header line + top border + body rows (`bodyHeight`) + bottom border + footer line(s). Pane titles/borders use `borderAccent` for the focused pane.
- Caches the rendered `string[]` keyed by `(width, height, state.version, selectedFile?.patchFingerprint, styleVersion)`; `invalidate()` bumps `styleVersion` and clears the cache.
- `handleInput` → `actionForKey` → `dispatch`; effects: `close` → `dispose()` + `onClose()`; `refresh` → `data.refresh()` then rebuild sources/files, drop reviewed fingerprints not present anymore (reviewed keyed on fingerprint so unchanged patches stay reviewed), clear commit cache, keep `selectedSourceId` if still present; `load-source` → `loadCommit`. Every dispatch calls `host.requestRender()`.
- `dispose()` aborts in-flight loads (AbortController) and ignores their results.
- `getHitTargets()` reflects the last render's layout and row ids.
- **Every line of `render()` satisfies `visibleWidth(line) <= width`.**

## Tests
`test/unit/source-control-view.test.ts` — fake `ViewDataSource` built from fixture patches (parse with `parseUnifiedDiff`), fake host with settable rows.
- "opens in unified mode focused on sources with working tree selected"
- "selecting a file updates the diff pane immediately" (rendered output contains that file's hunk header)
- "selecting a commit lazily loads it once and renders its files"
- "q closes and calls onClose"
- "refresh preserves reviewed state only for unchanged fingerprints"
- "theme invalidate clears the render cache" (same state re-renders after invalidate; spy on styler)
- "render cache returns the same array for identical inputs"
- "narrow mode renders one pane and Enter/Esc walk the screens"
- "a data-source error surfaces as a footer notice"
`test/unit/render-width.test.ts`
- "every rendered line fits at all widths and heights" (widths 50,60,89,90,110,129,130,160,220 × heights 8,10,16,24,40,60; both view modes where allowed; after scrolling to end and toggling help)
- "initial view mode is unified at wide, medium and narrow widths"
- "reopening a view resets an earlier side-by-side selection to unified"

## Out of scope
- Pi registration, git (14).

## Done when
`pnpm check` exits 0 with 12 new tests passing.

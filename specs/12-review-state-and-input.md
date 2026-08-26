# 12 — Review session state, actions, input controller, hit targets

## Goal
Model the whole UI as a pure reducer over typed `UiAction`s, with a key→action mapper and a layout→hit-target function. One controller path means keyboard (and any future pointer adapter) can never diverge.

## Depends on
- 08-theme-and-layout (`Layout`)
- 10-unified-renderer (`hunkStartRows`, `buildUnifiedRows` for row counts)
- 11-side-by-side-renderer (`sbsHunkStartRows`, `buildSideBySideRows`, `sideBySideFits`)
- uses `matchesKey` from `@earendil-works/pi-tui`

## Files
- create `src/model/review-state.ts`
- create `src/ui/input-controller.ts`
- create `src/ui/hit-target-registry.ts`
- create `test/unit/review-state.test.ts`, `test/unit/input-controller.test.ts`, `test/unit/hit-target-registry.test.ts`

## Interfaces
```ts
// review-state.ts
export type FocusedPane = "sources" | "files" | "diff";
export interface ReviewSessionState {  // exactly plan §8 "UI session state"
  focusedPane: FocusedPane; selectedSourceId: string; selectedFileId?: string;
  sourceScrollOffset: number; fileScrollOffset: number;
  viewMode: "unified" | "side-by-side"; maximizedDiff: boolean;
  reviewedFingerprints: Set<string>;
  verticalOffsetByFile: Map<string, number>; horizontalOffsetByFile: Map<string, number>; selectedHunkByFile: Map<string, number>;
  pendingSourceId?: string; helpVisible: boolean; notice?: string; version: number;
}
export type UiAction =
  | { type: "move"; delta: number } | { type: "page"; delta: number } | { type: "home" } | { type: "end" }
  | { type: "focus-next" } | { type: "focus-prev" } | { type: "enter" } | { type: "back" } | { type: "close" }
  | { type: "next-hunk" } | { type: "prev-hunk" } | { type: "scroll-horizontal"; delta: number }
  | { type: "toggle-view" } | { type: "toggle-reviewed" } | { type: "refresh" } | { type: "toggle-help" }
  | { type: "select-source"; sourceId: string } | { type: "select-file"; fileId: string } | { type: "focus-diff" }
  | { type: "set-notice"; notice?: string };
export interface ReviewEnv {   // everything the reducer needs from outside; provided by the view
  layout: Layout; sources: SourceListItem[]; filesForSource(sourceId: string): ChangedFile[];
  fileById(fileId: string): ChangedFile | undefined; diffRowCount(file: ChangedFile, mode: "unified"|"side-by-side"): number;
  hunkRows(file: ChangedFile, mode: "unified"|"side-by-side"): number[];
}
export function createInitialState(initialSourceId: string, env: ReviewEnv): ReviewSessionState; // viewMode "unified", focus "sources"
export interface ReduceResult { state: ReviewSessionState; effects: Array<{ type: "close" } | { type: "refresh" } | { type: "load-source"; sourceId: string }>; }
export function reduce(state: ReviewSessionState, action: UiAction, env: ReviewEnv): ReduceResult;

// input-controller.ts
export function actionForKey(data: string, state: ReviewSessionState, layout: Layout): UiAction | undefined;

// hit-target-registry.ts
export interface HitInput { layout: Layout; sourceRowIds: (string|undefined)[]; fileRowIds: (string|undefined)[]; sourceListTop: number; fileListTop: number; diffTop: number; }
export function computeHitTargets(input: HitInput): HitTarget[];
export function hitTest(targets: HitTarget[], row: number, column: number): HitTarget["action"] | undefined;
```

## Behavior (reducer)
- Every action that changes state increments `version`. Unknown ids are ignored (state unchanged, no effects).
- `move` on `sources`: selects prev/next source id (clamped) and emits `load-source` when the new source is a commit whose files are not loaded yet (`filesForSource` returns `[]` for a commit → emit; the view decides whether it's truly unloaded). Selecting a source also selects that source's first file (or `undefined`) unless `selectedHunkByFile`/offset maps already remember a file for that source (remember last selected file per source in a `Map` — add field `selectedFileBySource: Map<string,string>` to state).
- `move` on `files`: change `selectedFileId` (clamped); on `diff`: adjust the file's vertical offset by delta, clamped to `[0, max(0, rowCount - layout.bodyHeight)]`.
- `page`: diff scroll by `delta * (bodyHeight - 1)`; on lists, move by `delta * (bodyHeight - 1)` clamped. `home`/`end`: diff offset 0 / max; lists first/last item.
- `focus-next`: sources→files→diff→sources; `focus-prev` reverse. In narrow mode focus changes are the "screen" (only the focused pane renders).
- `enter`: sources→files, files→diff, diff→no-op. `back` (Esc): narrow mode walks diff→files→sources; at sources (or in wide/medium mode) emits `close`. `close` (q) always emits `close`.
- `next-hunk`/`prev-hunk`: sets vertical offset to the next/prev entry of `hunkRows` relative to the current offset and stores `selectedHunkByFile`; no-op with `set-notice`-style notice `No hunks` when none.
- `scroll-horizontal`: horizontal offset `max(0, cur + delta*8)`.
- `toggle-view`: if `layout.sideBySideAllowed` toggles `viewMode` and clamps the vertical offset to the new row count; else sets `notice = "Side-by-side requires a wider terminal"`.
- `toggle-reviewed`: toggles the selected file's `patchFingerprint` in `reviewedFingerprints`.
- `refresh` → effect `refresh`. `toggle-help` flips `helpVisible`. `select-source`/`select-file`/`focus-diff` behave like the keyboard equivalents and set focus to that pane. `set-notice` sets/clears `notice`; any other action clears `notice` first.
- List scroll offsets (`sourceScrollOffset`, `fileScrollOffset`) are adjusted so the selected row stays within `bodyHeight` rows.

## Behavior (input controller)
- Maps per plan §4: up/down/`k`/`j` → move ∓1; Tab/Shift+Tab → focus-next/prev; Enter → enter; Escape → back; `q` → close; `n`/`p` → hunks; pageDown/pageUp → page ±1; home/end; left/right → scroll-horizontal ∓1; `v` toggle-view; space toggle-reviewed; `g` refresh; `?` toggle-help. Unknown → `undefined`. Returns plain objects; no side effects.

## Behavior (hit targets)
- One target per defined `sourceRowIds[i]` at row `sourceListTop+i`, columns `[0, leftWidth)` → select-source; per `fileRowIds[i]` at `fileListTop+i` → select-file; the diff region rows `[diffTop, diffTop+bodyHeight)` columns `[leftWidth+1, width)` → focus-diff. Narrow mode: only the focused pane's targets, full width. `hitTest` returns the first matching target's action.

## Tests
`test/unit/review-state.test.ts` (fake `ReviewEnv` with 2 workspace sources, 2 commits, 3 files each, 40 diff rows, hunks at [1,15,30])
- "initial state is unified, focused on sources, with the first file selected"
- "moving source selection replaces the file list and selects its first file"
- "selecting an unloaded commit emits load-source"
- "returning to a previously selected source restores its prior file"
- "file moves clamp at both ends"
- "diff scrolling is bounded by row count and body height"
- "page, home and end move the diff viewport"
- "next and previous hunk land on hunk rows"
- "focus cycles with Tab and Shift+Tab"
- "enter advances focus and escape walks back in narrow mode then closes"
- "q always closes"
- "toggle-view is refused with a notice when side-by-side is not allowed"
- "toggle-view switches mode when allowed and clamps the offset"
- "toggle-reviewed keys on patch fingerprint"
- "refresh emits a refresh effect"
- "list scroll offsets keep the selection visible"
- "version increments on every state change and unknown ids are ignored"
`test/unit/input-controller.test.ts`
- "maps every documented key to its action" (table-driven over all bindings)
- "unknown keys map to undefined"
`test/unit/hit-target-registry.test.ts`
- "source, file and diff rows map to distinct actions"
- "keyboard and pointer activation dispatch the same action object" (`hitTest` result deep-equals the `select-file` action the reducer accepts)
- "hitboxes follow layout after resize" (compute at 220 then 90; column bounds differ, rows valid)
- "narrow mode exposes only the focused pane"

## Out of scope
- Rendering, git, Pi integration.

## Done when
`pnpm check` exits 0 with 23 new tests passing.

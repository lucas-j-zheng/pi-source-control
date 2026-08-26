# 16 — Mouse-wheel scrolling in Pi fullscreen mode

## Goal
Let the wheel scroll whichever pane is under the pointer when Pi runs in its experimental fullscreen TUI (`tuiMode: "fullscreen"`, pi ≥ 0.84). Regular mode has no mouse reporting, so it must keep working exactly as today via `render(width)`.

## Depends on
- 12-review-state-and-input (`reduce`, `UiAction`, `ReviewSessionState` in `src/model/review-state.ts`)
- 13-source-control-view (`SourceControlView`, its private full-content builders for source list, file list, unified/side-by-side diff)
- 09/10/11 renderers (`renderSourceList`, `renderFileList`, `renderUnifiedDiff`, `renderSideBySide`, `buildUnifiedRows`, `buildSideBySideRows`)
- pi-tui public exports: `VStack`, `HStack`, `ScrollView` (`@earendil-works/pi-tui`, v0.84.x in node_modules — read `dist/components/scroll-view.d.ts`, `stack.js`, `layout-node.d.ts`, `layout.js` lines 40–95 before coding)

## Files
- modify `src/model/review-state.ts` — add action `{ type: "set-scroll"; pane: "sources" | "files" | "diff"; offset: number }`
- create `src/ui/synced-scroll-view.ts`
- create `src/ui/fullscreen-layout.ts`
- modify `src/ui/source-control-view.ts` — `class SourceControlView extends VStack`, build/refresh the fullscreen tree
- create `test/unit/fullscreen-layout.test.ts`
- modify `README.md` — add a "Mouse" subsection under Keyboard reference

## Interfaces
```ts
// synced-scroll-view.ts
export class SyncedScrollView extends ScrollView {
  constructor(child: Component, options: ScrollViewOptions, onUserScroll: (scrollTop: number) => void);
  /** Offset the reducer wants; applied inside updateLayout once content height is known. */
  setDesiredScrollTop(offset: number): void;
  scrollBy(lines: number): number;        // super, then onUserScroll(this.scrollTop) when it moved
  updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void; // super, then apply desired offset (clamped) and clear it
}

// fullscreen-layout.ts
export interface PaneContent { render(width: number): string[]; invalidate(): void; }
export interface FullscreenPanes { sources: SyncedScrollView; files: SyncedScrollView; diff: SyncedScrollView; }
export interface FullscreenTreeInput { layout: Layout; focusedPane: FocusedPane; header: PaneContent; footer: PaneContent; panes: FullscreenPanes; styler: Styler; }
export function buildFullscreenEntries(input: FullscreenTreeInput): StackChild[]; // entries for the root VStack
export function fullscreenHeight(rows: number): number; // rows - 1 (leave one transcript row for Pi's dock/transcript split)

// source-control-view.ts (additions; existing public API unchanged)
export class SourceControlView extends VStack {
  render(width: number): string[];   // unchanged string composition (regular mode)
  getPanes(): FullscreenPanes;       // for tests
  rebuildFullscreenTree(width: number): void; // clear() + addChild(...) from buildFullscreenEntries; called lazily when width/height/mode/focus change
}
```

## Behavior
- `SourceControlView extends VStack` so pi-tui's fullscreen layout engine finds its layout node; the overridden `render(width)` keeps the existing string output for regular mode (tests from spec 13 must still pass unchanged).
- The root entries (in order): header content `{shrink:0}`, top-border content `{shrink:0}`, body `{basis: layout.bodyHeight, grow:0, shrink:1, minSize: 6}`, bottom-border `{shrink:0}`, footer `{shrink:0}`. Body in wide/medium = `HStack([ leftColumn {basis:leftWidth, grow:0, shrink:0}, divider {basis:1, grow:0, shrink:0}, panes.diff {grow:1} ])`, where `leftColumn = VStack([ panes.sources {basis: sourceRows, shrink:0}, panes.files {grow:1} ])` and `sourceRows = min(sourceListLineCount, floor(bodyHeight/2))`. Narrow = only the focused pane's ScrollView `{grow:1}`.
- Divider content renders `bodyHeight` lines of `│` styled `borderAccent` when `focusedPane === "diff"`, else `borderMuted`.
- Pane content components render the **full** content: sources/files via the list renderers with `scrollOffset: 0, maxRows: Number.MAX_SAFE_INTEGER`; diff via `renderUnifiedDiff`/`renderSideBySide` with `verticalOffset: 0` and `height = row count` (placeholders render as one line). The ScrollView provides the window.
- Every `ScrollView` is created with `{ overscroll: "contain", scrollbar: "auto" }`.
- Reducer → view: after every `dispatch` (and after refresh/load), call `setDesiredScrollTop` on each pane with `sourceScrollOffset`, `fileScrollOffset`, and the selected file's vertical offset (0 when none). Layout height for fullscreen uses `fullscreenHeight(host.rows())`.
- View → reducer: `onUserScroll(top)` dispatches `{type:"set-scroll", pane, offset: top}`; the reducer stores it (files/sources: the list offset; diff: `verticalOffsetByFile` for the selected file), clamps to `>= 0`, bumps `version`, clears `notice`, and emits no effects. This dispatch path must **not** call `host.requestRender()` (the TUI already re-renders after wheel) and must not re-enter `setDesiredScrollTop` with a different value (no feedback loop).
- `rebuildFullscreenTree` is invoked from the pane content renders when `(width, rows, mode, focusedPane)` differ from the last build; from `invalidate()`; and from `dispatch` when focus or mode changed. Rebuilding reuses the same three `SyncedScrollView` instances (their `scrollTop` survives).
- `invalidate()` also invalidates all pane contents and the ScrollViews' children.
- README: document that wheel scrolling works only with `tuiMode: "fullscreen"` (`/settings` or `pi --tui-mode fullscreen`), that clicks are still not supported, and that regular mode is keyboard-only.

## Tests
`test/unit/fullscreen-layout.test.ts` (build a view as in spec 13's tests; call `Object.getOwnPropertySymbols` on `VStack.prototype` to obtain the layout-node symbol, or simply assert `view instanceof VStack`)
- "view is a VStack with a layout node"
- "fullscreen entries in wide mode are header, border, body, border, footer with body basis equal to bodyHeight"
- "wide body is an HStack of left column, divider and diff scroll view"
- "narrow body contains only the focused pane"
- "pane contents render full unwindowed content" (diff content line count equals `buildUnifiedRows(...).length`; file content contains every file)
- "wheel scrollBy on the diff pane dispatches set-scroll and updates the selected file's vertical offset" (call `panes.diff.updateLayout(200, 20, noop)` first so scrollBy has range)
- "keyboard scroll sets the desired scroll top which updateLayout applies" (dispatch `page` then `updateLayout`; `scrollTop` equals reducer offset)
- "set-scroll does not trigger requestRender" (host spy)
- "no feedback loop between wheel and reducer" (scrollBy → offset X; subsequent updateLayout leaves scrollTop at X and version unchanged)
- "divider styling follows focus" (styler spy: borderAccent when diff focused)
- "rebuilding the tree keeps scroll view instances and scrollTop"
- "regular-mode render output is unchanged by the fullscreen tree" (snapshot equality before/after `rebuildFullscreenTree`)

## Out of scope
- Click selection, drag, scrollbar interaction, hover.
- Changing regular-mode rendering or any renderer signatures.

## Done when
`pnpm check` exits 0 with 12 new tests passing and all 174 existing tests still passing.

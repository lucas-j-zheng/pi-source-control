# 19 — Diff line cursor

## Goal
Give the diff pane a selected *line*, not just a scroll offset, rendered with a visible marker. Inline comments (spec 20) need a stable anchor, and line-precise navigation is useful on its own.

## Depends on
- 10-unified-renderer (`buildUnifiedRows`, `renderUnifiedDiff`, `UnifiedRow`)
- 11-side-by-side-renderer (`buildSideBySideRows`)
- 12-review-state-and-input (`reduce`, `ReviewSessionState`, `ReviewEnv`)

## Files
- modify `src/model/review-state.ts`
- modify `src/ui/unified-renderer.ts`
- modify `src/ui/side-by-side-renderer.ts`
- modify `src/ui/source-control-view.ts`
- modify `test/unit/review-state.test.ts`, `test/unit/unified-renderer.test.ts`

## Interfaces
```ts
// review-state.ts
export interface LineAnchor { hunkIndex: number; lineIndex: number; } // lineIndex is into DiffHunk.lines
// ReviewSessionState gains:
//   cursorByFile: Map<string, LineAnchor>;
// ReviewEnv gains:
//   lineAnchors(file: ChangedFile): LineAnchor[];        // every selectable line, in row order
//   rowForAnchor(file: ChangedFile, anchor: LineAnchor, mode: "unified" | "side-by-side"): number;
export function anchorEquals(a: LineAnchor | undefined, b: LineAnchor | undefined): boolean;

// unified-renderer.ts — UnifiedRow gains:
//   anchor?: LineAnchor;   // undefined for the column header, hunk headers and no-newline rows
export function buildUnifiedRows(
  file: ChangedFile, styler: Styler, codeWidth: number, horizontalOffset: number,
  cursor?: LineAnchor,
): UnifiedRow[];
// renderUnifiedDiff's input gains `cursor?: LineAnchor`
// side-by-side-renderer.ts: SbsRow gains the same optional `anchor`; buildSideBySideRows/renderSideBySide gain the same `cursor` parameter
```

## Behavior
- The cursor is stored per file as a `LineAnchor`, so it survives switching between unified and side-by-side. Selecting a file with no stored cursor defaults to the first anchorable line of hunk 0 (files with no hunks have no cursor).
- Anchorable lines are every `DiffLine` of kind `context`, `addition` or `deletion`. Hunk headers, the column header and no-newline marker rows are not anchorable.
- With the diff pane focused, `move`/`page`/`half-page`/`home`/`end` move the **cursor** by that many anchorable lines (clamped to the file's first/last), and the vertical offset then follows so the cursor row stays inside `layout.bodyHeight` — exactly the behavior the source and file lists already have. **This replaces the old "scroll by delta" semantics for the diff pane; update the existing diff-scroll tests rather than deleting them.**
- `next-hunk`/`prev-hunk` move the cursor to the first anchorable line of the target hunk (and keep setting `selectedHunkByFile`).
- Wheel scrolling (`set-scroll`) moves the viewport only and leaves the cursor alone; if the cursor scrolls out of view it stays where it is.
- The cursor row renders with `bg("selectedBg")` applied to the whole line, layered over the existing addition/deletion styling; when the diff pane is not focused it renders `bold` instead. Width safety is unchanged — styling is applied after slicing.
- `rowForAnchor` returns the row index in the given mode's row model, or `-1` when the anchor is not present.

## Tests
`test/unit/review-state.test.ts`
- "selecting a file places the cursor on its first changed line"
- "moving in the diff pane moves the cursor one line at a time and clamps at both ends"
- "the viewport follows the cursor when it would leave the body height"
- "page and half-page move the cursor by a viewport and clamp"
- "next and previous hunk move the cursor to the first line of that hunk"
- "wheel scrolling moves the viewport without moving the cursor"
- "the cursor survives toggling to side-by-side and back"
`test/unit/unified-renderer.test.ts`
- "the cursor row is highlighted and no other row is"
- "rows carry anchors for content lines only" (header and hunk-header rows have no anchor)
- "cursor rendering is width-safe at every test width"

## Out of scope
- Comments (spec 20). Horizontal cursor movement. Selecting a *range* of lines.

## Done when
`pnpm check` exits 0 with 10 new tests passing and every existing test either passing unchanged or updated only where the diff-pane movement semantics changed.

# 10 — Unified diff renderer and line slicing

## Goal
Render a `ChangedFile` as the default full-width `-`/`+` stream with old/new gutters, honoring vertical and horizontal offsets. This is the primary reading surface, so width safety and exact numbering matter most.

## Depends on
- 08-theme-and-layout (`Styler`, `plainStyler`, `UNIFIED_GUTTER_WIDTH`)
- uses `visibleWidth`, `truncateToWidth`, `sliceByColumn` from `@earendil-works/pi-tui`

## Files
- create `src/diff/line-slicing.ts`
- create `src/ui/unified-renderer.ts`
- create `test/unit/unified-renderer.test.ts`

## Interfaces
```ts
// line-slicing.ts
export function expandTabs(text: string, tabWidth?: number): string; // default 4
export function sliceColumns(text: string, start: number, width: number): string; // plain-text (no ANSI) column slice, padded right to width
export function padToWidth(line: string, width: number): string; // ANSI-aware: pad or truncateToWidth

// unified-renderer.ts
export interface UnifiedRow { text: string; hunkIndex: number; isHunkHeader: boolean; }
export function buildUnifiedRows(file: ChangedFile, styler: Styler, codeWidth: number, horizontalOffset: number): UnifiedRow[]; // all rows, unscrolled
export interface UnifiedViewInput { file?: ChangedFile; verticalOffset: number; horizontalOffset: number; height: number; placeholder?: string; }
export function renderUnifiedDiff(input: UnifiedViewInput, width: number, styler: Styler): string[]; // exactly `height` lines
export function hunkStartRows(file: ChangedFile): number[]; // row index of each hunk header in buildUnifiedRows output
export function placeholderFor(file: ChangedFile | undefined): string | undefined;
```

## Behavior
- Row layout: `<old:4> <new:4> <m> <code>` where numbers are right-aligned, blank when undefined, `m` is `-`, `+`, or space; code gets `width - UNIFIED_GUTTER_WIDTH` columns.
- First row is a column header ` OLD  NEW` styled `dim`; then per hunk a header row (the `@@` line, styled `accent`), then its lines. A line with `noNewlineAtEnd` is followed by a row `\ No newline at end of file` styled `muted` (hunkIndex same, isHunkHeader false).
- Addition rows: `fg("toolDiffAdded")` applied to marker and code; deletions `toolDiffRemoved`; context `toolDiffContext`. Styling applied *after* slicing so ANSI never gets cut.
- Tabs expanded before slicing; `horizontalOffset` slices columns of code; content shorter than offset renders blank.
- `renderUnifiedDiff`: if `placeholder` or `placeholderFor(file)` is defined, output the placeholder text centered-ish (left-aligned, on row 1) and pad the rest; else take rows `[verticalOffset, verticalOffset+height)` and pad with empty width-safe lines. `verticalOffset` beyond range clamps to last page.
- `placeholderFor`: undefined file → `No file selected.`; `isBinary` → `Binary file changed. Text diff is unavailable.`; `isOversized` → `Diff omitted because this file exceeds the configured review size limit.`; unmerged with no hunks → `Unmerged file. Resolve the conflict to view a diff.`; no hunks otherwise → `No textual changes.`; else undefined.
- `hunkStartRows` returns the indices in `buildUnifiedRows` order (row 0 is the column header, so first hunk header is row 1).
- Every output line `visibleWidth === width`.

## Tests
`test/unit/unified-renderer.test.ts` (parse `test/fixtures/modified.diff` and `multi.diff` with `parseUnifiedDiff`; use `plainStyler`)
- "renders old and new gutters with markers" (assert a context row, a `-` row, a `+` row with exact numbers)
- "hunk headers are distinct rows and hunkStartRows points at them"
- "vertical offset windows rows and clamps past the end"
- "horizontal offset slices code columns"
- "tabs are expanded to four columns"
- "no-newline marker row follows the affected line"
- "placeholders for binary, oversized, unmerged, empty and no file"
- "output has exactly height lines at every width" (widths 50..220, heights 8,10,16,24,40,60; `visibleWidth === width`)
- "sliceColumns pads and clips" ; "padToWidth pads and truncates ANSI strings"

## Out of scope
- Side-by-side (11). Key handling.

## Done when
`pnpm check` exits 0 with 10 new tests passing.

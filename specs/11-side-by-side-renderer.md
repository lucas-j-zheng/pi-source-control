# 11 — Side-by-side renderer

## Goal
Render `SideBySideRow[]` as two columns with their own gutters. It is opt-in via `v` and must degrade cleanly with a width notice when it cannot fit.

## Depends on
- 07-side-by-side-aligner (`alignFile`)
- 08-theme-and-layout (`Styler`, `SBS_GUTTER_WIDTH`, `MIN_SBS_CODE_WIDTH`)
- 10-unified-renderer (`sliceColumns`, `padToWidth`, `expandTabs`, `placeholderFor`)

## Files
- create `src/ui/side-by-side-renderer.ts`
- create `test/unit/side-by-side-renderer.test.ts`

## Interfaces
```ts
export interface SbsRow { text: string; hunkIndex: number; isHunkHeader: boolean; }
export function sideBySideFits(width: number): boolean; // floor((width-1)/2) - SBS_GUTTER_WIDTH >= MIN_SBS_CODE_WIDTH
export function buildSideBySideRows(file: ChangedFile, styler: Styler, width: number, horizontalOffset: number): SbsRow[];
export interface SbsViewInput { file?: ChangedFile; verticalOffset: number; horizontalOffset: number; height: number; }
export function renderSideBySide(input: SbsViewInput, width: number, styler: Styler): string[]; // exactly height lines
export function sbsHunkStartRows(file: ChangedFile): number[];
export const SBS_WIDTH_NOTICE = "Side-by-side requires a wider terminal";
```

## Behavior
- Column widths: `leftCol = floor((width-1)/2)`, `rightCol = width - leftCol - 1`, divider `│` styled `borderMuted`.
- Row 0 is a header `ORIGINAL` / `MODIFIED` (dim). Hunk header rows show the `@@` line in the left column and again in the right (accent).
- Each cell: `<num:4> <m> <code>`; empty cells render blank code and a blank marker; deletion cells `toolDiffRemoved`, addition `toolDiffAdded`, context `toolDiffContext`.
- `horizontalOffset` applies to both code columns equally; tabs expanded.
- `renderSideBySide` uses `placeholderFor` like the unified renderer; if `!sideBySideFits(width)` the first line is `SBS_WIDTH_NOTICE` (warning) and remaining lines blank.
- Every line `visibleWidth === width`.

## Tests
`test/unit/side-by-side-renderer.test.ts`
- "pairs a replacement block across columns" (from a hand-built ChangedFile with 2 deletions/3 additions: row with empty left)
- "context rows show the same content on both sides with both numbers"
- "hunk headers appear in both columns and sbsHunkStartRows matches"
- "horizontal offset slices both sides"
- "width notice when side-by-side does not fit" (width 60)
- "placeholders reuse unified placeholder text"
- "output has exactly height lines and is width-safe" (widths 90..220, heights 8..60)

## Out of scope
- Toggle logic, state.

## Done when
`pnpm check` exits 0 with 7 new tests passing.

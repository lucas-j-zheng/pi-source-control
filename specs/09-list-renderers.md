# 09 — Source list, file list, header and footer renderers

## Goal
Render the left-pane lists and the top/bottom chrome as width-safe `string[]`. These are pure functions of model + selection + width so they can be tested at every width.

## Depends on
- 08-theme-and-layout (`Styler`, `plainStyler`)
- uses `visibleWidth`, `truncateToWidth` from `@earendil-works/pi-tui`

## Files
- create `src/ui/source-list-renderer.ts`
- create `src/ui/file-list-renderer.ts`
- create `src/ui/review-header-renderer.ts`
- create `src/ui/footer-renderer.ts`
- create `test/unit/list-renderers.test.ts`

## Interfaces
```ts
// source-list-renderer.ts
export interface SourceRowInput { items: SourceListItem[]; counts: Record<string, number | undefined>; selectedId: string; focused: boolean; scrollOffset: number; maxRows: number; }
export interface RenderedRows { lines: string[]; rowIds: (string | undefined)[]; } // rowIds[i] is the source/file id on line i, undefined for headings
export function renderSourceList(input: SourceRowInput, width: number, styler: Styler): RenderedRows;
export function statusLetter(status: FileStatus): string; // M A D R C U ! T  (untracked → "U")

// file-list-renderer.ts
export interface FileRowInput { files: ChangedFile[]; selectedId?: string; reviewed: Set<string>; focused: boolean; scrollOffset: number; maxRows: number; title: string; }
export function renderFileList(input: FileRowInput, width: number, styler: Styler): RenderedRows;

// review-header-renderer.ts
export function renderHeader(review: DiffReview, selectedFile: ChangedFile | undefined, viewMode: "unified"|"side-by-side", width: number, styler: Styler): string[]; // exactly 1 line

// footer-renderer.ts
export interface FooterInput { reviewedCount: number; totalCount: number; focusedPane: "sources"|"files"|"diff"; compact: boolean; helpVisible: boolean; notice?: string; }
export function renderFooter(input: FooterInput, width: number, styler: Styler): string[]; // 1 line, or help lines when helpVisible
```

## Behavior
- All outputs: every line has `visibleWidth(line) <= width`, padded with spaces to exactly `width` (so backgrounds fill).
- `renderSourceList` layout: heading `WORKSPACE`, then working/staged rows, blank, heading `RECENT COMMITS`, then commit rows. Row format: `<sel> <letter> <label>` where `sel` is `>` for selected else space; letter `W`/`S` for workspace, `●` for commits followed by `shortOid subject`; count right-aligned at the end when `counts[id]` is defined (e.g. `(4)`). Selected row styled `bg("selectedBg")` when focused, `bold` when unfocused. Subjects are truncated with `truncateToWidth` and never wrap. `scrollOffset`/`maxRows` window the *rows* (headings included) — output has at most `maxRows` lines; `rowIds` aligned to `lines`.
- `renderFileList`: first line title `FILES CHANGED (N)` (or `input.title` if given, with count appended); rows `<sel> <✓|space> <letter> <name>  <dir>  +a −d`; priority when narrow (per plan §13): drop counts first, then directory, then truncate name. Reviewed marker `✓` when `reviewed.has(file.id)`. Empty list → title plus one muted line `No changes`. Windowing as above.
- `statusLetter`: modified M, added A, deleted D, renamed R, copied C, untracked U, unmerged !, type-changed T.
- `renderHeader`: workspace → `SOURCE CONTROL · <file path> · UNIFIED -/+` (or `SIDE-BY-SIDE`); commit → `COMMIT <short> · <subject> · <file> · <mode>` plus, when `parentCount > 1`, ` · parent 1/<n>`; range → `RANGE <expression> · <base7> → <right7> · <merge-base|endpoint> comparison · <file> · <mode>`. Truncated to width; no file → omit the file segment.
- `renderFooter`: normal: `<reviewed>/<total> reviewed · Tab pane · ↑↓ select · n/p hunk · v side-by-side · Space reviewed · g refresh · ? help · q close`; compact: `? help · q close`; `notice` (if set) replaces the key hints, styled `warning`. `helpVisible` → returns the full keybinding table from plan §4 (one line per key, each width-safe) preceded by the progress line.

## Tests
`test/unit/list-renderers.test.ts` — use `plainStyler` and a fixture review with 2 workspace sources, 3 commits, 4 files.
- "source list marks the selected source and shows counts"
- "source list rowIds align with lines and headings are undefined"
- "source list windows rows by scrollOffset and maxRows"
- "file list shows reviewed marker and status letters"
- "file list drops counts then directory as width shrinks" (width 60 keeps name, drops dir)
- "empty file list shows No changes"
- "statusLetter maps every status"
- "header for workspace, commit with merge parents, and range"
- "footer normal, compact, notice and help variants"
- "every renderer is width-safe at all test widths" (widths 50,60,89,90,110,129,130,160,220; assert `visibleWidth(line) <= width` and `=== width` for list rows)

## Out of scope
- Diff body rendering (10, 11). Scrolling logic (12).

## Done when
`pnpm check` exits 0 with 10 new tests passing.

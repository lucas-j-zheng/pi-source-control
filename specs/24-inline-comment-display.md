# 24 — Comments render inline in the diff

## Goal
Show existing comments as rows in the diff, directly beneath the line they are attached to, the way a code-review UI does. Comments belong next to the code they are about, not hidden in a counter.

## Depends on
- 20-inline-review-comments (`ReviewComment`, `state.comments`)
- 19-diff-line-cursor (`LineAnchor`, `rowForAnchor`, `lineAnchors`)
- 10-unified-renderer / 11-side-by-side-renderer (row models)

## Files
- modify `src/ui/unified-renderer.ts`
- modify `src/ui/side-by-side-renderer.ts`
- modify `src/ui/source-control-view.ts`
- modify `test/unit/unified-renderer.test.ts`, `test/unit/review-state.test.ts`, `test/unit/render-width.test.ts`

## Interfaces
```ts
// unified-renderer.ts — UnifiedRow gains:
//   isComment?: boolean;
// buildUnifiedRows and renderUnifiedDiff gain a trailing parameter:
//   comments?: readonly ReviewComment[]   // only those whose fileId matches the rendered file
// side-by-side-renderer.ts: SbsRow gains `isComment?`; buildSideBySideRows/renderSideBySide take the same parameter
```

## Behavior
- For each comment, its rows are inserted **immediately after** the row of its anchored line, in `createdAt` order when several share a line.
- A comment renders as: a first row `<gutter blank>│ 💬 <first wrapped line>` and continuation rows `<gutter blank>│    <next wrapped line>`, where the body is hard-wrapped to the available code width (never overflowing, never wrapping mid-ANSI). The marker column and both line-number gutters stay blank so the code columns still line up.
- Comment rows use `fg("accent")` for the `💬` marker and `fg("muted")` for the body text, and are never given the cursor highlight.
- Comment rows are **not anchorable**: `lineAnchors` is unchanged, the cursor never lands on one, and `n`/`p`/`↓` skip over them.
- `rowForAnchor` must account for inserted comment rows so the cursor highlight, viewport clamping and scroll-into-view stay correct when comments exist above the cursor.
- An empty `comments` argument produces byte-identical output to today, so every existing renderer test still passes unchanged.
- The view passes only the selected file's comments, so a comment on another file never appears here.
- Row counts used for scroll clamping (`diffRowCount`) include comment rows.

## Tests
`test/unit/unified-renderer.test.ts`
- "a comment renders directly beneath its anchored line"
- "a long comment body wraps within the code width"
- "two comments on one line render in creation order"
- "comment rows are not anchorable and the cursor skips them"
- "rowForAnchor accounts for comment rows above the cursor"
- "no comments produces identical output to before"
- "comment rows are width-safe at every test width"
`test/unit/review-state.test.ts`
- "diff row count includes comment rows so scrolling clamps correctly"
`test/unit/render-width.test.ts`
- extend the existing width sweep to a fixture that has comments

## Out of scope
- Composing comments inline (spec 25). Editing or deleting from the row itself. Collapsing long comments.

## Done when
`pnpm check` exits 0 with 8 new tests passing and all existing tests passing unchanged.

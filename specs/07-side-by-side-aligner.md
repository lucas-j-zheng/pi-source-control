# 07 — Side-by-side aligner

## Goal
Convert parsed hunks into paired `SideBySideRow`s. This is the optional `v` view; it derives from the unified model and never re-parses.

## Depends on
- 02-unified-diff-parser (types only; tests build `DiffHunk` literals by hand)

## Files
- create `src/diff/side-by-side-aligner.ts`
- create `test/unit/side-by-side-aligner.test.ts`

## Interfaces
```ts
export function alignHunk(hunk: DiffHunk): SideBySideRow[];
export function alignFile(hunks: DiffHunk[]): SideBySideRow[]; // concatenation, each row's hunkIndex = hunk.index
```

## Behavior
- Each hunk starts with one row `{left:{kind:"metadata", content: hunk.header}, right:{kind:"metadata", content: hunk.header}, hunkIndex}`.
- Context line → `left` and `right` context cells with `lineNumber` = old/new numbers, same content.
- A contiguous run of deletions followed immediately by additions is a replacement block: pair by index; the shorter side gets `{kind:"empty", content:""}` cells (never `undefined`).
- Deletion-only run → left deletion cells, right empty cells; addition-only run → right addition cells, left empty cells.
- A run ends when a context line or the hunk ends. Deletions after additions (e.g. `+ - `) start a new block, not a re-pairing.
- `metadata` lines other than the header (none expected) are emitted on both sides as metadata.
- `noNewlineAtEnd` is ignored here (renderer concern).

## Tests
`test/unit/side-by-side-aligner.test.ts`
- "context only" → header row + N paired context rows
- "one deletion replaced by one addition" → one row with deletion left and addition right
- "two deletions replaced by three additions" → rows 2 and 3 pair, row 3 has empty left
- "three deletions replaced by one addition" → rows 2–3 have empty right
- "addition-only block" → left cells kind empty
- "deletion-only block" → right cells kind empty
- "adjacent hunks" (`alignFile` with two hunks) → two header rows, `hunkIndex` 0 then 1
- "deletions following additions start a new block"

## Out of scope
- Similarity matching, intraline highlighting, rendering.

## Done when
`pnpm check` exits 0 with 8 new tests passing.

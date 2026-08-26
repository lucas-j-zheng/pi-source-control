# 06 — Range review reader

## Goal
Build a `DiffReview` for `left..right` (endpoint-to-endpoint) and `left...right` (merge-base-to-right). Ranges are net tree comparisons, never concatenated commit patches.

## Depends on
- 02-unified-diff-parser (`parseUnifiedDiff`)
- 03-untracked-and-git-client (`GitRunner`, `runOrThrow`, `resolveRevision`, `GitReviewError`, `createTempRepo`)

## Files
- create `src/git/range-review-reader.ts`
- create `test/integration/range-review-reader.test.ts`

## Interfaces
```ts
export interface RangeRequestInput { left: string; right: string; mode: "two-dot" | "three-dot"; }
export async function findSingleMergeBase(runner: GitRunner, leftOid: string, rightOid: string): Promise<string>;
export async function readRangeReview(runner: GitRunner, repoRoot: string, input: RangeRequestInput, signal?: AbortSignal): Promise<DiffReview>;
```

## Behavior
- Resolve `left` and `right` with `resolveRevision` (both, before any diff). Two-dot: `effectiveBaseOid = leftOid`. Three-dot: `effectiveBaseOid = findSingleMergeBase(leftOid, rightOid)`.
- `findSingleMergeBase` runs `["merge-base","--all", leftOid, rightOid]`; exactly one line → that OID; zero lines/non-zero exit → `GitReviewError("bad-revision", "No merge base between <left7> and <right7>.")`; more than one → `GitReviewError("ambiguous-merge-base", "Multiple merge bases between <left7> and <right7>; three-dot ranges with criss-cross history are unsupported. Use a two-dot range.")`.
- Diff: `["diff","--no-ext-diff","--no-color","--find-renames","--unified=3", effectiveBaseOid, rightOid, "--"]`, parsed with `group:"range"`, one group `{id:"range", title:"Files changed"}` sorted by `newPath`.
- `scope = {kind:"range", requestedExpression: `${left}${mode==="two-dot"?"..":"..."}${right}`, mode, leftOid, rightOid, effectiveBaseOid}`; `metadata: RangeMetadata` with `expression` equal to `requestedExpression`.
- Identical endpoints → empty file list, no error.

## Tests
`test/integration/range-review-reader.test.ts` (build: main with commits A,B; feature branched at A with commit C; main gets B after the branch)
- "two-dot range with divergent endpoints shows the net endpoint-to-endpoint diff" (main..feature: B's change appears as reverted, C's as added)
- "three-dot range whose merge base differs from the left endpoint diffs from the merge base" (main...feature shows only C's change; `effectiveBaseOid` = A's oid)
- "criss-cross history with multiple best merge bases produces ambiguous-merge-base error"
- "identical endpoints yield an empty review"
- "invalid endpoint throws bad-revision before any diff runs" (spy runner)
- "requestedExpression preserves the user expression"
- "reader leaves repository unchanged"

## Out of scope
- Any UI, header rendering (spec 10).

## Done when
`pnpm check` exits 0 with 7 new tests passing.

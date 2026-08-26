# 05 — Commit history and single-commit readers

## Goal
Load the recent-commit source list and, lazily, a single commit's `DiffReview` against parent 1 (or an empty tree for root commits). This powers both the source list in bare `/diff` and `/diff commit <rev>`.

## Depends on
- 02-unified-diff-parser (`parseUnifiedDiff`)
- 03-untracked-and-git-client (`GitRunner`, `runOrThrow`, `resolveRevision`, `GitReviewError`, `createTempRepo`)

## Files
- create `src/git/commit-history-reader.ts`
- create `src/git/commit-review-reader.ts`
- create `test/integration/commit-history-reader.test.ts`, `test/integration/commit-review-reader.test.ts`

## Interfaces
```ts
// commit-history-reader.ts
export const DEFAULT_HISTORY_COUNT = 20;
export const LOG_FORMAT: string; // "%H%x00%h%x00%P%x00%an%x00%aI%x00%s%x00" (records end with NUL)
export function parseLogOutput(raw: string): Extract<SourceListItem, {kind:"commit"}>[];
export async function readRecentCommits(runner: GitRunner, count?: number, signal?: AbortSignal): Promise<Extract<SourceListItem, {kind:"commit"}>[]>;

// commit-review-reader.ts
export async function readCommitMetadata(runner: GitRunner, commitOid: string): Promise<CommitMetadata>;
export async function readCommitReview(runner: GitRunner, repoRoot: string, revision: string, signal?: AbortSignal): Promise<DiffReview>;
export function commitSourceId(oid: string): string; // `commit:${oid}`
```

## Behavior
- `readRecentCommits` runs `["log", `--max-count=${count}`, `--format=${LOG_FORMAT}`, "HEAD", "--"]`; an empty repository (no HEAD; git exits non-zero mentioning `unknown revision` or `does not have any commits`) → `[]`, not an error.
- `parseLogOutput` splits records on NUL in groups of 6; `parentOids` = space-split `%P` (empty → `[]`); `id = commitSourceId(oid)`; `author` = `%an`, `authoredAt` = `%aI`.
- `readCommitMetadata` runs `["show","-s",`--format=${LOG_FORMAT}`, oid, "--"]` and maps to `CommitMetadata` (`authorName`).
- `readCommitReview`: `commitOid = resolveRevision(runner, revision)`; parents from metadata. One or more parents → `["diff","--no-ext-diff","--no-color","--find-renames","--unified=3", parentOids[0], commitOid, "--"]`; zero parents → `["diff-tree","--root","--no-commit-id","-r","-p","--no-ext-diff","--no-color","--find-renames", commitOid, "--"]`.
- `scope = {kind:"commit", requestedRevision: revision, commitOid, parentOid: parents[0], parentIndex: parents.length ? 0 : undefined, parentCount: parents.length}`; `metadata` is the `CommitMetadata`; one group `{id:"commit", title:"Files changed", files}` parsed with `group: "commit"`, sorted by `newPath`.
- Only the resolved OID is ever passed to diff/diff-tree/show; the original `revision` text is only used in `resolveRevision` and `scope.requestedRevision`.
- Bad revision → `GitReviewError("bad-revision")` from `resolveRevision` propagates before any diff command runs.

## Tests
`test/integration/commit-history-reader.test.ts`
- "empty repository yields no commits"
- "returns commits newest first with full and short oid, subject, author and parents" (3 commits; `parentOids` of the oldest is `[]`)
- "count limits the number of commits"
- "parseLogOutput handles subjects containing spaces and pipes"
`test/integration/commit-review-reader.test.ts`
- "normal commit against its parent shows only that commit's files"
- "root commit against an empty tree renders as added files" (parentCount 0, every file status added)
- "merge commit is compared against parent 1 with explicit parent metadata" (parentCount 2, parentIndex 0)
- "tag and short-hash resolution" (`v1` and 7-char hash give same `commitOid`)
- "invalid revision throws bad-revision before any diff runs" (spy runner: no `diff` args seen)
- "reader leaves repository unchanged"

## Out of scope
- Range diffs (spec 06). Caching across sessions. Parent selection.

## Done when
`pnpm check` exits 0 with 10 new tests passing.

# 04 — Workspace review reader

## Goal
Build a `DiffReview` for the workspace: a `staged` group (index vs HEAD) and a `working` group (working tree vs index plus untracked files). This is the data behind the default `/diff` screen.

## Depends on
- 02-unified-diff-parser (`parseUnifiedDiff`)
- 03-untracked-and-git-client (`GitRunner`, `runOrThrow`, `detectRepositoryRoot`, `parsePorcelainStatus`, `statusForIndex`, `statusForWorkTree`, `readUntrackedFile`, `createTempRepo`)

## Files
- create `src/git/workspace-review-reader.ts`
- create `test/integration/workspace-review-reader.test.ts`

## Interfaces
```ts
export interface WorkspaceReadOptions { signal?: AbortSignal; maxPatchBytes?: number; } // default 4 MiB per file
export const STAGED_DIFF_ARGS: readonly string[];  // ["diff","--cached","--no-ext-diff","--no-color","--find-renames","--unified=3","--"]
export const WORKING_DIFF_ARGS: readonly string[]; // same without --cached
export async function readWorkspaceReview(runner: GitRunner, repoRoot: string, options?: WorkspaceReadOptions): Promise<DiffReview>;
export function applyStatusToFiles(files: ChangedFile[], entries: StatusEntry[], column: "index" | "workTree"): ChangedFile[];
```

## Behavior
- Runs status (`["status","--porcelain=v1","-z","--untracked-files=all"]`), staged diff and working diff concurrently via `Promise.all`.
- `groups` = `[ {id:"working", title:"Working Tree", files}, {id:"staged", title:"Staged Changes", files} ]` in that order; a group with no files still exists.
- Staged files = `parseUnifiedDiff(stagedPatch, {group:"staged"})`; working files = `parseUnifiedDiff(workingPatch, {group:"working"})` followed by untracked entries (`??`) via `readUntrackedFile`, appended in status order.
- `applyStatusToFiles` overrides `status` using the porcelain column when defined (e.g. unmerged `UU` → `unmerged`, `T` → `type-changed`); files not in status keep the parser's status. Matching is by `newPath`.
- Unmerged files with no parseable hunks still appear (status `unmerged`, `hunks: []`).
- A file whose `rawPatch` length exceeds `maxPatchBytes` gets `isOversized: true`, `hunks: []`.
- Files in each group are sorted by `newPath` (locale-independent, `<` on strings).
- `scope: {kind:"workspace"}`, `metadata` undefined, `repositoryRoot` as given, `generatedAt: Date.now()`.
- Reader performs only read-only git commands and never changes repo state.

## Tests
`test/integration/workspace-review-reader.test.ts` — each test builds a temp repo, calls the reader, asserts, then asserts `snapshot()` unchanged.
- "clean repository yields two empty groups"
- "one unstaged modification appears only in working group"
- "one staged modification appears only in staged group"
- "same file staged and then modified again appears under both sources" (distinct ids `staged:a.ts` and `working:a.ts`, different fingerprints)
- "added tracked file is staged with status added"
- "untracked text file appears as untracked addition without touching the index" (git status still shows `??`)
- "deleted file has status deleted"
- "renamed file has status renamed with oldPath"
- "binary file is flagged binary and has no hunks"
- "large untracked file is flagged oversized"
- "files are sorted by path"
- "oversized patch is flagged" (maxPatchBytes: 10)
- "merge conflict file is reported as unmerged" (create a real conflict via two branches; skip with `it.skip` only if git cannot produce one)

## Out of scope
- Commit/range readers, UI, caching.

## Done when
`pnpm check` exits 0 with 13 new tests passing.

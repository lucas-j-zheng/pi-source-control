# 03 — Git runner, errors, status parser, revision resolver, untracked synthesis

## Goal
Provide the single typed, read-only git execution seam plus the pure parsers around it. Everything that talks to git later goes through `GitRunner`, so it must be mockable and injection-safe.

## Depends on
- 02-unified-diff-parser (`fingerprintPatch` from `src/diff/patch-fingerprint.ts`)

## Files
- create `src/git/git-client.ts`
- create `src/git/status-parser.ts`
- create `src/git/revision-resolver.ts`
- create `src/git/untracked-file.ts`
- create `test/helpers/temp-repo.ts`
- create `test/unit/status-parser.test.ts`, `test/unit/untracked-file.test.ts`, `test/integration/revision-resolver.test.ts`

## Interfaces
```ts
// git-client.ts
export type GitErrorCode = "not-a-repo" | "git-unavailable" | "bad-revision" | "ambiguous-merge-base" | "git-failed";
export class GitReviewError extends Error { constructor(public readonly code: GitErrorCode, message: string, public readonly stderr?: string); }
export interface GitResult { stdout: string; stderr: string; code: number; }
export interface GitRunner { run(args: string[], options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<GitResult>; }
export const GIT_TIMEOUT_MS = 10_000;
export const READ_ONLY_GIT_COMMANDS: ReadonlySet<string>; // rev-parse status diff diff-tree show rev-list merge-base log
export function createNodeGitRunner(cwd: string): GitRunner;  // node:child_process spawn, shell:false
export function assertReadOnly(args: string[]): void;          // throws GitReviewError("git-failed") if args[0] not in set
export async function detectRepositoryRoot(runner: GitRunner): Promise<string>; // git rev-parse --show-toplevel
export async function runOrThrow(runner: GitRunner, args: string[], code?: GitErrorCode): Promise<string>; // returns stdout

// status-parser.ts
export function parsePorcelainStatus(raw: string): StatusEntry[];
export function statusForIndex(entry: StatusEntry): FileStatus | undefined;    // X column
export function statusForWorkTree(entry: StatusEntry): FileStatus | undefined; // Y column

// revision-resolver.ts
export async function resolveRevision(runner: GitRunner, revision: string): Promise<string>; // full 40-hex OID

// untracked-file.ts
export const MAX_UNTRACKED_BYTES = 1_048_576;
export function isLikelyBinary(sample: Uint8Array): boolean;
export function synthesizeUntrackedFile(relPath: string, content: string, group: "working"): ChangedFile;
export async function readUntrackedFile(repoRoot: string, relPath: string): Promise<ChangedFile>; // uses node:fs

// test/helpers/temp-repo.ts
export interface TempRepo { root: string; runner: GitRunner; git(args: string[]): Promise<string>; write(rel: string, content: string): Promise<void>; snapshot(): Promise<string>; cleanup(): Promise<void>; }
export async function createTempRepo(): Promise<TempRepo>; // git init -b main, user.name/email set, no commits
```

## Behavior
- `createNodeGitRunner` spawns `git` with `shell: false`, `cwd`, env `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`; calls `assertReadOnly(args)` first; applies timeout (default `GIT_TIMEOUT_MS`) and abort. ENOENT → `GitReviewError("git-unavailable", "Git could not be executed.\n<stderr>")`.
- `detectRepositoryRoot`: non-zero exit → `GitReviewError("not-a-repo", "This directory is not inside a Git repository.\nRun Pi from a repository or initialize one with git init.")`; returns trimmed stdout.
- `runOrThrow`: non-zero exit → `GitReviewError(code ?? "git-failed", first stderr line, stderr)`.
- `parsePorcelainStatus`: input is NUL-separated records `XY <path>`; for `R`/`C` in X the *next* NUL field is the original path (order in `-z` output: new path then orig path). Trailing empty field ignored. Returns entries in output order.
- `statusForIndex`: X `M`→modified, `A`→added, `D`→deleted, `R`→renamed, `C`→copied, `T`→type-changed, `U`/`AA`/`DD`/`UU` (either column U, or both A, or both D) → unmerged; `?`, `!`, ` ` → undefined. `statusForWorkTree`: Y `M`→modified, `D`→deleted, `T`→type-changed, `?`(XY=`??`)→untracked, unmerged same rule; otherwise undefined. Unmerged returned by both functions.
- `resolveRevision`: `revision` must pass the same safety rule as spec 01 (`isSafeRevision` from `src/command/review-request-parser.ts`) else `bad-revision`; runs `["rev-parse","--verify","--quiet","--end-of-options", `${revision}^{commit}`]`; non-zero or stdout not matching `/^[0-9a-f]{40}$/` → `GitReviewError("bad-revision", "Could not resolve revision: <revision>\nUse /diff commit <revision> or /diff range <base>...<head>.")`.
- `isLikelyBinary`: true if any byte is 0 in the first 8000 bytes.
- `synthesizeUntrackedFile`: status untracked, group working, id `working:<relPath>`, one hunk `@@ -0,0 +1,N @@`, every line an addition numbered from 1, `noNewlineAtEnd` on last line if content lacks trailing `\n`, empty content → zero hunks; additions = N; `rawPatch` is a synthesized `diff --git a/<p> b/<p>` + `new file mode 100644` + `--- /dev/null` + `+++ b/<p>` + hunk text; fingerprint via `fingerprintPatch`.
- `readUntrackedFile`: `abs = path.resolve(repoRoot, relPath)`; if `fs.realpath(abs)` is not inside `fs.realpath(repoRoot)`, or `lstat` is not a regular file (symlink, dir, fifo) → placeholder `ChangedFile` (status untracked, `isBinary: true`, `hunks: []`, rawPatch `""`). Size > `MAX_UNTRACKED_BYTES` → `isOversized: true`, `hunks: []`. NUL in the first 8000 bytes → `isBinary: true`, `hunks: []`. Otherwise read as UTF-8 and `synthesizeUntrackedFile`.
- `createTempRepo`: temp dir via `fs.mkdtemp`; `snapshot()` returns `git status --porcelain -z` + `git rev-parse HEAD` (or `"no-head"`) joined, for unchanged-state assertions.

## Tests
`test/unit/status-parser.test.ts`
- "modified only in working tree" (` M a.ts`) → index undefined, workTree modified
- "modified only in index"; "modified in both index and working tree" (`MM`)
- "added"; "deleted"; "renamed" (`R  new\0old`) → origPath `old`, path `new`; "copied"; "untracked" (`??`) → workTree untracked; "unmerged" (`UU`, `AA`, `DD`) → both unmerged
- "spaces in filenames"; "unicode filenames"; "NUL-separated records" (three records, trailing NUL)
`test/unit/untracked-file.test.ts`
- "synthesizes an added file with new line numbers from 1"; "marks missing trailing newline"; "empty content yields no hunks"; "isLikelyBinary detects NUL"
`test/integration/revision-resolver.test.ts` (uses createTempRepo; one commit + tag `v1`)
- "resolves HEAD, short hash and tag to the same full oid"
- "missing revision produces bad-revision error"
- "a revision-like input beginning with - is rejected without running git" (runner spy: `run` never called)
- "detectRepositoryRoot throws not-a-repo outside a repository"
- "reader leaves repository unchanged" (snapshot before/after)
- "assertReadOnly rejects add/commit/reset"

## Out of scope
- Building `DiffReview`s (specs 04–06). Pi `exec` adapter (spec 15).

## Done when
`pnpm check` exits 0 with 24 new tests passing.

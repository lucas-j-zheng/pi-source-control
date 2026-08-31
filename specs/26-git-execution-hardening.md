# 26 — Git execution is hardened and never reports a killed command as success

## Goal
Make every git invocation report failure when it was killed, run in a pinned environment, and pin
the diff prefixes it parses. A timed-out `git diff` currently returns partial output as success, so
the reviewer presents a truncated or empty diff as the complete truth.

## Depends on
- 03-untracked-and-git-client (`GitRunner`, `GitReviewError`, `assertReadOnly`, `runOrThrow` from `src/git/git-client.ts`)
- 14-pi-extension-adapter (`createPiGitRunner`, `DiffCommandDeps` from `src/command/diff-command.ts`)

## Files
- modify `src/command/diff-command.ts`
- modify `src/git/git-client.ts`
- modify `src/git/workspace-review-reader.ts`, `src/git/commit-review-reader.ts`, `src/git/range-review-reader.ts`
- modify `test/unit/diff-command.test.ts`
- create `test/unit/git-execution.test.ts`

## Interfaces
```ts
// git-client.ts — exported so both runners share one definition
export const GIT_ENV: Readonly<Record<string, string>>;   // GIT_OPTIONAL_LOCKS=0, LC_ALL=C, GIT_PAGER=cat
export const GIT_SAFE_DIFF_FLAGS: readonly string[];      // --no-ext-diff, --no-textconv, --default-prefix

// diff-command.ts — ExecLike already reports `killed`; the runner must act on it
// createPiGitRunner passes env: GIT_ENV and rejects killed results.
```

## Behavior
- `createPiGitRunner` passes `env: GIT_ENV` to `exec` and, when the result has `killed === true`,
  throws a `GitReviewError` — **regardless of `code`**, because Pi resolves a SIGTERM'd child as
  `code ?? 0`. When `options.signal?.aborted` is true the error reports the abort; otherwise it
  reports a timeout naming the elapsed limit.
- The same rule applies in `createNodeGitRunner`: a killed child never resolves successfully.
- `GIT_ENV` is applied by both runners, so the environment the tests exercise is the environment
  production uses. `LC_ALL=C` makes the English-literal checks (binary-file detection, the
  empty-repository stderr match) locale-independent.
- Every `git diff` / `git diff-tree` argv in the three readers includes `GIT_SAFE_DIFF_FLAGS`.
  `--no-textconv` stops a repository-supplied `.gitattributes` + `diff.<driver>.textconv` from
  executing a command; `--default-prefix` pins `a/`+`b/` so a user's `diff.noprefix`,
  `diff.mnemonicPrefix` or custom `diff.srcPrefix`/`dstPrefix` cannot corrupt parsed paths.
- `GIT_SAFE_DIFF_FLAGS` is added only to patch-producing commands; `status`, `log`, `rev-parse`,
  `show`, `merge-base` are unchanged.
- No behavior change on the success path: identical stdout in, identical `DiffReview` out.

## Tests
`test/unit/git-execution.test.ts`
- "a killed result is an error even when the exit code is zero" — exec returns `{code:0, killed:true, stdout:"partial"}` → `runOrThrow` rejects with `GitReviewError`
- "an aborted command reports the abort rather than a timeout"
- "the runner pins GIT_OPTIONAL_LOCKS, LC_ALL and GIT_PAGER" — asserts the env passed to `exec`
- "patch commands carry --no-textconv and --default-prefix" — asserts the argv of the workspace, commit and range readers
- "status, log and rev-parse argv are unchanged"
`test/unit/diff-command.test.ts`
- update: the exec fake gains `killed` and one existing case asserts a killed status read surfaces through `notify`

## Out of scope
Streaming or capping git stdout (spec 29). Resolving `git` to an absolute path. Anything about
`core.fsmonitor`, which `--no-textconv` does not address and which no flag can fully mitigate.

## Done when
`pnpm check` exits 0 with 6 new tests passing and all 298 existing tests passing.

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

## Fixes

The spec above is implemented, but two of its guarantees do not hold in production. Address both.

### Fix 1 — the env pins are inert under the shipped Pi

The installed Pi's `ExecOptions` is `{ signal?, timeout?, cwd? }` and `execCommand` never forwards
`env` to `spawn`, so `env: GIT_ENV` from `createPiGitRunner` has no effect today. `git status` can
therefore still refresh and rewrite `.git/index`, which is the behavior finding 5 of
`reviews/full-review-2026-08-30.md` proved (`.git/index` sha changed `3b97159` → `7170ae2`).

- Keep `env: GIT_ENV` (harmless, and correct if Pi gains support), but do not rely on it.
- Add git's **global** `--no-optional-locks` flag ahead of the subcommand for every invocation, which
  is the argv-level equivalent of `GIT_OPTIONAL_LOCKS=0` and needs no env support.
- `assertReadOnly` currently validates `args[0]`. It must now skip a **fixed allowlist of global
  flags** (`--no-optional-locks`, `--no-pager` only — no `-c`, no `--exec-path`, nothing that takes a
  value) and validate the first non-flag token instead. This is the package's central safety
  guarantee: it must reject `["-c","core.fsmonitor=x","status"]`, `["--exec-path=/tmp","diff"]`, an
  argv of flags with no subcommand, and every previously rejected case.
- `LC_ALL=C` has no argv equivalent, so the two English-literal checks must stop depending on it:
  binary detection in `src/diff/unified-parser.ts` and the empty-repository stderr match in
  `src/git/commit-history-reader.ts`. Match on structure where possible (for the empty repo, prefer
  the `rev-parse --verify --quiet HEAD` exit status over stderr text) and keep the English match only
  as a fallback.

### Fix 2 — `--default-prefix` narrows the supported git range

`--default-prefix` requires git >= 2.41 (June 2023) and the package declares no git requirement.
Replace it in `GIT_SAFE_DIFF_FLAGS` with the long-standing `--src-prefix=a/ --dst-prefix=b/`, which
pins the same prefixes on every git that supports `--no-ext-diff`.

### Tests
`test/unit/git-execution.test.ts`
- "every git invocation carries --no-optional-locks"
- "assertReadOnly accepts a leading global flag and still validates the subcommand"
- "assertReadOnly rejects -c, --exec-path, a value-taking flag, and a flags-only argv"
- "patch commands pin the prefixes on older git" — argv asserts `--src-prefix=a/`, `--dst-prefix=b/`
`test/unit/commit-history-reader.test.ts` (create if absent)
- "an empty repository is detected without relying on English stderr"

### Done when
`pnpm check` exits 0 with 5 further tests passing, and an integration test asserts `.git/index` is
byte-identical before and after a `/diff` open on a repo with stale stat data.

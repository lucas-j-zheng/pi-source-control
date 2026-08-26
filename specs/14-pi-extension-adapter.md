# 14 — Pi extension adapter (`/diff`)

## Goal
Register `/diff` in Pi, guard non-TUI modes, wire the git readers to `pi.exec`, and host `SourceControlView` through `ctx.ui.custom()`. This is the only layer that knows about Pi.

## Depends on
- 01 (`parseReviewRequest`, `ReviewRequestError`), 03 (`GitRunner`, `GitReviewError`, `detectRepositoryRoot`, `assertReadOnly`), 04 (`readWorkspaceReview`), 05 (`readRecentCommits`, `readCommitReview`, `commitSourceId`), 06 (`readRangeReview`), 08 (`stylerFromTheme`), 13 (`SourceControlView`, `ViewDataSource`)

## Files
- modify `src/extension.ts` (currently empty)
- create `src/command/diff-command.ts`
- create `test/unit/diff-command.test.ts`

## Interfaces
```ts
// diff-command.ts
export interface ExecLike { (cmd: string, args: string[], opts?: { cwd?: string; signal?: AbortSignal; timeout?: number }): Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>; }
export function createPiGitRunner(exec: ExecLike, cwd: string): GitRunner;   // assertReadOnly + timeout GIT_TIMEOUT_MS + signal
export interface LoadedReview { review: DiffReview; recentCommits: SourceListItem[]; initialSourceId: string; }
export async function loadInitialReview(runner: GitRunner, request: ReviewRequest, signal?: AbortSignal): Promise<LoadedReview>;
export function createDataSource(runner: GitRunner, request: ReviewRequest, loaded: LoadedReview): ViewDataSource;
export function userMessageForError(err: unknown): string;   // ReviewRequestError/GitReviewError → message; other → "Unexpected error: <msg>"
export interface DiffCommandDeps { exec: ExecLike; cwd: string; mode: string; notify(msg: string, level: "info"|"warning"|"error"): void; openView(factory: (host: { requestRender(): void; rows(): number }, styler: Styler, done: () => void) => SourceControlView): Promise<void>; signal?: AbortSignal; }
export async function runDiffCommand(args: string, deps: DiffCommandDeps): Promise<void>;

// extension.ts
export default function register(pi: ExtensionAPI): void;
```

## Behavior
- `register` calls `pi.registerCommand("diff", { description: "Review workspace, commit, or revision-range changes (read-only)", handler })`; the handler builds `DiffCommandDeps` from `pi.exec`, `ctx.cwd`, `ctx.mode`, `ctx.ui.notify`, and `openView` implemented with `ctx.ui.custom<void>((tui, theme, _kb, done) => factory({ requestRender: () => tui.requestRender(), rows: () => tui.terminal.rows }, stylerFromTheme(theme), () => done(undefined)))`, passing `ctx.signal` when present.
- `runDiffCommand`: if `mode !== "tui"` → `notify("/diff requires interactive TUI mode", "error")` and return without running git. Then `parseReviewRequest(args)` (errors → `notify(message, "error")`), `detectRepositoryRoot`, `loadInitialReview`, then `openView`. Any `GitReviewError`/`ReviewRequestError` → `notify(userMessageForError(err), "error")`; nothing is thrown out of the handler.
- `loadInitialReview`: workspace → `Promise.all([readWorkspaceReview, readRecentCommits])`, `initialSourceId = request.initialSource`; commit → `readCommitReview`, `recentCommits: []`, `initialSourceId = commitSourceId(review.scope.commitOid)`; range → `readRangeReview`, `initialSourceId = "range"`.
- Workspace with no changes and no commits still opens the view (the view shows `No changes`); do not special-case a "clean repo" notify.
- `createDataSource`: `loadCommit` → `readCommitReview(runner, root, oid)`; `refresh` → re-runs `loadInitialReview` for the same request and returns `{review, recentCommits}`.
- `createPiGitRunner` maps `timeoutMs` → `timeout`, passes `cwd`, and calls `assertReadOnly` before exec.

## Tests
`test/unit/diff-command.test.ts` — fake `exec` that records calls and returns canned porcelain/diff/log output; fake `openView` capturing the factory.
- "refuses to run outside tui mode without executing git"
- "usage errors are reported via notify and git is not executed"
- "workspace request loads status, both patches and recent commits then opens the view"
- "commit request preselects the commit source"
- "range request preselects the range source"
- "git errors are surfaced through notify as the user-facing message"
- "pi runner refuses mutating git commands"
- "all git invocations use argument arrays and read-only subcommands" (assert every recorded call's `args[0]` is in `READ_ONLY_GIT_COMMANDS` and no arg starts with `-` after `--end-of-options` except the `^{commit}` suffix form)
- "register registers a diff command with a description" (fake `pi` with `registerCommand` spy)

## Out of scope
- Real Pi process tests; manual terminal matrix (documented in 15).

## Done when
`pnpm check` exits 0 with 9 new tests passing.

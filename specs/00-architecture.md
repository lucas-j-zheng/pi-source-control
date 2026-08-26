# 00 — Architecture: `pi-source-control`

A read-only, keyboard-driven Source Control diff reviewer that runs inside the Pi
coding agent as a `/diff` command. Product/handoff document: `docs/plan.md`
(this file is the binding technical summary; if they conflict, this file wins).

## Stack

- TypeScript 5, strict, ESM. Node 22. Package manager: **pnpm** (never npm/npx).
- Sibling imports use explicit `.ts` extensions: `import { x } from "./foo.ts"`
  (Pi loads extensions with jiti; tsconfig has `allowImportingTsExtensions`).
- Tests: **vitest**. Unit tests are pure (no git, no fs). Integration tests create
  temporary git repos under `os.tmpdir()` and run real `git`.
- Host APIs (types only at dev time, provided by Pi at runtime, declared as
  `peerDependencies: "*"`):
  - `@earendil-works/pi-coding-agent`: `ExtensionAPI`, `ExtensionCommandContext`,
    `pi.registerCommand(name, {description, handler(args, ctx)})`,
    `pi.exec(cmd, args, {cwd?, signal?, timeout?}) → {stdout, stderr, code, killed}`,
    `ctx.mode` (`"tui" | "rpc" | "json" | "print"`), `ctx.cwd`,
    `ctx.ui.notify(msg, "info"|"warning"|"error")`,
    `ctx.ui.custom<T>((tui, theme, keybindings, done) => Component)`.
  - `@earendil-works/pi-tui`: `Component { render(width): string[]; handleInput?(data): void; invalidate(): void }`,
    `visibleWidth`, `truncateToWidth`, `sliceByColumn`, `matchesKey(data, keyId)`
    (key ids: `"up" "down" "left" "right" "tab" "shift+tab" "enter" "escape" "space" "pageUp" "pageDown" "home" "end"`),
    `tui.requestRender()`, `tui.terminal.rows` / `tui.terminal.columns`.
  - Theme: `theme.fg(role, text)`, `theme.bg(bgRole, text)`, `theme.bold(text)`.
    fg roles used: `accent borderAccent borderMuted muted dim text warning error success toolDiffAdded toolDiffRemoved toolDiffContext`. bg role: `selectedBg`.
- **Phase 0 result (locked): Pi has no mouse/pointer contract.** Mouse support is
  out of scope. `HitTarget`s are still computed from layout as a pure, tested model
  but nothing dispatches them.

## Commands

```
pnpm install            # deps
pnpm test               # vitest --run   (the test command; must pass)
pnpm typecheck          # tsc --noEmit   (must also pass)
pnpm check              # both, in that order
```

Every spec's "Done when" is: `pnpm check` exits 0.

## Directory layout

```
src/
  extension.ts                 default export register(pi) — Pi adapter entry
  command/
    review-request-parser.ts   "/diff ..." args → ReviewRequest | ReviewRequestError
    diff-command.ts            handler wiring: parse → read → open view; error states
  git/
    git-client.ts              GitRunner interface + node (child_process) + pi.exec impls
    status-parser.ts           porcelain v1 -z → StatusEntry[]
    revision-resolver.ts       commit-ish → full OID via rev-parse --verify --end-of-options
    untracked-file.ts          read untracked text file → synthesized ChangedFile
    workspace-review-reader.ts status + staged/working patches → DiffReview(workspace)
    commit-history-reader.ts   recent commits → SourceListItem[] (commit kind)
    commit-review-reader.ts    commit vs parent1 / root → DiffReview(commit)
    range-review-reader.ts     two-dot / three-dot → DiffReview(range)
  diff/
    unified-parser.ts          raw patch → ChangedFile[] (hunks, lines, numbers)
    patch-fingerprint.ts       stable hash of raw patch
    side-by-side-aligner.ts    DiffHunk[] → SideBySideRow[]
    line-slicing.ts            ANSI-safe horizontal slice/pad helpers
  model/
    diff.ts                    all data types (see below) — scaffolded, do not redefine
    review-state.ts            ReviewSessionState, UiAction, reducer
  ui/
    theme.ts                   Styler interface (fg/bg/bold) + plain no-color styler for tests
    layout.ts                  (width,height) → Layout (mode, pane widths, row budgets)
    source-list-renderer.ts
    file-list-renderer.ts
    review-header-renderer.ts
    footer-renderer.ts
    unified-renderer.ts
    side-by-side-renderer.ts
    hit-target-registry.ts
    input-controller.ts        key data → UiAction
    source-control-view.ts     root Component: composes everything, caches, invalidates
test/
  fixtures/*.diff              raw git patches
  unit/*.test.ts               pure tests
  integration/*.test.ts        temp-repo tests (real git)
  helpers/temp-repo.ts         createTempRepo(): { root, git(args), write(path, content), cleanup }
```

## Module boundaries (hard rules)

1. `diff/*` and `model/*` import nothing from `git/*`, `ui/*`, or Pi packages.
2. `git/*` imports only `model/*`, `diff/*`, `node:*`. It never imports `ui/*` or Pi.
   All git execution goes through the `GitRunner` interface; readers take a runner
   as a constructor/function argument so tests can inject a real one over a temp repo.
3. `ui/*` imports `model/*` and `diff/*`, plus `visibleWidth/truncateToWidth/sliceByColumn`
   from `@earendil-works/pi-tui` (pure functions, safe in vitest). Renderers take a
   `Styler` (from `ui/theme.ts`), never the Pi `Theme` directly. Renderers return
   `string[]` and **every line satisfies `visibleWidth(line) <= width`**.
4. Only `extension.ts` and `command/diff-command.ts` import `@earendil-works/pi-coding-agent`.
5. Git is **read-only**: only `rev-parse status diff diff-tree show rev-list merge-base log`.
   Always argument arrays, never shell strings. User revision text is only ever passed
   after `--end-of-options` to `rev-parse --verify`, and only the resolved full OID is
   used afterwards. Any user token starting with `-` that reaches a git command is a bug.

## Data model (`src/model/diff.ts`, scaffolded)

Exactly the types from `docs/plan.md` §8: `SourceListItem`, `DiffGroupId`, `ReviewScope`,
`FileStatus`, `DiffReview`, `DiffGroup`, `CommitMetadata`, `RangeMetadata`, `ChangedFile`,
`DiffHunk`, `DiffLineKind`, `DiffLine`, `SideBySideRow`, `DiffCell`, `HitTarget`, plus
`ReviewRequest` (§9) and `StatusEntry`. Read the file; do not redeclare these types elsewhere.

Conventions:
- `ChangedFile.id` = `${group}:${newPath}` (rename: newPath). Unique within a review.
- `displayName` = basename of `newPath`; `displayDirectory` = dirname or `""` for root.
- Source ids: `"working"`, `"staged"`, `"commit:<fullOid>"`, `"range"`.
- Errors thrown by git/ readers are `GitReviewError` (`src/git/git-client.ts`) with
  `code: "not-a-repo" | "git-unavailable" | "bad-revision" | "ambiguous-merge-base" | "git-failed"`
  and a user-facing `message` matching the texts in `docs/plan.md` §4 "Empty and error states".

## Layout constants

- Wide `>= 130` cols, medium `90–129`, narrow `< 90` (one pane at a time).
- Left pane width: `clamp(round(width*0.30), 28, 34)` and at most 35% of width.
- Minimum body height 6 rows; chrome = 1 title row + 1 footer row + borders as rendered.
- Side-by-side allowed only when each code column ≥ 30 cols after gutters.
- Untracked/oversize limit: 1 MiB. Recent-commit count default: 20. Git timeout: 10 s.

## Testing conventions

- Width-safety: for every rendered line, `expect(visibleWidth(line)).toBeLessThanOrEqual(width)`.
  Widths tested at least: 50, 60, 89, 90, 110, 129, 130, 160, 220; heights: 8, 10, 16, 24, 40, 60.
- Integration tests must, after exercising a reader, assert `git status --porcelain` and
  `git rev-parse HEAD` are unchanged.
- Test names must match the spec's Tests bullets verbatim.

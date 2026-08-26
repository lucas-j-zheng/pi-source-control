# Pi Terminal Source Control Diff Viewer — Implementation Plan

## 1. Purpose

Build a Pi extension that recreates the most useful part of VS Code's Source Control experience entirely inside the terminal:

- A left pane containing all changed files.
- Separate **Working Tree** and **Staged Changes** sources for uncommitted work.
- A selectable source list containing **Working Tree**, **Staged Changes**, and recent commits.
- Read-only views for a single commit and for two-dot or three-dot revision ranges.
- A right pane showing the selected file's diff.
- Unified `-` / `+` diff as the default at every terminal width.
- Immediate preview changes when the selected file changes.
- Fast keyboard navigation for files, hunks, and scrolling.
- A read-only first release so reviewing code is safe.

The working package name in this plan is **`pi-source-control`**. It can be renamed later.

---

## 2. Product Definition

### Core user story

After Pi changes code, the user runs:

```text
/diff
```

Pi temporarily opens a Source Control review interface:

```text
┌─ SOURCE CONTROL ───────────────┬─ 8f3c2a1 · src/api/session.ts · UNIFIED ──────┐
│ WORKSPACE                      │ @@ -24,4 +24,8 @@                              │
│   W Working Tree (4)           │  24  24   export async function createSession │
│   S Staged Changes (1)         │  25  25     const token = await issueToken()  │
│                                │  26  26                                      │
│ RECENT COMMITS                 │ -27         return token;                     │
│ > 8f3c2a1 Add token validation │ +    27     if (!token) {                     │
│   2ab91c0 Refactor sessions    │ +    28       throw new SessionError();       │
│                                │ +    29     }                                 │
│ FILES CHANGED (3)              │ +    30     return token;                     │
│ > M session.ts  src/api +4 −1  │  28  31   }                                  │
│   A errors.ts   src/auth +12   │                                               │
├────────────────────────────────┴───────────────────────────────────────────────┤
│ 1/3 reviewed · Tab pane · ↑↓ select · n/p hunk · v side-by-side · Space · q │
└────────────────────────────────────────────────────────────────────────────────┘
```

The user moves through files in the left pane and reads each diff in the right pane without leaving Pi or opening VS Code's graphical editor.

**Locked display decision:** every new `/diff` session opens in unified mode with old/new line-number gutters and literal `-` / `+` markers. Side-by-side is an optional, user-invoked `v` view for sufficiently wide terminals; it is never selected automatically.

The default `/diff` screen also acts as a lightweight history browser. The left pane contains two stacked selection levels: a **source list** and the selected source's **changed-file list**.

```text
SOURCE CONTROL

WORKSPACE
  W Working Tree (4)
  S Staged Changes (1)

RECENT COMMITS
> 8f3c2a1 Add token validation  HEAD
  2ab91c0 Refactor session service
  f8ee441 Add authentication tests

FILES CHANGED (3)
> M session.ts       src/api
  A errors.ts        src/auth
  M session.test.ts  tests
```

Selecting or clicking a source immediately repopulates `FILES CHANGED` and selects its first file. Selecting or clicking a file immediately updates the diff pane. This retains the VS Code-style two-pane layout instead of permanently sacrificing diff width to a third pane. Keyboard operation remains complete even when mouse events are unavailable.

The same viewer supports committed history without changing the repository:

```text
/diff commit HEAD              # HEAD versus its first parent
/diff commit v1.4.0            # a tag or other commit-ish
/diff range main..feature      # net difference between two endpoints
/diff range main...feature     # merge-base to feature, like a PR diff
```

Commit mode retains the same file-list-and-preview layout:

```text
┌─ COMMIT 8f3c2a1 ────────────┬─ src/api/session.ts · UNIFIED ────────────────────┐
│ Add token validation        │ @@ -27,2 +27,6 @@                                  │
│ Lucas · 2026-08-25          │ -27       return token;                           │
│                             │ +   27     if (!token) {                           │
│ FILES CHANGED (3)           │ +   28       throw new Error();                   │
│ > M session.ts  src/api +4−1│ +   29     }                                     │
│   M login.ts    src/auth +2−2│ +   30     return token;                         │
│   A auth.test.ts tests +14  │                                                    │
├─────────────────────────────┴───────────────────────────────────────────────────┤
│ Commit · 1/3   ↑↓ files   n/p hunk   v side-by-side   Space reviewed   q      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Product principles

1. **Familiar:** Match the hierarchy and interaction model of VS Code Source Control.
2. **Immediate:** Moving the file selection updates the preview without requiring Enter.
3. **Read-first:** Optimize for understanding changes, not performing Git operations.
4. **Safe:** The MVP must not modify the working tree, index, commits, or branches.
5. **Responsive:** The UI must remain usable in wide, medium, and narrow terminals.
6. **Fast:** File changes and scrolling should render without visible lag.
7. **Scope-aware:** The same review UI should handle workspace, commit, and revision-range diffs.
8. **Agent-ready:** The architecture should later support “changes from the latest Pi turn,” not only ordinary Git state.
9. **Unified-first:** Optimize the default code-reading experience around one full-width patch stream with `-` and `+`; side-by-side is secondary.

---

## 3. MVP Scope

### Included

- `/diff` command registered as a Pi extension command.
- Current Git repository detection.
- Workspace review with two selectable sources:
  - **Working Tree**: working tree versus index, plus untracked files.
  - **Staged Changes**: index versus `HEAD`.
- A recent-commit source list inside the default `/diff` screen.
- Single-commit review against the commit's first parent.
- Root-commit review against an empty tree.
- Two-dot range review, such as `main..feature`, as the net difference between resolved endpoints.
- Three-dot range review, such as `main...feature`, from the merge base to the right endpoint.
- Commit or range metadata in the header, including short object IDs and the commit subject where applicable.
- Safe revision parsing and resolution to immutable object IDs before generating a patch.
- File statuses:
  - Modified
  - Added
  - Deleted
  - Renamed
  - Copied, when reported by Git
  - Untracked
  - Unmerged/conflicted, with a limited placeholder view where necessary
- Unified diff parsing and rendering as the canonical/default review view.
- Optional side-by-side diff generation for users who toggle it on in a sufficiently wide terminal.
- Line numbers for both original and modified sides.
- File and hunk navigation.
- Vertical and horizontal scrolling.
- Responsive layouts.
- Marking files as reviewed for the current review session.
- Refreshing Git state without closing the UI.
- Binary-file and oversized-file placeholders.
- Theme-aware terminal colors.
- Unit tests, integration tests, and render-width tests.

### Explicitly excluded from the MVP

- Staging or unstaging files.
- Reverting files or hunks.
- Editing files from the reviewer.
- Inline review comments.
- Sending comments back to Pi.
- Agent-turn-specific snapshots.
- Syntax highlighting.
- Character-level/intraline highlighting.
- Search within diffs.
- Drag selection and advanced mouse gestures; basic click selection is targeted behind terminal capability detection.
- Non-Git source control systems.
- Creating commits or performing branch, push, pull, reset, checkout, or merge operations.
- Combined merge-commit diffs or an in-view merge-parent chooser; merge commits default to parent 1 and disclose that choice.

These are deferred so the first release can prove the core browsing experience without introducing destructive actions or unnecessary complexity.

---

## 4. Interaction Specification

### Command forms and review scopes

```text
/diff                            # source picker: working tree, staged, and recent commits
/diff working                    # explicit workspace mode
/diff staged                     # open directly on staged changes
/diff commit HEAD                # one commit versus its first parent
/diff commit <revision>          # branch, tag, short hash, or full hash
/diff range <base>..<head>       # endpoint-to-endpoint net diff
/diff range <base>...<head>      # merge-base-to-head PR-style diff
```

Rules:

- Bare `/diff` opens on **Working Tree** and loads a configurable number of recent commits in the same left pane.
- Selecting a source or commit refreshes the changed-file list without closing the reviewer.
- Direct `/diff commit <revision>` and `/diff range ...` forms remain fast paths and preselect their requested source.
- Recent history is read-only and scoped to commits reachable from the checked-out history unless a direct revision is supplied.
- The command parser accepts only the explicit forms above; it does not forward arbitrary Git flags.
- Every user-supplied revision is resolved to a full commit object ID before a patch command runs.
- A single commit is compared with parent 1. A root commit is compared with an empty tree.
- A merge commit displays its parent count and an explicit `Diffing against parent 1` note.
- A range diff is a net tree comparison, not a concatenation of each commit's patch.
- Invalid, ambiguous, missing, or non-commit revisions produce a concise in-terminal error.

### Default keybindings

| Key | Behavior |
|---|---|
| `↑` / `↓` | Move selection or scroll the focused pane |
| `j` / `k` | Vim-style equivalent of down/up |
| `Tab` | Move focus among source list, file list, and diff pane |
| `Shift+Tab` | Move focus in the opposite direction |
| `Enter` | From sources, move to files; from files, move to the diff; in narrow layout, open the selected item |
| `Esc` | Return from a narrow/maximized child view; otherwise close |
| `q` | Close the reviewer |
| `n` / `p` | Jump to next/previous hunk in the selected file |
| `PageDown` / `PageUp` | Scroll the diff by approximately one viewport |
| `Home` / `End` | Jump to beginning/end of the selected file diff |
| `←` / `→` | Horizontal scrolling when content is wider than its pane |
| `v` | Toggle between the default unified view and optional side-by-side view when width permits |
| `Space` | Mark/unmark the selected file as reviewed |
| `g` | Refresh Git status, recent commits, and diffs |
| `?` | Toggle a help overlay or expanded keybinding footer |

### Focus behavior

The interface has three focus targets:

```ts
type FocusedPane = "sources" | "files" | "diff";
```

Rules:

- The source list is focused when the reviewer opens, with **Working Tree** selected.
- The diff pane always opens in **unified** mode; changing source, commit, range, or file does not silently switch the view mode.
- Moving source selection immediately replaces the file list and selects the source's first changed file.
- Moving file selection immediately updates the right pane.
- A click on a source, commit, file, or diff pane sets focus to that target when mouse input is available.
- The selected file starts at its first hunk unless a prior scroll position exists for that file.
- Each file preserves its own vertical and horizontal scroll position during the current review session.
- `Tab` changes focus but does not change selection or scroll position.
- The focused pane receives stronger border or title emphasis.
- The source list exposes **Working Tree** and **Staged Changes** as separate workspace sources.
- Commit mode uses one `FILES CHANGED` group and reserves up to three header rows for commit metadata.
- Range mode uses one `FILES CHANGED` group and shows the resolved base, head, and comparison mode in the header.

### Reviewed-state behavior

- `Space` marks the selected file reviewed.
- Reviewed files display a checkmark.
- The footer displays progress such as `3/7 reviewed`.
- Reviewed state is keyed to a fingerprint of the file's raw patch.
- After refresh, a reviewed file remains reviewed only when its patch fingerprint is unchanged.
- Reviewed state is in-memory for the MVP; it does not modify Git or project files.

### Mouse and click behavior

Target behavior:

- Clicking **Working Tree**, **Staged Changes**, or a recent commit selects that source.
- Clicking a file selects it and updates the diff immediately.
- Clicking the diff pane focuses it; the mouse wheel scrolls when the terminal reports wheel events.
- Click hitboxes are recomputed on every render so responsive layout changes remain accurate.
- Keyboard controls provide exact feature parity.

Implementation caveat: Pi's documented custom-component contract exposes keyboard handling through `handleInput(data)` but does not currently document a stable extension-level mouse-event contract for custom components. Phase 0 therefore verifies whether the installed Pi version forwards usable pointer input. Do not rely on private Pi internals or fragile escape-sequence interception. If normalized pointer input is unavailable, ship keyboard navigation first while retaining the tested hitbox/action design for a later Pi adapter update. The standalone prototype can still be used to review the intended click behavior.

### Empty and error states

#### Clean repository

```text
No staged or unstaged changes.

Press q to close or g to refresh.
```

#### Not a Git repository

```text
This directory is not inside a Git repository.

Run Pi from a repository or initialize one with git init.
```

#### Git unavailable

```text
Git could not be executed.

<short stderr message>
```

#### Invalid commit or range

```text
Could not resolve revision: feature-branch

Use /diff commit <revision> or /diff range <base>...<head>.
```

#### Merge commit

```text
Merge commit with 2 parents.
Showing changes against parent 1.
```

#### Binary file

```text
Binary file changed. Text diff is unavailable.
```

#### File too large

```text
Diff omitted because this file exceeds the configured review size limit.
```

---

## 5. Responsive Layout

### Wide terminals: `>= 130` columns

- Left pane: approximately 28–34 columns, capped at 35% of the screen.
- Right pane: unified diff by default so each code line receives the maximum readable width.
- Pressing `v` may enable side-by-side mode when the calculated diff viewport is wide enough.
- Returning to `/diff` in a new session starts in unified mode again.

```text
FILES                         OLD  NEW    UNIFIED DIFF (`-` / `+`)
```

### Medium terminals: `90–129` columns

- Left pane remains visible.
- Unified diff remains the default.
- `v` enables side-by-side only when both columns can retain the configured minimum code width; otherwise show a concise `Side-by-side requires a wider terminal` message.

```text
FILES                         OLD  NEW    UNIFIED DIFF (`-` / `+`)
```

### Narrow terminals: `< 90` columns

- Use one pane at a time.
- Start in the source list: Working Tree, Staged Changes, then recent commits.
- `Enter` opens the selected source's changed-file list.
- A second `Enter` opens the selected unified diff.
- `Esc` walks backward from diff → files → sources; `q` closes from any level.
- Side-by-side mode is disabled, and `v` displays a non-blocking width notice.

```text
SOURCE CONTROL

WORKSPACE
> W Working Tree (3)
  S Staged Changes (1)

RECENT COMMITS
  8f3c2a1 Add token validation
  2ab91c0 Refactor session service
```

### Commit and range headers

- Workspace mode keeps the compact `SOURCE CONTROL` title.
- Commit mode may use up to three rows for short hash, subject, author, date, and parent context.
- Range mode may use up to two rows for the user expression and resolved base/head hashes.
- On short terminals, collapse metadata to one line before reducing the diff viewport.
- Long subjects are ANSI-aware truncated; full metadata can later be exposed in a help/details overlay.

### Height behavior

- Read terminal height from the TUI instance.
- Reserve rows for the title, group headers, borders, and footer.
- Never render more rows than the active viewport budget.
- Keep a minimum usable body height of six rows.
- On extremely short terminals, collapse the detailed footer into `? help · q close`.
- Validate the exact custom-component height behavior against the current Pi TUI before finalizing constants.

---

## 6. Technical Architecture

```text
Pi
└── /diff command
    └── ReviewRequestParser
        ├── workspace request
        ├── commit request
        └── two-dot / three-dot range request
            ↓
       GitReviewReader
        ├── CommitHistoryReader
        │   ├── bounded recent log metadata
        │   └── lazy commit-review cache
        ├── WorkspaceReviewReader
        │   ├── status snapshot
        │   ├── staged patch
        │   ├── working-tree patch
        │   └── untracked-file synthesis
        ├── CommitReviewReader
        │   ├── revision resolution
        │   ├── commit metadata
        │   └── parent-to-commit patch
        └── RangeReviewReader
            ├── endpoint resolution
            ├── optional merge-base calculation
            └── tree-to-tree patch
                ↓
           UnifiedDiffParser
                ↓
           DiffReview model
                ↓
           SideBySideAligner
                ↓
           SourceControlView
            ├── SourceListRenderer
            ├── FileListRenderer
            ├── ReviewHeaderRenderer
            ├── UnifiedDiffRenderer
            ├── SideBySideDiffRenderer
            ├── LayoutCalculator
            ├── HitTargetRegistry
            └── ReviewSessionState
```

### Architectural rules

- The Pi integration layer must not know how unified diff parsing works.
- The parser must not know anything about terminal rendering.
- The renderers must consume structured models, never raw Git output.
- Git commands must be executed with argument arrays, never interpolated shell strings.
- All Git operations in the MVP must be read-only.
- Revision text from the command line must never be treated as Git flags or shell syntax.
- Resolve commit-ish inputs to full object IDs before using them in diff-producing commands.
- Rendering functions must guarantee that every returned line fits the supplied terminal width.
- The core diff model should be reusable by a future standalone CLI or Claude integration.
- Source selection, file selection, and pointer activation must dispatch typed UI actions through one controller; pointer support must not duplicate navigation logic.
- Hit targets are computed from the final responsive layout on every render.

---

## 7. Suggested Project Structure

```text
pi-source-control/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── extension.ts
│   ├── command/
│   │   ├── diff-command.ts
│   │   └── review-request-parser.ts
│   ├── git/
│   │   ├── git-client.ts
│   │   ├── workspace-review-reader.ts
│   │   ├── commit-history-reader.ts
│   │   ├── commit-review-reader.ts
│   │   ├── range-review-reader.ts
│   │   ├── revision-resolver.ts
│   │   ├── status-parser.ts
│   │   └── untracked-file.ts
│   ├── diff/
│   │   ├── unified-parser.ts
│   │   ├── side-by-side-aligner.ts
│   │   ├── patch-fingerprint.ts
│   │   └── line-slicing.ts
│   ├── model/
│   │   ├── diff.ts
│   │   └── review-state.ts
│   └── ui/
│       ├── source-control-view.ts
│       ├── source-list-renderer.ts
│       ├── hit-target-registry.ts
│       ├── input-controller.ts
│       ├── review-header-renderer.ts
│       ├── layout.ts
│       ├── file-list-renderer.ts
│       ├── unified-renderer.ts
│       ├── side-by-side-renderer.ts
│       ├── footer-renderer.ts
│       └── theme.ts
└── test/
    ├── fixtures/
    │   ├── modified.diff
    │   ├── added.diff
    │   ├── deleted.diff
    │   ├── renamed.diff
    │   ├── binary.diff
    │   ├── no-newline.diff
    │   └── unusual-paths.diff
    ├── unit/
    │   ├── status-parser.test.ts
    │   ├── unified-parser.test.ts
    │   ├── side-by-side-aligner.test.ts
    │   ├── review-request-parser.test.ts
    │   ├── revision-resolver.test.ts
    │   ├── source-navigation.test.ts
    │   ├── hit-target-registry.test.ts
    │   ├── layout.test.ts
    │   └── render-width.test.ts
    └── integration/
        ├── workspace-review-reader.test.ts
        ├── commit-history-reader.test.ts
        ├── commit-review-reader.test.ts
        └── range-review-reader.test.ts
```

For the earliest prototype, this can begin as one project-local extension file under `.pi/extensions/`. Split it into the structure above once the command and basic rendering work.

---

## 8. Core Data Model

```ts
type SourceListItem =
  | { kind: "working"; label: "Working Tree" }
  | { kind: "staged"; label: "Staged Changes" }
  | {
      kind: "commit";
      commitOid: string;
      shortOid: string;
      subject: string;
      author: string;
      authoredAt: string;
      parentOids: string[];
    };

type DiffGroupId = "staged" | "working" | "commit" | "range";

type ReviewScope =
  | { kind: "workspace" }
  | {
      kind: "commit";
      requestedRevision: string;
      commitOid: string;
      parentOid?: string;
      parentIndex?: number;
      parentCount: number;
    }
  | {
      kind: "range";
      requestedExpression: string;
      mode: "two-dot" | "three-dot";
      leftOid: string;
      rightOid: string;
      effectiveBaseOid: string;
    };

type FileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unmerged"
  | "type-changed";

interface DiffReview {
  repositoryRoot: string;
  scope: ReviewScope;
  groups: DiffGroup[];
  metadata?: CommitMetadata | RangeMetadata;
  generatedAt: number;
}

interface DiffGroup {
  id: DiffGroupId;
  title: string;
  files: ChangedFile[];
}

interface CommitMetadata {
  oid: string;
  shortOid: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  parentOids: string[];
}

interface RangeMetadata {
  expression: string;
  mode: "two-dot" | "three-dot";
  leftOid: string;
  rightOid: string;
  effectiveBaseOid: string;
}

interface ChangedFile {
  id: string;
  group: DiffGroupId;
  status: FileStatus;
  oldPath?: string;
  newPath: string;
  displayName: string;
  displayDirectory: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isOversized: boolean;
  rawPatch: string;
  patchFingerprint: string;
  hunks: DiffHunk[];
}

interface DiffHunk {
  index: number;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

type DiffLineKind = "context" | "addition" | "deletion" | "metadata";

interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  noNewlineAtEnd?: boolean;
}

interface SideBySideRow {
  left?: DiffCell;
  right?: DiffCell;
  hunkIndex: number;
}

interface DiffCell {
  kind: "context" | "addition" | "deletion" | "empty" | "metadata";
  lineNumber?: number;
  content: string;
}
```

### UI session state

```ts
interface ReviewSessionState {
  focusedPane: "sources" | "files" | "diff";
  selectedSourceId: string;
  selectedFileId?: string;
  sourceScrollOffset: number;
  fileScrollOffset: number;
  viewMode: "unified" | "side-by-side";
  maximizedDiff: boolean;
  reviewedFingerprints: Set<string>;
  verticalOffsetByFile: Map<string, number>;
  horizontalOffsetByFile: Map<string, number>;
  selectedHunkByFile: Map<string, number>;
  pendingSourceId?: string;
  helpVisible: boolean;
}

The initial state must set `viewMode: "unified"`. View mode may be preserved while the reviewer remains open, but a newly opened `/diff` session resets to unified.

interface HitTarget {
  row: number;
  columnStart: number;
  columnEnd: number;
  action:
    | { type: "select-source"; sourceId: string }
    | { type: "select-file"; fileId: string }
    | { type: "focus-diff" };
}
```

---

## 9. Git Data Collection

### Review-request parsing

Parse command input into a typed request before running Git:

```ts
type ReviewRequest =
  | { kind: "workspace"; initialSource: "working" | "staged" }
  | { kind: "commit"; revision: string }
  | {
      kind: "range";
      left: string;
      right: string;
      mode: "two-dot" | "three-dot";
    };
```

Accepted grammar:

```text
<empty>
working
staged
commit <single-revision>
range <left>..<right>
range <left>...<right>
```

Reject extra tokens, empty endpoints, arbitrary flags, and unsupported revision-set expressions. Do not pass the original range expression directly to a patch-producing Git command.

### Safe revision resolution

For every commit-ish input, run an argument-array command equivalent to:

```bash
git rev-parse --verify --end-of-options '<revision>^{commit}'
```

Then:

- Require one full object ID on stdout.
- Use only that resolved object ID in subsequent `git diff`, `git show`, `git rev-list`, or `git merge-base` calls.
- Do not interpolate revision text into a shell string.
- Surface ambiguous or missing revisions as user-facing errors.

### Repository detection

Run:

```bash
git rev-parse --show-toplevel
```

Use the returned root as the base directory for all subsequent Git commands and displayed relative paths.

### Status snapshot

Run:

```bash
git status --porcelain=v1 -z --untracked-files=all
```

Reasons:

- Porcelain output is intended for scripts.
- NUL termination safely handles spaces, Unicode, and unusual filenames.
- The two status columns distinguish index and working-tree state.
- `??` identifies untracked files.

Interpret the two status characters as:

```text
X = index state
Y = working-tree state
```

A file may appear in both UI groups when it has staged and unstaged modifications.

### Staged patch

```bash
git diff \
  --cached \
  --no-ext-diff \
  --no-color \
  --find-renames \
  --unified=3 \
  --
```

### Working-tree patch

```bash
git diff \
  --no-ext-diff \
  --no-color \
  --find-renames \
  --unified=3 \
  --
```

### Untracked files

Ordinary `git diff` does not include untracked files. Handle them separately:

1. Discover them from porcelain status.
2. Read only regular files.
3. Reject files above a configurable size limit, initially 1 MiB.
4. Detect likely binary files by checking for NUL bytes in an initial sample.
5. For text files, synthesize an added-file `ChangedFile` in memory:
   - No old path/content.
   - Every line is an addition.
   - New line numbers begin at 1.
6. Do not call `git add` or otherwise modify the index.

### Recent commit history

For bare `/diff`:

1. Load workspace status and recent history concurrently.
2. Read a configurable default of 20 commits using argument-array Git execution and a NUL-delimited format.
3. Record full object ID, short object ID, parent IDs, author, authored date, and subject for each entry.
4. Default source selection to **Working Tree**.
5. When the user selects a commit, lazily load and cache its metadata, changed-file summary, and patch against parent 1.
6. Invalidate the selected commit cache only when refresh observes that the resolved object ID or repository identity changed. Immutable commit-object patches may otherwise remain cached for the review session.

The source list should virtualize or scroll when history exceeds available rows. Loading a commit patch must not block input without an in-view loading state.

### Single-commit review

For `/diff commit <revision>`:

1. Resolve `<revision>` to `commitOid`.
2. Read metadata using a no-patch command such as `git show -s` with a machine-readable format.
3. Read the commit's parents using `git rev-list --parents -n 1 <commitOid>`.
4. If there is one parent, generate the patch with:

```bash
git diff \
  --no-ext-diff \
  --no-color \
  --find-renames \
  --unified=3 \
  <parentOid> <commitOid> \
  --
```

5. If it is a root commit, use `git diff-tree --root --no-commit-id -r -p` so additions are shown against an empty tree without hard-coding an empty-tree object ID.
6. If it is a merge commit, default to parent 1, show the parent count in the UI, and explicitly label the comparison. Parent selection is deferred.
7. Put all parsed files in one `FILES CHANGED` group.

### Revision-range review

For `/diff range <left>..<right>`:

1. Resolve both endpoints to full commit object IDs.
2. Set `effectiveBaseOid = leftOid`.
3. Generate the net tree diff from `leftOid` to `rightOid`.

For `/diff range <left>...<right>`:

1. Resolve both endpoints to full commit object IDs.
2. Compute candidate merge bases with `git merge-base --all <leftOid> <rightOid>`.
3. Require exactly one merge base for the MVP. If Git reports multiple best merge bases, stop with a clear unsupported-history message instead of silently choosing one.
4. Set that object ID as `effectiveBaseOid` and generate the net tree diff from it to `rightOid`.

In both modes:

- Use resolved object IDs rather than the original expression in the diff command.
- Put all files in one `FILES CHANGED` group.
- Display the requested expression plus shortened resolved hashes in the header.
- Treat the result as a single comparison; do not concatenate patches from every commit in the range.

### Git execution rules

- Prefer Pi's `pi.exec("git", args, options)` API.
- Pass `ctx.signal` when available so closing or aborting can cancel work.
- Apply a reasonable command timeout.
- Never execute user-provided revision arguments through a shell.
- `/diff` accepts only the documented workspace, commit, and range forms; it never forwards arbitrary Git arguments.
- Resolve all user-supplied commit-ish values to immutable object IDs before generating patches.
- Capture and surface concise stderr output.

---

## 10. Unified Diff Parser

### Required input support

The parser must recognize:

- `diff --git` file boundaries.
- `---` and `+++` path headers.
- `new file mode`.
- `deleted file mode`.
- `rename from` and `rename to`.
- `copy from` and `copy to`.
- `Binary files ... differ`.
- Hunk headers such as `@@ -10,4 +10,7 @@`.
- Context lines prefixed with a space.
- Deleted lines prefixed with `-`.
- Added lines prefixed with `+`.
- `\ No newline at end of file`.
- Empty files.
- Paths containing spaces and escaped characters.

### Line-number rules

At each hunk:

```ts
let oldLine = hunk.oldStart;
let newLine = hunk.newStart;
```

Then:

- Context: assign both line numbers; increment both.
- Deletion: assign old line number; increment old only.
- Addition: assign new line number; increment new only.
- No-newline marker: attach to the preceding line; increment neither.

### Parser constraints

- Never interpret `+++` or `---` inside a hunk as file headers.
- Preserve source content exactly after removing the one-character diff marker.
- Normalize only line endings needed for parsing.
- Do not strip code whitespace.
- Return useful parse errors containing the file and nearby hunk header.

---

## 11. Optional Side-by-Side Alignment

Unified rendering is the canonical representation and the default user experience. Side-by-side rows are derived from the same parsed hunk model only after the user presses `v` in a sufficiently wide terminal. Convert each hunk into display rows as follows.

### Context lines

Pair the same line on both sides:

```text
left(context)  ↔  right(context)
```

### Replacement blocks

For each contiguous run of deletions followed by additions:

1. Collect all deletion lines.
2. Collect all addition lines.
3. Pair them by index for the MVP.
4. If one side has more lines, emit empty cells on the shorter side.

Example:

```text
- old one       | + new one
- old two       | + new two
                | + new three
```

This is simple, deterministic, and adequate before adding smarter similarity matching.

### Later improvement

A future release can pair replacement lines using text similarity and then highlight changed character ranges. That must not block the MVP.

---

## 12. Rendering Strategy

### Pi custom component

Register `/diff`, guard for interactive mode, and use `ctx.ui.custom()` to temporarily replace Pi's input area with the reviewer.

Conceptual integration:

```ts
export default function register(pi: ExtensionAPI) {
  pi.registerCommand("diff", {
    description: "Review workspace, commit, or revision-range changes",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/diff requires interactive TUI mode", "error");
        return;
      }

      const request = parseReviewRequest(args);
      const review = await readDiffReview(pi, ctx, request);

      await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
        return new SourceControlView({
          review,
          tui,
          theme,
          keybindings,
          onClose: () => done(undefined),
        });
      });
    },
  });
}
```

### Component contract

The root view implements:

```ts
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
}
```

### Render pipeline

```text
terminal width/height
        ↓
LayoutCalculator
        ↓
FileListRenderer + selected DiffRenderer
        ↓
ANSI-aware horizontal composition
        ↓
Header + body + footer
        ↓
string[] guaranteed to fit width
```

### Width safety

Every rendered line must satisfy:

```ts
visibleWidth(line) <= width
```

Use Pi TUI utilities such as:

- `visibleWidth()`
- `truncateToWidth()`
- ANSI-aware wrapping/slicing utilities

Do not use ordinary JavaScript string slicing on colored terminal strings.

### Rendering cache

Cache output by at least:

- Width.
- Terminal height.
- UI state version.
- Selected file fingerprint.
- Theme version/invalidation.

After any state mutation:

1. Increment the state version or clear cached output.
2. Call `tui.requestRender()`.

`invalidate()` must clear all cached themed strings so changing the Pi theme does not leave stale colors.

---

## 13. Visual Design

### Scope and source hierarchy

Bare `/diff` keeps the selected source and its files in one left pane:

```text
SOURCE CONTROL

WORKSPACE
> W Working Tree (3)
  S Staged Changes (1)

RECENT COMMITS
  8f3c2a1 Add token validation
  2ab91c0 Refactor session service

FILES CHANGED (3)
> M session.ts       src/api
  M login.ts         src/auth
  A auth.test.ts     tests
```

Commit mode:

```text
COMMIT 8f3c2a1 · Add token validation
Lucas · 2026-08-25 · parent 1/1
```

Range mode:

```text
RANGE main...feature
2ab91c0 → 8f3c2a1 · merge-base comparison
```

### Source-list row

Workspace source:

```text
W Working Tree        unstaged + untracked      3
```

Commit source:

```text
● 8f3c2a1 Add token validation                  3
```

The selected source uses the same strong highlight as the selected file. Hashes and graph markers may use an accent color; subjects remain the most readable text. Selecting a source resets the file selection to its first changed file unless the session has remembered a prior selection for that immutable source.

### File-list row

```text
✓ M session.ts                         src/api
```

Priority order when space is limited:

1. Selection marker.
2. Reviewed marker.
3. Status letter.
4. Filename.
5. Directory.
6. Addition/deletion counts.

The filename should be more prominent than the directory. The directory should use a muted or dim theme color.

### Default unified diff row

The right pane opens with one full-width patch stream:

```text
 OLD  NEW
  24   24     const token = await issueToken(userId);
 -27          return token;
      +27     if (!token) {
      +28       throw new SessionError();
      +29     }
```

Rendering rules:

- Reserve separate old-line and new-line number gutters.
- Reserve one marker column containing exactly `-`, `+`, or a blank context marker.
- Render a replacement as its deletion line(s) followed by its addition line(s), matching ordinary unified Git patch order.
- Give the code column all remaining width; do not split it automatically on wide terminals.
- Use subtle full-line addition/deletion backgrounds and stronger marker colors.
- Keep hunk headers sticky or visually distinct while scrolling.
- Show `UNIFIED -/+` in the pane title so the active mode is unambiguous.

### Status letters

| Status | Letter |
|---|---|
| Modified | `M` |
| Added/untracked | `A` or `U` |
| Deleted | `D` |
| Renamed | `R` |
| Copied | `C` |
| Unmerged | `!` |
| Type changed | `T` |

### Diff colors

Use Pi theme roles rather than fixed ANSI colors:

- Addition: `toolDiffAdded`
- Deletion: `toolDiffRemoved`
- Context: `toolDiffContext` or normal text
- Selected row: `selectedBg`
- Active border/title: `borderAccent` / `accent`
- Inactive border: `borderMuted`
- Directory and secondary metadata: `muted` / `dim`
- Warnings: `warning`
- Errors: `error`

### Borders

Use lightweight box-drawing characters and avoid excessive decoration. The content should remain the focus.

---

## 14. Implementation Phases

## Phase 0 — Interaction and terminal capability spike

- [ ] Validate the stacked source-list plus file-list layout using fake data.
- [ ] Confirm keyboard focus transitions among sources, files, and diff.
- [ ] Verify whether the installed Pi custom-component API forwards normalized click and wheel events in VS Code Terminal, iTerm2, Ghostty, Kitty, and tmux.
- [ ] Do not patch private Pi internals or intercept undocumented raw input as an MVP dependency.
- [ ] Decide whether click selection ships in the first Pi extension release or remains capability-gated.
- [ ] Lock the recent-commit row format, truncation behavior, and source/file hitbox rules.
- [ ] Confirm that every prototype and product mock opens in unified `-` / `+` mode, regardless of width.

### Phase 0 completion criteria

- The standalone fake-data prototype is reviewable and the interaction model is approved.
- Keyboard behavior is fully specified.
- Mouse support has a documented go/no-go result rather than an assumption.


## Phase 1 — Scaffold and command registration

- [ ] Create package and TypeScript configuration.
- [ ] Add Pi coding-agent and TUI packages for type checking.
- [ ] Register `/diff`.
- [ ] Guard against non-TUI modes.
- [ ] Verify the command opens and closes a basic custom component.
- [ ] Verify `q` and `Esc` return cleanly to the same Pi session.

### Phase 1 completion criteria

- `/diff` displays a bordered placeholder.
- No terminal corruption occurs after repeatedly opening and closing it.
- The command does not work silently in RPC, JSON, or print mode.

---

## Phase 2 — Git status and structured diff model

- [ ] Detect repository root.
- [ ] Implement the typed `/diff` request parser.
- [ ] Resolve commit-ish inputs safely to full object IDs.
- [ ] Run porcelain status with NUL termination.
- [ ] Parse staged, working, untracked, and conflicted status entries.
- [ ] Run staged and working-tree diff commands.
- [ ] Load recent commit metadata with a NUL-delimited Git format.
- [ ] Lazily load a selected commit patch against parent 1.
- [ ] Implement unified diff parser.
- [ ] Synthesize untracked text-file diffs.
- [ ] Add binary and size-limit detection.
- [ ] Compute additions, deletions, and patch fingerprints.
- [ ] Add unit fixtures for all supported statuses.

### Phase 2 completion criteria

- A structured `DiffReview` correctly represents a temporary test repository.
- Unsupported command forms and invalid revisions fail before any patch-producing command runs.
- A file with both staged and unstaged edits appears under both workspace sources.
- Untracked text files appear without being added to Git.
- Binary files never get decoded as text.

---

## Phase 3 — Unified read-only reviewer

- [ ] Render a source list containing Working Tree, Staged Changes, and recent commits.
- [ ] Render the changed-file list for the selected source.
- [ ] Render the selected file as a unified `-` / `+` diff and make this the initial view for every review session.
- [ ] Implement source and file selection.
- [ ] Update the file list immediately when source selection changes.
- [ ] Update the diff immediately when file selection changes.
- [ ] Implement vertical scrolling.
- [ ] Implement hunk navigation.
- [ ] Implement close and refresh controls.
- [ ] Add clean-repository and error states.

### Phase 3 completion criteria

- The complete review workflow is usable before side-by-side rendering exists, and unified mode is already the permanent default.
- Selecting any source loads the correct changed-file list, and selecting any listed text file displays the correct patch.
- `n` and `p` land on actual hunk boundaries.
- No Git state changes after using the reviewer.

---

## Phase 3B — Commit and revision-range review

- [ ] Implement commit metadata loading.
- [ ] Implement parent discovery.
- [ ] Diff normal commits against parent 1.
- [ ] Diff root commits against an empty tree.
- [ ] Clearly disclose first-parent behavior for merge commits.
- [ ] Implement two-dot endpoint comparison.
- [ ] Implement three-dot merge-base comparison, including explicit handling for multiple best merge bases.
- [ ] Render commit and range metadata in the header.
- [ ] Add invalid/ambiguous revision errors.
- [ ] Add integration fixtures for root, normal, and merge commits.

### Phase 3B completion criteria

- `/diff commit HEAD` shows the files and patch introduced by `HEAD` relative to parent 1.
- A root commit renders as added files rather than failing for lack of a parent.
- A merge commit says which parent is being used.
- `/diff range main..feature` shows the endpoint-to-endpoint net diff.
- `/diff range main...feature` shows the merge-base-to-feature diff.
- User-supplied revision text is never forwarded as an option or shell fragment.

---

## Phase 4 — VS Code-style split layout

- [ ] Implement wide and medium two-pane layouts.
- [ ] Add focus state and `Tab` navigation.
- [ ] Add active and inactive pane styling.
- [ ] Preserve per-file scroll position.
- [ ] Add maximize/restore behavior.
- [ ] Implement narrow one-pane navigation.
- [ ] Add render tests for representative terminal sizes.

### Phase 4 completion criteria

- The left pane behaves like a persistent Source Control source-and-file list.
- Moving selection changes the right pane immediately.
- Wide, medium, and narrow modes all remain usable.
- Every rendered line fits the terminal width.

---

## Phase 5 — Optional side-by-side diff

- [ ] Implement side-by-side row alignment.
- [ ] Add original and modified column headers.
- [ ] Add old/new line-number gutters.
- [ ] Implement horizontal scrolling.
- [ ] Keep unified mode as the default at every width.
- [ ] Add `v` as an explicit opt-in toggle between unified and side-by-side.
- [ ] Reject the toggle with a concise width notice when either side would become unreadable.
- [ ] Add tests for unequal deletion/addition runs.

### Phase 5 completion criteria

- Common modifications align sensibly across the two sides.
- Added-only and deleted-only regions show blank cells on the opposite side.
- Long lines are horizontally scrollable without breaking ANSI styling.
- Closing and reopening `/diff` returns to unified mode.
- Medium and narrow layouts remain safely in unified mode when side-by-side cannot fit.

---

## Phase 6 — Review polish

- [ ] Add reviewed-file state and progress.
- [ ] Preserve reviewed state across refresh when patch fingerprints match.
- [ ] Add compact and expanded help.
- [ ] Improve path truncation and filename emphasis.
- [ ] Add addition/deletion counts where width allows.
- [ ] Add loading, refresh, and concise error feedback.
- [ ] Cache rendered output and profile large diffs.
- [ ] Test theme changes and invalidation.

### Phase 6 completion criteria

- Reviewing ten or more files feels fast and orderly.
- There is always a clear indication of the selected file, focused pane, current hunk, and review progress.
- Theme changes do not leave stale terminal colors.

---

## Phase 7 — Package and document

- [ ] Add installation instructions for local and packaged use.
- [ ] Add a keyboard-reference section.
- [ ] Document supported Git states and limitations.
- [ ] Add screenshots or terminal recordings.
- [ ] Add license and security notes.
- [ ] Test installation from a clean environment.
- [ ] Pin or declare compatible Pi API versions.

### Phase 7 completion criteria

- A second user can install and use `/diff` without reading source code.
- The package has no unnecessary runtime dependencies.
- The README accurately distinguishes read-only MVP behavior from future features.

---

## 15. Testing Plan

### Unit tests

#### Status parser

- Modified only in working tree.
- Modified only in index.
- Modified in both index and working tree.
- Added.
- Deleted.
- Renamed.
- Copied.
- Untracked.
- Unmerged.
- Spaces in filenames.
- Unicode filenames.
- NUL-separated records.

#### Review-request and revision parser

- Empty input maps to workspace mode.
- `working` maps to workspace mode.
- `commit HEAD` maps to one commit request.
- `range main..feature` maps to two-dot mode.
- `range main...feature` maps to three-dot mode.
- Empty range endpoints are rejected.
- Extra arguments are rejected.
- Strings beginning with `-`, such as `--help`, are never interpreted as Git options.
- Missing, ambiguous, and non-commit objects produce typed errors.

#### Unified parser

- One file, one hunk.
- Multiple files.
- Multiple hunks.
- Added file.
- Deleted file.
- Renamed file.
- Empty file.
- Blank lines.
- No final newline.
- Binary marker.
- Code lines beginning with `+++` or `---` inside a hunk.
- Quoted/escaped paths.

#### Side-by-side alignment

- Context only.
- One deletion replaced by one addition.
- Two deletions replaced by three additions.
- Three deletions replaced by one addition.
- Addition-only block.
- Deletion-only block.
- Adjacent hunks.

#### Source navigation and hit testing

- Working Tree, Staged Changes, and commit rows map to distinct source IDs.
- Selecting a source replaces the file list and selects its first file.
- Returning to a previously selected immutable commit can restore its prior file and scroll position.
- Keyboard and pointer activation dispatch the same action object.
- Hitboxes remain valid after responsive resizing and ANSI-aware truncation.
- Long history lists scroll without moving the file-list selection unexpectedly.

#### Layout and renderer

- Initial view mode is unified at wide, medium, and narrow widths.
- Reopening a review session resets an earlier side-by-side selection to unified.
- `v` toggles to side-by-side only when the minimum two-column width is satisfied.

Test widths at minimum:

```text
50, 60, 89, 90, 110, 129, 130, 160, 220
```

Test heights at minimum:

```text
8, 10, 16, 24, 40, 60
```

For every render:

```ts
for (const line of renderedLines) {
  expect(visibleWidth(line)).toBeLessThanOrEqual(width);
}
```

### Integration tests

Create temporary Git repositories and exercise real commands:

1. Clean repository.
2. One unstaged modification.
3. One staged modification.
4. Same file staged and then modified again.
5. Added tracked file.
6. Untracked text file.
7. Deleted file.
8. Renamed file.
9. Binary file.
10. Large file.
11. Merge conflict, when practical.
12. Normal commit against its parent.
13. Root commit against an empty tree.
14. Merge commit against parent 1, with explicit parent metadata.
15. Two-dot range with divergent endpoints.
16. Three-dot range whose merge base differs from the left endpoint.
17. Criss-cross history with multiple best merge bases produces a clear unsupported-history error.
18. Tag and short-hash resolution.
19. Invalid or ambiguous revision.
20. A revision-like input beginning with `-` is rejected or resolved safely without option injection.

After every test, assert that the index, working tree, refs, and object graph are unchanged by the reader.

### Manual terminal matrix

Prioritize:

- VS Code integrated terminal on macOS.
- iTerm2.
- Ghostty.
- Apple Terminal.
- A tmux session.

Check:

- Opening and closing repeatedly.
- Resizing while open.
- Very long paths.
- Very long source lines.
- Large numbers of changed files.
- Commit metadata with long subjects and multiple parents.
- Two-dot and three-dot range headers.
- Theme switching.
- Keyboard behavior with and without Vim habits.

---

## 16. Performance and Safety Requirements

### Performance

- Read Git state once when the reviewer opens.
- Refresh only on explicit `g` in the MVP.
- Parse each raw patch once per refresh.
- Cache side-by-side rows per file fingerprint.
- Render only visible file rows and visible diff rows.
- Avoid syntax highlighting or expensive similarity matching in the MVP.
- Impose a configurable maximum raw patch size and per-file size.

### Safety

The MVP may execute only read operations such as:

```text
git rev-parse
git status
git diff
git diff-tree
git show --no-patch
git rev-list
git merge-base
```

It must not execute:

```text
git add
git restore
git reset
git checkout
git commit
git clean
```

Additional requirements:

- Never evaluate a Git command through a shell.
- Never pass unresolved user revision text to a patch-producing command.
- Never treat `/diff` input beginning with `-` as a Git option.
- Never send repository content to an LLM or network service.
- Never write review state into the repository in the MVP.
- Never follow untracked-file paths outside the repository root.
- Handle symlinks deliberately; do not read through a symlink that resolves outside the repository.
- Limit file reads and command output sizes.
- Treat malformed Git output as an error, not as executable input.

---

## 17. MVP Acceptance Criteria

The MVP is complete only when all of the following are true:

- [ ] `/diff` opens inside Pi's interactive terminal mode.
- [ ] `q` returns to the existing Pi conversation cleanly.
- [ ] Staged and unstaged changes appear as separate selectable sources.
- [ ] A file with both staged and unstaged changes appears under both workspace sources.
- [ ] Untracked text files appear as additions without modifying the index.
- [ ] Bare `/diff` lists Working Tree, Staged Changes, and recent commits in the left pane.
- [ ] Selecting a commit immediately loads that commit's changed files without closing the viewer.
- [ ] Selecting a file immediately updates the right-hand diff.
- [ ] Keyboard navigation covers every source, file, and diff action; mouse click selection works where the capability spike is supported.
- [ ] `/diff commit <revision>` renders a commit against parent 1.
- [ ] Root commits render correctly against an empty tree.
- [ ] Merge commits disclose first-parent comparison behavior.
- [ ] Two-dot ranges render endpoint-to-endpoint net changes.
- [ ] Three-dot ranges render merge-base-to-head changes.
- [ ] Invalid or option-like revision inputs cannot alter the Git command being executed.
- [ ] Unified `-` / `+` view is the initial/default view on every supported width.
- [ ] Selecting a different source, commit, range, or file never causes an automatic switch to side-by-side.
- [ ] Side-by-side view works as an explicit `v` toggle on sufficiently wide terminals.
- [ ] Narrow terminals use a one-pane flow.
- [ ] Old and new line numbers are correct.
- [ ] `n` and `p` navigate hunks.
- [ ] Vertical and horizontal scrolling are bounded correctly.
- [ ] Binary and oversized files display safe placeholders.
- [ ] Reviewed-file progress works for the current review session.
- [ ] Refresh preserves reviewed status only for unchanged patches.
- [ ] No rendered line exceeds the terminal width.
- [ ] No Git command used by the extension mutates repository state.
- [ ] The reviewer performs no network or model calls.
- [ ] Parser, alignment, layout, and repository integration tests pass.

---

## 18. Deferred Features

Implement these only after the read-only reviewer feels polished.

### Advanced history browsing

The MVP already shows recent commits in the default source list. Later enhancements may include:

- Fuzzy search by commit hash, subject, or author.
- Pagination or incremental history loading.
- Branch and tag filters.
- A first-parent-only toggle.
- An all-refs mode.
- Merge-parent selection and combined merge diffs.
- Commit graph decorations.
- Pinning a comparison base while browsing later commits.

### Inline comments

- Select a line or range.
- Press `c`.
- Enter a review comment.
- On exit, convert comments into structured feedback and insert it into Pi's editor or send it as a user message.

### Agent-turn changes

Add tabs or scopes:

```text
[ Agent Turn ] [ Working Tree ] [ Staged ]
```

This requires capturing before/after file state around Pi edit/write operations so unrelated user changes are not mixed into the agent review.

### Staging and reverting

- Stage/unstage file or hunk.
- Revert file or hunk.
- Require explicit confirmation for destructive actions.
- Keep these operations in a separate Git mutation service with exhaustive tests.

### Better visual diffing

- Syntax highlighting.
- Similarity-based line pairing.
- Character-level change highlighting.
- Moved-code detection.
- Whitespace-ignore modes.

### Navigation improvements

- File filtering.
- Search in selected diff.
- Collapsible directories.
- Sort by path, status, or change size.
- Persist reviewed state across sessions.

### Native Pi mouse support and advanced gestures

The core interaction model includes click hit targets, and the standalone prototype demonstrates them. The Pi adapter enables click selection only when a documented normalized mouse API is available in the installed Pi version. Defer raw mouse plumbing, drag selection, text-range selection, hover states, context menus, and other gestures. Keyboard behavior remains complete.

### Standalone CLI adapter

Extract the core model and render logic into a library so the same viewer can run:

```text
pi-source-control          # standalone executable
/diff                      # Pi extension
Claude hook/command        # future adapter
```

---

## 19. Recommended First Implementation Slice

The first coding session should implement only this vertical slice:

1. Register `/diff`.
2. Verify the current directory is a Git repository.
3. Load working-tree status and a short recent-commit list.
4. Use fake or lazily loaded file summaries for each source while the UI interaction is stabilized.
5. Show a two-pane interface:
   - Left: sources followed by files changed for the selected source.
   - Right: unified diff for the selected file.
6. Support:
   - `Tab` among sources, files, and diff
   - `↑` / `↓` and `j` / `k`
   - `Enter` to advance focus
   - `PageUp` / `PageDown`
   - `q` / `Esc`
7. Add width-safety and focus-transition tests.
8. Complete the documented mouse-capability check without making keyboard behavior depend on it.

Do not implement side-by-side alignment until that basic interface opens, navigates, switches sources, resizes, and closes reliably.

The second coding slice, before visual polish, should add:

1. Lazy commit patch loading when a recent commit is selected.
2. `/diff commit HEAD` and direct commit preselection.
3. Commit metadata and parent discovery.
4. Root-commit support.
5. `/diff range <base>..<head>`.
6. `/diff range <base>...<head>`.
7. Revision-injection and invalid-revision tests.

This ensures the core model is genuinely scope-independent before the UI becomes more complex.

---

## 20. Interaction Prototype

Two fake-data prototypes accompany this plan so the interaction can be reviewed before Git and Pi integration work begins:

- **`pi_source_control_demo.html`** — quickest visual review. Open it in a browser; click Working Tree, Staged Changes, commits, and files. It opens in unified `-` / `+` mode and supports an optional `v` side-by-side toggle plus reviewed state.
- **`pi_source_control_terminal_demo.py`** — dependency-free terminal prototype using Python `curses`. Run `python3 pi_source_control_terminal_demo.py`. It supports keyboard navigation and best-effort terminal mouse clicks/wheel events.

Prototype behaviors:

- Click or keyboard-select Working Tree, Staged Changes, or a fake commit in the source list.
- See `FILES CHANGED` repopulate immediately while the two-pane layout remains stable.
- Select files and inspect the default unified `-` / `+` diff; press `v` to inspect the optional side-by-side rendering.
- Mark files reviewed and jump between hunks.
- Confirm that selecting commits requires no separate command and no permanent third pane.

Both prototypes are intentionally read-only, contain only fake data, and never inspect a real repository.

---

## 21. Implementation Notes for the Coding Agent

- Treat this document as the product and implementation handoff.
- Implement phases in order.
- Do not add staging, revert, comments, or model calls during the MVP. Keep pointer input isolated behind the host adapter and Phase 0 capability result.
- Prefer small pure functions for parsing, alignment, layout, and rendering.
- Add a failing test before fixing every parser or rendering edge case.
- Keep Git execution behind one typed interface so it can be mocked.
- Parse review scope before touching Git, and resolve every commit-ish input before generating a patch.
- Keep commit and range semantics explicit; do not delegate arbitrary revision-set parsing to a shell command.
- Keep raw patches available for debugging, but do not render unbounded raw output.
- Verify behavior against the current installed Pi types rather than guessing undocumented properties.
- Use official Pi examples as patterns for `registerCommand`, `ctx.ui.custom`, keyboard matching, invalidation, and `tui.requestRender`.
- Stop and document any Pi TUI limitation that prevents a faithful layout rather than hiding it with fragile ANSI behavior.

---

## 22. Primary References

- Pi Extensions documentation: <https://pi.dev/docs/latest/extensions>
- Pi TUI Components documentation: <https://pi.dev/docs/latest/tui>
- Pi official extension examples: <https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions>
- Git `diff` documentation: <https://git-scm.com/docs/git-diff>
- Git `diff-tree` documentation: <https://git-scm.com/docs/git-diff-tree>
- Git `show` documentation: <https://git-scm.com/docs/git-show>
- Git `rev-parse` documentation: <https://git-scm.com/docs/git-rev-parse>
- Git `rev-list` documentation: <https://git-scm.com/docs/git-rev-list>
- Git `merge-base` documentation: <https://git-scm.com/docs/git-merge-base>
- Git `status` documentation: <https://git-scm.com/docs/git-status>


# pi-source-control

`pi-source-control` is a read-only, keyboard-driven Source Control diff reviewer for the Pi coding agent. It opens from `/diff`, keeps working-tree, staged, recent-commit, single-commit, and revision-range reviews inside the terminal, and never changes the repository.

## Install

Install a local checkout into Pi with an absolute path:

```sh
pi install /absolute/path/to/pi-source-control
```

To try the extension directly from its checkout:

```sh
pi -e ./src/extension.ts
```

For development, install the locked dependencies with pnpm:

```sh
pnpm install
```

## Usage

```text
/diff                            # source picker: working tree, staged, and recent commits
/diff working                    # explicit workspace mode
/diff staged                     # open directly on staged changes
/diff commit HEAD                # one commit versus its first parent
/diff commit <revision>          # branch, tag, short hash, or full hash
/diff range <base>..<head>       # endpoint-to-endpoint net diff
/diff range <base>...<head>      # merge-base-to-head PR-style diff
```

Bare `/diff` starts on the Working Tree source. Direct commit and range forms are fast paths to the requested review. A root commit is compared with the empty tree, and a range is rendered as one net tree comparison rather than a series of commit patches.

## Keyboard reference

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

### Mouse

Not supported yet. Pi (as of 0.84) does not forward mouse events to extension
components: in regular mode the terminal never enables mouse reporting, and in
the experimental fullscreen mode the wheel is routed only to Pi's own layout
tree, which mounts extension components inside a plain container that the
layout engine renders as text. The viewer already exposes its panes as pi-tui
`ScrollView`s (see `src/ui/fullscreen-layout.ts`), so wheel scrolling will work
as soon as Pi lets custom components participate in fullscreen layout. Until
then the reviewer is keyboard-only.

## Layouts

- Wide terminals are 130 columns or wider.
- Medium terminals are 90–129 columns.
- Narrow terminals are under 90 columns and show one pane at a time.

Every review opens in unified mode. Side-by-side mode is never selected automatically; press `v` to opt in when the terminal is wide enough for both code columns.

## Supported Git states

- Modified, added, deleted, renamed, and copied files.
- Untracked files, rendered as additions when they are text and within the review size limit.
- Unmerged or conflicted files, with a limited placeholder when a text diff cannot be shown.
- Binary files, with a placeholder explaining that a text diff is unavailable.
- Files over the 1 MiB review limit, with an oversized-file placeholder.
- Root commits, ordinary commits, and merge commits. Merge commits are compared with parent 1 and disclose that choice in the reviewer.
- Two-dot ranges as endpoint-to-endpoint net diffs and three-dot ranges as merge-base-to-head diffs. A three-dot range with multiple merge bases is rejected because choosing one would be ambiguous.

## Safety

The extension only invokes Git's read-only `rev-parse`, `status`, `diff`, `diff-tree`, `show`, `rev-list`, `merge-base`, and `log` commands. Git is executed with argument arrays, never through a shell. User-provided revisions are resolved to full immutable commit OIDs before a patch command runs.

The extension makes no network or model calls. It does not write review state, configuration, or any other state to the repository; reviewed markers exist only in memory for the current session.

## Limitations / not in MVP

- Staging or unstaging files.
- Reverting files or hunks.
- Editing files from the reviewer.
- Inline review comments.
- Sending comments back to Pi.
- Agent-turn-specific snapshots.
- Syntax highlighting.
- Character-level/intraline highlighting.
- Search within diffs.
- Drag selection and advanced mouse gestures.
- Mouse input (clicks and wheel) is not supported; see the Mouse section.
- Non-Git source control systems.
- Creating commits or performing branch, push, pull, reset, checkout, or merge operations.
- Combined merge-commit diffs or an in-view merge-parent chooser; merge commits default to parent 1 and disclose that choice.

TODO: add screenshots or a terminal recording after the MVP.

## Development

Requires Node.js 22 or newer and pnpm. Run the complete verification suite with:

```sh
pnpm check
```

`pnpm check` runs Vitest first and then the TypeScript typecheck. Pure unit tests live in `test/unit`, real-Git temporary-repository tests live in `test/integration`, shared helpers live in `test/helpers`, and patch fixtures live in `test/fixtures`.

## License

MIT © Lucas Zheng. See [LICENSE](LICENSE).

# pi-source-control

`@lucas-j-zheng/pi-source-control` is a read-only, keyboard-driven Source Control diff reviewer for the Pi coding agent. It opens from `/diff`, keeps working-tree, staged, recent-commit, single-commit, and revision-range reviews inside the terminal, and never changes the repository.

## Install

Install the published package into Pi:

```sh
pi install npm:@lucas-j-zheng/pi-source-control
```

Pin a version instead of tracking the latest release:

```sh
pi install npm:@lucas-j-zheng/pi-source-control@0.2.0
```

Install a local checkout with an absolute path:

```sh
pi install /absolute/path/to/pi-source-control
```

To try the extension directly from its checkout, without installing it:

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
| `↑` / `↓` | Move the selection in the focused list; in the diff pane, move the line cursor |
| `j` / `k` | Vim-style equivalent of down/up |
| `J` / `K` | Same as `↓` / `↑` but 5 rows at a time |
| `Ctrl+D` / `Ctrl+U` | Half a viewport, in the focused pane |
| `Tab` | Move focus among source list, file list, and diff pane |
| `Shift+Tab` | Move focus in the opposite direction |
| `Enter` | From sources, focus the file list; from files, focus the diff. In narrow layout only the focused pane is on screen, so this is what opens the next one |
| `Esc` | Back a level (closes from the source list) |
| `h` / `Backspace` | Back a level (closes from the source list) |
| `l` | Enter selected |
| `q` | Close the reviewer |
| `n` / `p` | Jump to next/previous hunk in the selected file |
| `PageDown` / `PageUp` | About one viewport, in the focused pane |
| `Home` / `End` | Jump to the first/last row of the focused pane |
| `←` / `→` | Scroll the selected file's diff horizontally, 8 columns per press |
| `Ctrl+E` / `Ctrl+Y` | Scroll the diff one row without moving the cursor; ignored unless the diff pane has focus |
| `Shift+↑` / `Shift+↓` | Same as `Ctrl+Y` / `Ctrl+E`, and likewise diff-only |
| `v` | Toggle between the default unified view and optional side-by-side view when width permits |
| `Space` | Mark/unmark the selected file as reviewed |
| `c` | Comment on the cursor line, or edit the comment already there, in an inline editor |
| `d` | Delete the comment on the cursor line |
| `Shift+S` | Send every queued comment to Pi as one message and close |
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

## Review comments

Press `c` on a diff line to open an input box directly beneath it; the reviewer never
leaves the diff. `Enter` saves, `Esc` discards, and `Alt+Enter` starts a new line.
While the editor is open every keystroke goes into it, so ordinary bindings such as
`q` and `j` type their character instead of firing.

Saved comments render as `💬` rows under the line they are anchored to. `c` on a
commented line reopens that comment for editing, and `d` deletes it. `Shift+S` hands
the whole queue to Pi as one message, closes the reviewer, and submits it as a user
turn so Pi starts on the review without a further keypress. On a Pi build with no send
API the message is typed into the prompt instead and a notice says to press `Enter`;
either way the reviewer reports how many comments it handed over. Sending is the one
action that puts repository content in front of a model — see [Safety](#safety) for
exactly what the message contains. Comments live in memory for the session only —
nothing is written to the repository.

## Supported Git states

- Modified, added, deleted, renamed, and copied files.
- Untracked files, rendered as additions when they are text and no larger than 1 MiB. A larger untracked file is listed with an oversized-file placeholder and is never read into memory.
- Unmerged or conflicted files, with a limited placeholder when a text diff cannot be shown.
- Binary files, with a placeholder explaining that a text diff is unavailable.
- Working-tree and staged files whose patch exceeds 4 MiB, with an oversized-file placeholder instead of a parsed diff. Commit and range reviews do not apply that per-file cap yet, so a very large single-commit diff is bounded only by available memory.
- Root commits, ordinary commits, and merge commits. Merge commits are compared with parent 1 and disclose that choice in the reviewer.
- Two-dot ranges as endpoint-to-endpoint net diffs and three-dot ranges as merge-base-to-head diffs. A three-dot range with multiple merge bases is rejected because choosing one would be ambiguous.

## Safety

Every Git invocation is checked against a read-only allowlist before it runs; the commands the reviewer actually uses are `rev-parse`, `status`, `diff`, `diff-tree`, `show`, `merge-base`, and `log`. Git is executed with argument arrays, never through a shell. User-provided revisions are resolved to full immutable commit OIDs before a patch command runs.

The extension itself opens no network connection and calls no model provider directly. It does not write review state, configuration, or any other state to the repository; comments and reviewed markers exist only in memory for the current session.

**`Shift+S` sends your review to your agent, and your agent will call your model provider.** That keypress is the only action in the reviewer that puts repository content in front of a model, and it happens only when you press it. The message contains, for each queued comment: the file path, the line number, the diff marker and the verbatim text of the single line the comment is anchored to, the source label (`working tree`, `staged changes`, `commit <short hash> (<subject>)`, or `range <expression>`), and the comment text you typed — plus a suggested per-file work plan built from those same paths. Whole diffs and surrounding context lines are not included; the agent reads the files itself.

The extension has no endpoint of its own: it never contacts its author or any third-party service. The message is handed to the Pi session you are already running, and from there it goes wherever that session's configured provider is — which may be a hosted API or a local model, depending on your own Pi configuration. If the host Pi build has no send API, the message is typed into the prompt instead and nothing is sent until you press `Enter`.

To render an untracked file as an addition the extension reads that file from disk directly (up to 1 MiB), rather than through Git.

## Limitations / not in MVP

- Staging or unstaging files.
- Reverting files or hunks.
- Editing files from the reviewer.
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

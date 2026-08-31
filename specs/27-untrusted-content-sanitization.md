# 27 — Repository content is treated as untrusted before it reaches a terminal or an agent

## Goal
Strip terminal control sequences from every repository-derived string before it is rendered or sent
to the agent, and give invalid-UTF-8 paths a lossless identity. Today a crafted repository can drive
the reviewer's terminal (OSC 52 clipboard writes, title changes) and can make a diff line *display*
as something other than what it contains.

## Depends on
- 02-unified-diff-parser (`parseUnifiedDiff`, `decodeQuotedPath` from `src/diff/unified-parser.ts`)
- 07-side-by-side-aligner / 10-unified-renderer (`expandTabs`, `sliceColumns` from `src/diff/line-slicing.ts`)
- 20-inline-review-comments (`buildComment`, `buildReviewMessage` from `src/model/review-comment.ts`)

## Files
- create `src/diff/sanitize.ts`
- modify `src/diff/unified-parser.ts`
- modify `src/git/untracked-file.ts`
- modify `src/model/review-comment.ts`
- create `test/unit/sanitize.test.ts`
- modify `test/unit/unified-parser.test.ts`

## Interfaces
```ts
// sanitize.ts — pure, no terminal state
export function sanitizeContent(text: string): string;   // for diff line content and hunk headers
export function sanitizeLabel(text: string): string;     // for paths, commit subjects, author names
export function pathKey(octets: readonly number[]): string; // lossless id for decoded path bytes
```

## Behavior
- `sanitizeContent` removes every escape-introduced sequence (CSI `ESC [ … final`, OSC `ESC ] … BEL|ST`,
  APC/PM/DCS/SOS `ESC _^X` … ST, and any other `ESC`-prefixed form) and replaces the remaining C0
  controls — including a bare `CR`, `BEL` and `\b` — with a visible U+FFFD, keeping `\t` for
  `expandTabs` to handle. It never changes ordinary text, including all valid UTF-8 and emoji.
- `sanitizeLabel` behaves the same but also collapses `\n` and `\r`, since a label occupies one row.
- Sanitization happens **at the parse boundary**, not the render boundary: `parseUnifiedDiff` applies
  `sanitizeContent` to `DiffLine.content` and `DiffHunk.header`, and `sanitizeLabel` to every path
  field. `readUntrackedFile` does the same for the content it synthesizes, and additionally strips a
  `CR` that terminates a `CRLF` line so untracked files match the tracked-diff convention.
- Because the model is sanitized, `buildComment` and `buildReviewMessage` inherit clean text and the
  agent never receives control bytes. `describeScope` labels are sanitized where commit metadata
  enters them.
- `decodeQuotedPath` keeps a lossless byte identity: `ChangedFile.id` uses `pathKey(octets)` (hex of
  the raw bytes) so two filenames differing only in invalid UTF-8 bytes get distinct ids, while
  `newPath`/`displayName` keep the replacement-character rendering for display.
- Width safety is unchanged: sanitized content is never wider than the original.

## Tests
`test/unit/sanitize.test.ts`
- "OSC 52 clipboard sequences are removed" — `]52;c;cGF5bG9hZA==` → `""`
- "a bare CR cannot rewrite the line" — `evil();\r// harmless` keeps both halves visibly
- "CSI, APC and DCS sequences are removed"
- "ordinary text, tabs, emoji and CJK are untouched"
- "sanitizeLabel collapses newlines"
`test/unit/unified-parser.test.ts`
- "a filename containing escape bytes is rendered inert" — git-quoted `"a\033]0;pwn\007b.txt"` decodes without a live escape
- "two filenames differing only in invalid UTF-8 bytes get distinct ids"
- "an untracked CRLF file does not keep its carriage returns"

## Out of scope
Sanitizing the extension's own styling (it must pass through). Rendering escape sequences as
readable text such as `^[`. Any change to how comments are delivered (spec 30).

## Done when
`pnpm check` exits 0 with 8 new tests passing and all existing tests passing, and a fixture repo
whose diff contains OSC 52 renders with no escape byte in the output rows.

## Fixes

Adversarial verification after implementation found two gaps. Both are reachable from a repository
an installer merely opens.

### Fix 1 — sanitize before matching, so hostile bytes cannot hide a diff

`src/diff/unified-parser.ts` sanitizes the hunk header *after* matching it, so a bare CR inside
`@@ -3,5 +3,6 @@ int header(void) {` prevents the header regex from matching at all. The file then
parses to `hunks.length === 0` and the reviewer renders **"No textual changes."** — a real change is
silently hidden from review, which is worse than an escape reaching the terminal.

- Sanitize each patch line before structural matching, not after, so control bytes can never change
  how the patch is parsed. Verify that a hunk header carrying OSC, CSI, CR and U+009B still yields
  the correct hunk, with the sequences removed from the rendered header.

### Fix 2 — commit metadata is repository-controlled too

`parseLogOutput` (`src/git/commit-history-reader.ts:28`) and the commit reader's metadata keep the
raw subject and author. The subject reaches the terminal live through
`src/ui/source-list-renderer.ts:50` and `src/ui/review-header-renderer.ts:40`.

- Apply `sanitizeLabel` to commit subject and author in both readers, at the parse boundary.

### Tests
`test/unit/sanitize.test.ts` (or the parser/reader test files)
- "a hunk header carrying control bytes still parses into a hunk"
- "a hostile commit subject cannot reach the source list or the header"
- "a hostile author name is inert"

### Done when
`pnpm check` exits 0 with 3 further tests passing, and a fixture repo whose commit subject, author
and hunk header all carry OSC/CSI/CR/U+009B renders no ESC byte and still shows the diff.

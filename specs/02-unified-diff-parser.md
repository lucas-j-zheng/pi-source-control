# 02 — Unified diff parser

## Goal
Turn raw `git diff` output into `ChangedFile[]` with hunks, lines and correct old/new line numbers. It is the canonical model every renderer consumes, so it must never see terminal concerns.

## Depends on
none (types from `src/model/diff.ts`).

## Files
- create `src/diff/patch-fingerprint.ts`
- create `src/diff/unified-parser.ts`
- create fixtures: `test/fixtures/modified.diff`, `added.diff`, `deleted.diff`, `renamed.diff`, `binary.diff`, `no-newline.diff`, `unusual-paths.diff`, `multi.diff` (two files, one with two hunks)
- create `test/unit/unified-parser.test.ts`

## Interfaces
```ts
// patch-fingerprint.ts
export function fingerprintPatch(rawPatch: string): string; // sha1 hex via node:crypto

// unified-parser.ts
export class DiffParseError extends Error {
  constructor(message: string, public readonly file?: string, public readonly nearHunk?: string);
}
export interface ParseOptions { group: DiffGroupId; }
export function parseUnifiedDiff(raw: string, options: ParseOptions): ChangedFile[]; // throws DiffParseError
export function splitPatchByFile(raw: string): string[]; // each starts with "diff --git"
```

## Behavior
- `splitPatchByFile` splits at every line starting with `diff --git ` (line start only); leading text before the first header is ignored; empty input → `[]`.
- For each file chunk: paths from `diff --git a/<old> b/<new>` (handle quoted paths `"a/with space.txt"` by unquoting C-style escapes `\"`, `\\`, `\t`, `\n`, `\ooo`); `--- /dev/null` ⇒ added, `+++ /dev/null` ⇒ deleted; `rename from/to` ⇒ renamed (oldPath set); `copy from/to` ⇒ copied; `new file mode` ⇒ added; `deleted file mode` ⇒ deleted; otherwise modified.
- `Binary files ... differ` or `GIT binary patch` ⇒ `isBinary: true`, `hunks: []`, additions/deletions 0.
- Hunk header regex `^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$`; missing count defaults to 1; `header` is the whole line.
- Line numbering per hunk exactly as `docs/plan.md` §10: context increments both, `-` old only, `+` new only, `\ No newline at end of file` sets `noNewlineAtEnd: true` on the previous line and increments neither.
- Inside a hunk, lines starting with `+++`/`---` are additions/deletions (never file headers) — only header lines *before* the first `@@` are metadata.
- `content` is the line minus its first char; whitespace preserved; `\r\n` treated as line terminator (CR stripped from terminators only).
- `additions`/`deletions` = counts of addition/deletion lines across hunks.
- `rawPatch` = the file chunk verbatim; `patchFingerprint = fingerprintPatch(rawPatch)`; `id = \`${group}:${newPath}\``; `displayName`/`displayDirectory` per §00 conventions (dirname `""` for root files).
- A line inside a hunk that starts with none of ` `, `+`, `-`, `\` → `DiffParseError` with `file` and `nearHunk` set to the current hunk header. Empty line inside a hunk counts as a context line with empty content.
- Files with zero hunks and not binary (mode-only change, empty added file) → `hunks: []`, counts 0, status still derived from headers.
- `fingerprintPatch` is deterministic and differs for differing input.

## Tests
`test/unit/unified-parser.test.ts` (read fixtures with `node:fs`)
- "one file, one hunk" (modified.diff): 1 file, status modified, 1 hunk, header preserved, `oldStart/newStart` match
- "line numbers are assigned per unified rules": in modified.diff, first context line has both numbers, a deletion has old only, an addition has new only, and numbers increment as expected (assert exact numbers from fixture)
- "multiple files" (multi.diff): 2 files with distinct ids
- "multiple hunks": second file in multi.diff has 2 hunks with `index` 0 and 1
- "added file": added.diff → status added, `oldPath` undefined, every line addition, first newLineNumber 1
- "deleted file": status deleted, every line deletion
- "renamed file": status renamed, `oldPath` and `newPath` differ
- "empty file": a `new file mode` chunk with no hunks → hunks `[]`, additions 0
- "blank lines": an empty line inside a hunk is context with content ""
- "no final newline" (no-newline.diff): the line before `\ No newline` has `noNewlineAtEnd: true`; hunk line count excludes the marker
- "binary marker" (binary.diff): isBinary true, hunks empty
- "code lines beginning with +++ or --- inside a hunk": a hunk containing `++++ x` and `---- y` yields addition `+++ x` and deletion `--- y`
- "quoted/escaped paths" (unusual-paths.diff): path `dir/with space.txt` and a `\303\251` escape decodes to `é`
- "CRLF patches parse": modified.diff with `\n`→`\r\n` gives identical line numbers
- "malformed hunk line throws DiffParseError with file and nearHunk"
- "fingerprint is stable and content-sensitive"
- "displayName and displayDirectory": `src/api/session.ts` → `session.ts`, `src/api`; `README.md` → `README.md`, `""`

## Out of scope
- Side-by-side alignment, rendering, git execution.
- Untracked-file synthesis (spec 03).

## Done when
`pnpm check` exits 0 with 17 new tests passing.

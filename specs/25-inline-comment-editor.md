# 25 — Compose comments without leaving the diff

## Goal
Replace the Pi editor overlay with an input box rendered inline under the cursor line, so writing a comment never takes you out of the reviewer. Leaving the diff to type loses your place and breaks the review flow.

## Depends on
- 24-inline-comment-display (comment rows in the diff row model)
- 20-inline-review-comments (`compose-comment` effect, `add-comment`, `composeComment` option)

## Files
- create `src/ui/line-editor.ts`
- modify `src/model/review-state.ts`
- modify `src/ui/unified-renderer.ts` and `src/ui/side-by-side-renderer.ts`
- modify `src/ui/source-control-view.ts`, `src/command/diff-command.ts`, `src/extension.ts`
- create `test/unit/line-editor.test.ts`; modify `test/unit/review-state.test.ts`, `test/unit/diff-command.test.ts`

## Interfaces
```ts
// line-editor.ts — a minimal, pure text buffer; no terminal state
export interface EditorBuffer { text: string; caret: number; }
export function createBuffer(text?: string): EditorBuffer;
export function applyKey(buffer: EditorBuffer, data: string): { buffer: EditorBuffer; done?: "submit" | "cancel" };
export function renderBuffer(buffer: EditorBuffer, width: number): string[]; // wrapped, caret shown as a reverse-video cell

// review-state.ts — ReviewSessionState gains:
//   composing?: { fileId: string; anchor: LineAnchor; buffer: EditorBuffer; existingId?: string };
// UiAction gains:
//   | { type: "composing-key"; data: string }
//   | { type: "cancel-compose" }
// The `compose-comment` EFFECT is removed; `compose-comment` now enters composing state directly in the reducer.
```

## Behavior
- `c` sets `state.composing` for the cursor's file and anchor, prefilled with the existing comment's body when one is there (and `existingId` set so submitting replaces it). No effect is emitted and Pi's editor is never opened.
- While `state.composing` is set, `SourceControlView.handleInput` routes **every** keystroke to `{type:"composing-key", data}` instead of `actionForKey`. Normal bindings (`q`, `j`, `Tab`, …) do not fire while composing — typing `q` types a `q`.
- `applyKey` handles: printable characters (including multi-byte) insert at the caret; `backspace`/`delete`; `left`/`right`/`home`/`end` move the caret; `Enter` → `done: "submit"`; `Esc` → `done: "cancel"`; `Alt+Enter` inserts a literal newline. Unknown escape sequences are ignored, never inserted as text.
- On `submit` with non-empty trimmed text the reducer dispatches the equivalent of `add-comment` (replacing `existingId` when set) and clears `composing`. On `submit` with empty text, or on `cancel`, it clears `composing` and adds no comment.
- The editor renders as a comment-style row block under the anchored line (reusing spec 24's insertion point), prefixed `💬 ` and bordered with `fg("accent")`, with a hint row `Enter save · Esc cancel · Alt+Enter newline` in `fg("dim")`. It participates in row counts and width safety exactly like a comment row.
- The footer shows `Composing comment — Enter save · Esc cancel` while composing, replacing the usual hints.
- `composeComment` is removed from `SourceControlViewOptions`, and `editor` from `DiffCommandDeps` and `extension.ts`. `setEditorText`/`submitReview` stay — submitting the whole review still hands off to Pi's prompt.

## Tests
`test/unit/line-editor.test.ts`
- "typing inserts at the caret and backspace deletes before it"
- "arrow keys, home and end move the caret without changing text"
- "Enter submits and Esc cancels"
- "Alt+Enter inserts a newline instead of submitting"
- "unknown escape sequences are ignored rather than inserted"
- "renderBuffer wraps to the given width and never exceeds it"
`test/unit/review-state.test.ts`
- "c enters composing state instead of emitting an effect"
- "keys are routed to the buffer while composing and normal bindings do not fire"
- "submitting composing text adds the comment and clears composing state"
- "composing on a commented line prefills and replaces that comment"
- "cancelling composing adds no comment"
`test/unit/diff-command.test.ts`
- update: the adapter no longer requires an `editor` dependency

## Out of scope
- Multi-line scrolling inside the editor, syntax help, mouse, undo/redo.

## Done when
`pnpm check` exits 0 with 12 new tests passing and all existing tests passing or updated only for the removed `editor` dependency.

## Fixes

The spec above is implemented and `pnpm check` passes (276 tests). Do **only** the two fixes
below. Do not restructure, rename, or re-implement anything else; do not touch any file not
listed here.

### Fix 1 — remove the deep import into pi-tui's build output

`src/ui/line-editor.ts:4` currently imports from a path inside the package's build output:

```ts
import { decodePrintableKey } from "@earendil-works/pi-tui/dist/keys.js";
```

That resolves today only because the installed pi-tui has no `exports` map, and `package.json`
declares pi-tui as a peer dependency at `"*"`, so a future version that adds an `exports` map or
renames `dist/` breaks this at runtime rather than at install time.

- Delete that import. Import only from the package root `@earendil-works/pi-tui`
  (`decodeKittyPrintable`, `matchesKey`, `visibleWidth`).
- Add a module-private `decodeModifyOtherKeys(data: string): string | undefined` to
  `src/ui/line-editor.ts` that decodes the xterm modifyOtherKeys form `CSI 27 ; <mod> ; <code> ~`
  (that is, `\x1b[27;<mod>;<code>~`): accept modifier `1` (none) and `2` (shift) and return
  `String.fromCodePoint(code)`; return `undefined` for every other modifier (ctrl, alt, meta and
  combinations) and for any string that does not match the form exactly.
- In `applyKey`, the printable fallback becomes
  `decodeKittyPrintable(data) ?? decodeModifyOtherKeys(data) ?? plainPrintable(data)`.
- Behavior must be unchanged from today: `\x1b[27;2;65~` inserts `A`, `\x1b[27;1;97~` inserts `a`,
  `\x1b[27;5;97~` (ctrl) inserts nothing. Control code points (below 0x20, and 0x7f) must not be
  inserted even if a sequence names one.

### Fix 2 — keep the composer on screen when the terminal is resized

`followComposer` in `src/model/review-state.ts` runs on `compose-comment` and on each
`composing-key`, so the composer follows the buffer as it grows. But `SourceControlView.render`
recomputes the layout independently: shrinking the terminal while composing leaves the editor
below the viewport until the next keystroke.

- In `src/ui/source-control-view.ts`, re-apply the existing composer follow when the layout used
  for rendering differs from the previously rendered layout (`this.lastLayout`) and
  `state.composing` is set. Reuse the existing `composerRows` / follow machinery — do not
  duplicate the clamping logic in the view.
- The correction must happen before the frame is produced, so the resized frame itself already
  shows the composer; it must not recurse, and it must not invalidate the render cache on every
  frame when the layout is unchanged.

### Tests

`test/unit/line-editor.test.ts` (the file defines an `ESC` constant; follow that convention and
write no raw control characters into the source)
- "modifyOtherKeys printables are decoded without a deep package import"
  — `\x1b[27;2;65~` inserts `A`, `\x1b[27;1;97~` inserts `a`, `\x1b[27;5;97~` leaves the buffer
  unchanged.
- "malformed modifyOtherKeys sequences are ignored" — `\x1b[27;2~`, `\x1b[27;2;65` (no
  terminator) and `\x1b[27;2;9~` (a tab code point) each leave the buffer unchanged.

`test/unit/source-control-view.test.ts`
- "the composer stays on screen when the terminal shrinks mid-draft" — compose at the bottom of a
  long file at a tall height, then render at a shorter height; the rendered frame contains the
  composer's own hint row (`Alt+Enter newline`), not merely the footer banner.

### Done when

`pnpm check` exits 0 with 3 new tests passing, all 276 existing tests still passing, and
`grep -r "pi-tui/dist" src/` returning nothing.

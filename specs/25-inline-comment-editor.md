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

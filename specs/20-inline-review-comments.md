# 20 — Inline review comments sent to the agent

## Goal
Let the reviewer attach a comment to the line under the cursor, collect them across files, and send them to Pi as one message carrying exact location, code and scope. It removes the need to re-describe *where* something is when correcting the agent.

## Depends on
- 19-diff-line-cursor (`LineAnchor`, `cursorByFile`, `ReviewEnv.lineAnchors`)
- 12-review-state-and-input (`reduce`, `UiAction`, `ReviewEffect`)
- 13-source-control-view (`SourceControlView`, `SourceControlViewOptions`)
- 14-pi-extension-adapter (`runDiffCommand`, `DiffCommandDeps`)

## Files
- create `src/model/review-comment.ts`
- modify `src/model/review-state.ts`
- modify `src/ui/source-control-view.ts`
- modify `src/ui/footer-renderer.ts`
- modify `src/command/diff-command.ts` and `src/extension.ts`
- create `test/unit/review-comment.test.ts`; modify `test/unit/review-state.test.ts`

## Interfaces
```ts
// review-comment.ts
export type CommentIntent = "change" | "question";
export interface ReviewComment {
  id: string;                 // `${fileId}:${hunkIndex}:${lineIndex}:${createdAt}`
  fileId: string;
  filePath: string;           // newPath
  anchor: LineAnchor;
  intent: CommentIntent;
  oldLineNumber?: number;
  newLineNumber?: number;
  lineText: string;           // verbatim content of the anchored line
  contextText: string;        // the anchored line plus up to 3 lines either side, each prefixed with its diff marker
  scopeLabel: string;         // "working tree" | "staged changes" | "commit <short> (<subject>)" | "range <expression>"
  body: string;
  createdAt: number;
}
export function describeScope(review: DiffReview): string;
export function buildComment(input: { file: ChangedFile; anchor: LineAnchor; intent: CommentIntent; body: string; scopeLabel: string; now: number }): ReviewComment;
export function buildReviewMessage(comments: ReviewComment[]): string;

// review-state.ts — ReviewSessionState gains `comments: ReviewComment[]`
// UiAction gains:
//   | { type: "compose-comment"; intent: CommentIntent }
//   | { type: "add-comment"; comment: ReviewComment }
//   | { type: "delete-comment" }        // deletes the comment on the cursor line, if any
//   | { type: "submit-comments" }
// ReviewEffect gains:
//   | { type: "compose-comment"; intent: CommentIntent; file: ChangedFile; anchor: LineAnchor; existingBody?: string }
//   | { type: "submit-review"; message: string }

// source-control-view.ts — SourceControlViewOptions gains:
//   composeComment(prefill: string | undefined, intent: CommentIntent): Promise<string | undefined>;
//   submitReview(message: string): void;

// diff-command.ts — DiffCommandDeps gains:
//   editor(title: string, prefill?: string): Promise<string | undefined>;
//   setEditorText(text: string): void;
```

## Behavior
- Keys: `c` → `compose-comment` with intent `change`; `C` (shift+c) → intent `question`; `d` on a line that already has a comment → `delete-comment`; `S` (shift+s) → `submit-comments`. `c` with no cursor (no hunks, or a placeholder file) sets `notice = "Nothing to comment on here."` and does nothing.
- `compose-comment` emits an effect; the view calls `composeComment(existingBody, intent)` (Pi's multi-line editor). A non-empty result dispatches `add-comment`; `undefined` or an all-whitespace result is a no-op. Composing on a line that already has a comment prefills the existing body and **replaces** it.
- Comments are **queued, never sent one at a time.** `submit-comments` builds the message with `buildReviewMessage`, emits `submit-review`, clears `state.comments`, and then emits `close` — you leave the reviewer and land back in Pi with the message ready.
- `submit-comments` with an empty queue sets `notice = "No comments to submit."` and does not close.
- `submitReview(message)` in the Pi adapter calls `ctx.ui.setEditorText(message)` — it **prefills the prompt, it does not send**. The user reviews and presses enter. (`pi.sendUserMessage` is deliberately not used in this version.)
- `contextText` is built from the anchored line and up to 3 lines either side *within the same hunk*, each rendered as `<marker><content>` with the marker being one of `-`, `+`, or a space — i.e. it reads like a normal patch fragment.
- `buildReviewMessage` output, exactly:
  ```
  Review of <scopeLabel> — <n> comment(s) from /diff.

  1. <filePath>:<line> (<added|removed|context>) — <change requested|question>
     <contextText, indented 5 spaces>

     <body>

  2. ...
  ```
  `<line>` is `newLineNumber` when present, otherwise `oldLineNumber` prefixed with `-`. Comments are ordered by file path, then by `newLineNumber ?? oldLineNumber`. When comments span more than one scope, the header says `Review of multiple sources` and each entry appends ` [<scopeLabel>]`.
- The file list marks files with pending comments (a `●` in the reviewed-marker column when not reviewed); the footer shows `<n> comment(s) · S submit` when the queue is non-empty. The help overlay documents `c`, `C`, `d`, `S`.
- Comments are in-memory only: never written to the repo, and dropped on close without submitting. `refresh` (`g`) keeps comments whose file still exists with an unchanged `patchFingerprint`, and drops the rest with a notice naming how many were dropped.

## Tests
`test/unit/review-comment.test.ts`
- "buildComment captures line numbers, verbatim line text and surrounding patch context"
- "context stops at hunk boundaries"
- "describeScope labels working tree, staged, commit and range reviews"
- "buildReviewMessage numbers, orders and formats entries"
- "buildReviewMessage marks question intent differently from change requests"
- "buildReviewMessage labels each entry when comments span multiple scopes"
`test/unit/review-state.test.ts`
- "c on a line emits a compose-comment effect for that anchor"
- "add-comment queues a comment and a second comment on the same line replaces it"
- "d removes the comment on the cursor line"
- "submit-comments emits submit-review then close and clears the queue"
- "submit-comments with no comments sets a notice and does not close"
- "refresh keeps comments on unchanged patches and drops the rest"

## Out of scope
- Auto-sending the message (`pi.sendUserMessage`), multi-line/range selection, persisting comments across sessions, threading or replies, editing the message inside the reviewer.

## Done when
`pnpm check` exits 0 with 12 new tests passing and all existing tests passing.

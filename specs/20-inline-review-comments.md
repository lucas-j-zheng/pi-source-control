# 20 — Inline review comments sent to the agent

## Goal
Let the reviewer attach a comment to the line under the cursor, collect them across files, and hand them to Pi as one message carrying exact location, code and scope. It removes the need to re-describe *where* something is when correcting the agent.

## Depends on
- 19-diff-line-cursor (`LineAnchor`, `cursorByFile`, `ReviewEnv.lineAnchors`)
- 12-review-state-and-input (`reduce`, `UiAction`, `ReviewEffect`)
- 13-source-control-view (`SourceControlView`, `SourceControlViewOptions`)
- 14-pi-extension-adapter (`runDiffCommand`, `DiffCommandDeps`)

## Files
- create `src/model/review-comment.ts`
- modify `src/model/review-state.ts`
- modify `src/ui/source-control-view.ts`
- modify `src/ui/footer-renderer.ts` and `src/ui/file-list-renderer.ts`
- modify `src/command/diff-command.ts` and `src/extension.ts`
- create `test/unit/review-comment.test.ts`; modify `test/unit/review-state.test.ts`

## Interfaces
```ts
// review-comment.ts
export interface ReviewComment {
  id: string;                 // `${fileId}:${hunkIndex}:${lineIndex}`
  fileId: string;
  filePath: string;           // newPath
  anchor: LineAnchor;
  oldLineNumber?: number;
  newLineNumber?: number;
  lineKind: "context" | "addition" | "deletion";
  lineText: string;           // verbatim content of the anchored line
  contextText: string;        // anchored line plus up to 3 lines either side, each with its diff marker
  scopeLabel: string;         // "working tree" | "staged changes" | "commit <short> (<subject>)" | "range <expression>"
  body: string;
  createdAt: number;
}
export function describeScope(review: DiffReview): string;
export function buildComment(input: { file: ChangedFile; anchor: LineAnchor; body: string; scopeLabel: string; now: number }): ReviewComment;
export function buildReviewMessage(comments: ReviewComment[]): string;

// review-state.ts — ReviewSessionState gains `comments: ReviewComment[]`
// UiAction gains:
//   | { type: "compose-comment" }
//   | { type: "add-comment"; comment: ReviewComment }
//   | { type: "delete-comment" }        // deletes the comment on the cursor line, if any
//   | { type: "submit-comments" }
// ReviewEffect gains:
//   | { type: "compose-comment"; file: ChangedFile; anchor: LineAnchor; existingBody?: string }
//   | { type: "submit-review"; message: string }

// source-control-view.ts — SourceControlViewOptions gains:
//   composeComment(prefill: string | undefined): Promise<string | undefined>;
//   submitReview(message: string): void;

// diff-command.ts — DiffCommandDeps gains:
//   editor(title: string, prefill?: string): Promise<string | undefined>;
//   setEditorText(text: string): void;
```

## Behavior
- Keys: `c` → `compose-comment`; `d` on a line that already has a comment → `delete-comment` (no comment there is a no-op); `S` (shift+s) → `submit-comments`. `c` with no cursor (no hunks, or a binary/oversized placeholder) sets `notice = "Nothing to comment on here."`.
- `compose-comment` emits an effect; the view calls `composeComment(existingBody)`, which in the Pi adapter is `ctx.ui.editor("Comment on <file>:<line>", prefill)`. A non-empty trimmed result dispatches `add-comment`; `undefined` or whitespace-only is a no-op. Commenting on a line that already has a comment prefills the existing body and **replaces** it.
- Comments are **queued, never sent one at a time.** `submit-comments` builds the message with `buildReviewMessage`, emits `submit-review`, clears `state.comments`, then emits `close` — you land back in Pi with the message ready.
- `submit-comments` with an empty queue sets `notice = "No comments to submit."` and does not close.
- `submitReview(message)` in the adapter calls `ctx.ui.setEditorText(message)` — it **prefills the prompt, it does not send**. The user reviews and presses enter. `pi.sendUserMessage` is deliberately not used.
- `contextText` is the anchored line plus up to 3 lines either side *within the same hunk*, each rendered as `<marker><content>` where marker is `-`, `+`, or a space, so it reads as a patch fragment.
- `buildReviewMessage` output, exactly:
  ```
  Review of <scopeLabel> — <n> comment(s) from /diff.

  1. <filePath>:<line> (<added|removed|context>)
       <contextText, each line indented 5 spaces>

     <body>

  2. ...
  ```
  `<line>` is `newLineNumber` when present, otherwise `-<oldLineNumber>`. Comments are ordered by file path, then by `newLineNumber ?? oldLineNumber`. When comments span more than one scope the header reads `Review of multiple sources` and each entry appends ` [<scopeLabel>]`.
- The file list marks files with pending comments with `●` in the reviewed-marker column when the file is not already marked reviewed; the footer shows `<n> comment(s) · S submit` when the queue is non-empty. The help overlay documents `c`, `d`, `S`.
- Comments are in-memory only: never written to the repo, and dropped on close without submitting. `refresh` (`g`) keeps comments whose file still exists with an unchanged `patchFingerprint` and drops the rest, with a notice naming how many were dropped.

## Tests
`test/unit/review-comment.test.ts`
- "buildComment captures line numbers, verbatim line text and surrounding patch context"
- "context stops at hunk boundaries"
- "describeScope labels working tree, staged, commit and range reviews"
- "buildReviewMessage numbers, orders and formats entries"
- "buildReviewMessage labels each entry when comments span multiple scopes"
`test/unit/review-state.test.ts`
- "c on a line emits a compose-comment effect for that anchor"
- "add-comment queues a comment and a second comment on the same line replaces it"
- "c with no anchorable line sets a notice"
- "d removes the comment on the cursor line"
- "submit-comments emits submit-review then close and clears the queue"
- "submit-comments with no comments sets a notice and does not close"
- "refresh keeps comments on unchanged patches and drops the rest"

## Out of scope
- Auto-sending the message, comment intents/types, multi-line range selection, persisting comments across sessions, threading, editing the assembled message inside the reviewer.

## Done when
`pnpm check` exits 0 with 12 new tests passing and all existing tests passing.

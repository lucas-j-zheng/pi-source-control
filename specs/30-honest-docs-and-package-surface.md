# 30 — The README tells the truth and the package surface is deliberate

## Goal
Make every claim a stranger reads before installing match what the code does, and freeze a minimal
public surface before a version number becomes permanent. The README currently says the extension
makes no model calls, which stopped being true when `Shift+S` began sending review content to the
agent, and it documents an install command that cannot work from npm.

## Depends on
- 15-package-and-docs (`package.json` manifest fields, `test/unit/package-manifest.test.ts`)
- 23-review-message-orchestration (`buildReviewMessage`, `renderPlan`)

## Files
- modify `README.md`
- modify `package.json`
- modify `src/ui/footer-renderer.ts`
- modify `src/command/review-delivery.ts`
- modify `specs/00-architecture.md`, `specs/20-inline-review-comments.md`
- modify `test/unit/package-manifest.test.ts`, `test/unit/review-delivery.test.ts`

## Interfaces
```ts
// package.json gains an explicit surface
//   "exports": { ".": "./src/extension.ts" }
//   "peerDependencies": { "@earendil-works/pi-coding-agent": "^0.84.1", "@earendil-works/pi-tui": "^0.84.1" }
```

## Behavior
- **Install.** The README documents `pi install npm:@lucas-j-zheng/pi-source-control`, with the pinned
  form and the local-checkout form as alternatives, and uses the scoped name throughout.
- **Honest safety section.** The "no network or model calls" claim is replaced by an accurate one:
  the extension itself makes no network calls, and `Shift+S` — only on that keypress — sends the
  review to the user's configured agent, which will call their model provider. It states exactly what
  is included: file paths, line numbers, the anchored source line, and the comment text.
  It also discloses that comment text and diff content pass through the user's agent, and that the
  extension reads untracked files from disk.
- **Accurate limits.** The size-limit bullet describes the real behavior per reader rather than one
  invented universal 1 MiB rule.
- **Accurate keys.** `PageUp`/`PageDown` and `Home`/`End` are documented as acting on the focused
  pane; `Ctrl+E`/`Ctrl+Y` and `Shift+↑`/`Shift+↓` are documented as diff-only. The footer help line
  for `S` says the review is sent to the agent, not "to the prompt".
- **Honest delivery notice.** Because `pi.sendUserMessage` is fire-and-forget and its failures are
  caught inside Pi, `deliverReview` no longer claims success it cannot observe: the notice reads
  `Review sent to the agent — N comments` only when the call returned without throwing, and the
  fallback path stays as it is.
- **Package surface.** `package.json` declares `exports` so only the extension entry is importable,
  and pins peer ranges to `^0.84.1` instead of `*`.
- **Dead code.** Remove `ReviewEnv.hunkRows`, `state.maximizedDiff`, `state.selectedHunkByFile`,
  `ReviewComment.contextText`, the unused `actionForKey` parameters, the `rev-list` allowlist entry,
  and `test/unit/smoke.test.ts`. Keep the hit-target subsystem — it is spec 13's contract for a
  pointer future — but note in `specs/00-architecture.md` that it has no dispatcher.
- **Spec drift.** Spec 20's "prefills the prompt, it does not send" paragraph and spec 00's import
  rules are corrected to match the code, each with a line naming the spec that superseded them.

## Tests
`test/unit/package-manifest.test.ts`
- "the manifest declares an exports map and pinned peer ranges"
- "the README documents the npm install command and the published package name"
- "the README does not claim the extension makes no model calls"
- "every keybinding in the README maps to a real binding, and every binding is documented"
`test/unit/review-delivery.test.ts`
- update: the sent notice wording, and that a fire-and-forget send still notifies exactly once

## Out of scope
Publishing. Screenshots. Any behavior change to git execution, sanitization, session state, or
performance — those are specs 26–29.

## Done when
`pnpm check` exits 0 with 5 new tests passing, and `grep -n "no network or model calls" README.md`
returns nothing.

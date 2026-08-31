# Full review — @lucas-j-zheng/pi-source-control v0.2.0

**Date:** 2026-08-30 · **Commit:** de92831 (+ uncommitted publish prep in `package.json`)
**Method:** 6 dimensions × 2 model families (Claude opus + Codex) = 12 independent reviews,
then 2 adversarial cross-verification passes. 298 tests green throughout.
**Trigger:** pre-publish audit — this package is about to be installable by strangers via
`pi install`, running with full system access, at a version number that can never be reissued.

## 1. Summary

The core is better than its surface. `assertReadOnly` is airtight under mutation testing, revision
handling is genuinely careful (validate → `--end-of-options` → resolve to 40-hex OID → only the OID
reaches later commands), the side-by-side aligner and its anchor map were fuzzed over 400 random
files with zero disagreement, and there is no network, no filesystem write, and no runtime
dependency anywhere in `src`.

What is not ready is everything at the edges: the process boundary (a timed-out git command is
reported as success), the terminal boundary (repository bytes are re-emitted as control sequences),
the agent boundary (repository bytes enter a user-role turn), and the documentation that promises
strangers none of this happens.

**Fix before publishing, in order:**
1. **Timeouts are reported as success** — a truncated or empty diff is presented as complete.
2. **Sanitize repository content** before it reaches the terminal or the agent.
3. **Correct the README** — "makes no network or model calls" is now false.

## 2. Findings

| # | Sev | Location | Claim | Raised by | Verdict |
|---|---|---|---|---|---|
| 1 | critical | `src/command/diff-command.ts:47` | `killed` is dropped, so a timed-out/aborted git command returns partial stdout as success | opus-sec (repro), codex-tests, opus-tests | CONFIRMED |
| 2 | critical | `src/model/review-state.ts:385` | `setDiffViewportOffset` is O(N²); every scroll key rebuilds the row model per anchor | opus-arch (measured) | CONFIRMED by codex (852 ms @500 lines, 15 s @2000) |
| 3 | high | `src/git/untracked-file.ts:92-99` | Containment + isFile guards can both be deleted with all 298 tests still green; proven out-of-repo read | opus-tests (mutation) | CONFIRMED |
| 4 | high | `src/diff/line-slicing.ts:34`, `unified-parser.ts:338` | Repo content and filenames re-emit raw ANSI/OSC/CR; `decodeQuotedPath` *un-escapes* what git quoted for safety | codex-sec, opus-sec (repro), codex-tests, codex-docs | CONFIRMED |
| 5 | high | `src/command/diff-command.ts:51` | Shipped runner omits `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, `--no-textconv`; `git status` rewrote `.git/index`, textconv executed a command | codex-sec, opus-sec (repro), opus-data | CONFIRMED |
| 6 | high | `README.md:116` | "The extension makes no network or model calls" is false — `Shift+S` sends repo content to the user's model | opus-docs, codex-docs | CONFIRMED (both families) |
| 7 | high | `src/model/review-comment.ts:140` | Repo line text enters a **user-role** turn verbatim, at the user's authority, to an agent with command access | codex-sec, opus-sec, codex-docs | CONFIRMED |
| 8 | high | `src/ui/source-control-view.ts:1250` | `applyRefresh` keys fingerprints by scope-less `comment.id`; `g` silently drops a comment | codex-corr, codex-data, opus-arch, opus-corr (repro), codex-arch | CONFIRMED (5 legs) |
| 9 | high | `patch-fingerprint.ts:3` + 4 call sites | Every placeholder file hashes `sha1("")`; marking one reviewed marks all | codex-data, opus-data (repro), opus-corr (repro), codex-tests | CONFIRMED |
| 10 | high | `src/ui/input-controller.ts:44` | `q` / `Esc` / `h` / Backspace discard every queued comment with no warning | opus-corr (repro) | CONFIRMED by codex |
| 11 | high | `src/ui/source-control-view.ts:1110` | One failed commit load wedges that commit for the session; it renders "No changes" | codex-corr, opus-arch, opus-corr (repro) | CONFIRMED |
| 12 | high | `commit-review-reader.ts:76`, `range-review-reader.ts:62` | No size cap outside the workspace reader; 52 MB untracked → 887 MB RSS | codex-data, codex-sec, opus-data (repro), opus-sec (measured) | CONFIRMED |
| 13 | high (Linux) | `src/diff/unified-parser.ts:338` | Invalid-UTF-8 filenames collapse to one id: wrong file's diff shown, comments misattributed, file list deadlocks | codex-data | CONFIRMED by opus, impact worse than claimed |
| 14 | high | `src/extension.ts:108` | `register()`'s handler is never invoked by any test; the `pi → sendUserMessage` bridge is unexercised | opus-tests (mutation) | CONFIRMED |
| 15 | high | `src/model/review-state.ts:174` | 9 of `finish()`'s 18 key comparisons can be deleted with the suite green | opus-tests (mutation) | CONFIRMED |
| 16 | med-high | `src/diff/unified-parser.ts:267` | `a/`/`b/` prefixes are hard-coded but never pinned; user gitconfig corrupts paths | opus-data (repro) | CONFIRMED by codex, **scope corrected** |
| 17 | medium | `src/ui/source-control-view.ts:345` | `renderCache` keyed on monotonic `version`, never evicted | opus-arch, opus-sec, opus-corr (repro), codex-arch | CONFIRMED |
| 18 | medium | `src/ui/source-control-view.ts:1393` | Two identical error notices leave a pane frozen on `Loading…` | opus-arch | CONFIRMED by codex |
| 19 | medium | `src/command/review-delivery.ts:52` | `pi.sendUserMessage` is fire-and-forget; "Review sent" prints even if the send fails | codex-tests | CONFIRMED (known) |
| 20 | medium | `README.md:8-12,108` | Install command is the local-path form; package name absent; size limits described wrongly | opus-docs, codex-docs | CONFIRMED |
| 21 | medium | `package.json:12` | No `exports` map: every internal module is deep-importable and becomes de-facto permanent API | opus-arch | CONFIRMED |
| 22 | medium | `untracked-file.ts:18` vs `unified-parser.ts:259` | Opposite CRLF policies; untracked files keep raw `CR` into terminal and agent message | codex-data, opus-data | CONFIRMED |
| 23 | med-low | `src/model/review-state.ts:49` | Per-file cursor/scroll state collides across commits | codex-arch | HALF-CONFIRMED — collision real, comment corruption refuted |
| 24 | low | `src/ui/synced-scroll-view.ts:26` | `scrollTo` is not overridden, so scrollbar drags snap back | codex-tests | CONFIRMED by opus |
| 25 | low | `src/git/untracked-file.ts:88` | lstat→readFile TOCTOU; raced 2 leaks in 109k attempts | codex-sec | CONFIRMED, severity lowered |
| 26 | low | various | Dead code: `hunkRows`, `maximizedDiff`, `selectedHunkByFile`, `contextText`, hit-target subsystem, `rev-list`, `smoke.test.ts` | opus-arch, codex-arch | CONFIRMED |

## 3. Model disagreement log

- **Hunk counts never reconciled** (codex-data, medium) → **REFUTED** by opus. The fact is true —
  `@@ -1,5 +1,5 @@` with one line parses silently — but `oldCount`/`newCount` are write-only
  (4 references, all type declarations), line numbers are walked from real lines, and anchors are
  positional. Git's own stdout is self-consistent and no truncation path re-parses. Not a bug.
- **Wrong-line comments from id collisions** (codex-arch) → **REFUTED**. `commentTargets` already
  requires a matching `scopeLabel`; both comments are kept and each describes the line it is on.
  The authors had handled this; the cursor/scroll collision is real but cosmetic.
- **"noprefix corrupts every path"** (opus-data) → **corrected by codex**: `diff.noprefix` only
  corrupts paths containing whitespace; `mnemonicPrefix` and custom prefixes corrupt ordinary paths.
- **O(N²) magnitude** (opus-arch: 6.7 s @500) → codex measured 852 ms @500, 15 s @2000. Quadratic
  growth confirmed by both (4× per doubling); the conservative numbers are used above.
- **TOCTOU severity** (codex-sec: medium) → lowered to low by opus: winning the race requires an
  attacker already executing as this user, for whom reading the secret directly is easier.

## 4. What is solid

Verified by mutation testing and fuzzing, not assertion:

- `assertReadOnly` — allowlist bypass, added `push`/`commit`/`checkout`, and removing the throw were
  each killed by two tests.
- Revision handling — double validation, `--end-of-options`, 40-hex resolution before any patch command.
- `review-delivery.ts` — all six mutations killed; "never delivers without notifying" is a real invariant.
- The SBS aligner vs `anchorsForHunkRows` — 400 random files fuzzed, zero disagreements.
- `line-editor.ts` paste handling — 8 of 9 mutations killed.
- `pi-submit-lifecycle.test.ts` — its fake was checked against Pi's real source and matches, `setImmediate`
  ordering included. It is the standard the untested seams should be held to.
- Untracked containment defeats the steady-state symlink, directory-symlink and `../` traversal cases.
- No network, no writes, no `eval`, no shell, no runtime dependencies; the `files` whitelist is clean.

## 5. Coverage

| Dimension | Claude (opus) | Codex |
|---|---|---|
| correctness | ✅ | ✅ |
| data-integrity | ✅ | ✅ |
| security | ✅ | ✅ |
| tests | ✅ (121 mutations, 56 survived) | ✅ |
| architecture | ✅ | ✅ |
| docs/spec drift | ✅ | ✅ |

Cross-verification: codex on 4 Claude-only findings (3 confirmed, 1 confirmed-with-correction);
opus on 5 codex-only findings (3 confirmed, 1 refuted, 1 half-confirmed).
Two codex legs could not start vitest under the read-only sandbox and reviewed statically;
one Claude leg's early runs were contaminated by a sibling's stray `vitest.config.mjs` and were re-run.

# 17 — Fast-scroll keys

## Goal
Add vim-style accelerated navigation (`J`/`K` = 5 lines, `Ctrl+D`/`Ctrl+U` = half page) so long diffs can be traversed quickly without the mouse. Keyboard is the only input path (see README "Mouse").

## Depends on
- 12-review-state-and-input (`actionForKey` in `src/ui/input-controller.ts`; `reduce`, `UiAction` `move`/`page` in `src/model/review-state.ts`)
- 15-package-and-docs (README keyboard table; `test/unit/package-manifest.test.ts` asserts every documented key appears)

## Files
- modify `src/model/review-state.ts` — add `{ type: "half-page"; delta: number }` to `UiAction`
- modify `src/ui/input-controller.ts`
- modify `src/ui/footer-renderer.ts` — help overlay lists the new keys
- modify `README.md` — keyboard table rows
- modify `test/unit/input-controller.test.ts`, `test/unit/review-state.test.ts`

## Interfaces
No new exports. `actionForKey` gains mappings; `reduce` handles `half-page`.

## Behavior
- `J` (shift+j) → `{ type: "move", delta: 5 }`; `K` → `{ type: "move", delta: -5 }`. Applies to whichever pane is focused (lists move selection by 5, clamped; diff scrolls 5 rows, clamped) — reuse the existing `move` semantics, no new reducer branch.
- `Ctrl+D` → `{ type: "half-page", delta: 1 }`; `Ctrl+U` → `{ type: "half-page", delta: -1 }`. Reducer: same as `page` but the step is `max(1, floor(bodyHeight / 2))`. On lists it moves selection; on the diff it scrolls; clamped like `page`.
- Lowercase `j`/`k`, `PageDown`/`PageUp`, and all other bindings are unchanged.
- Help overlay (`?`) shows two new lines: `J / K  Move 5 lines` and `Ctrl+D / Ctrl+U  Half page`.
- README keyboard table gains the same two rows right after the `j` / `k` row.

## Tests
`test/unit/input-controller.test.ts`
- "shift+j and shift+k map to five-line moves"
- "ctrl+d and ctrl+u map to half-page actions"
- "lowercase j and k still move one line"
`test/unit/review-state.test.ts`
- "half-page scrolls the diff by half the body height and clamps"
- "half-page moves list selection by half the body height"
- "five-line move clamps at list and diff bounds"

## Out of scope
- Any mouse handling. Rebindable keys. Changing existing bindings.

## Done when
`pnpm check` exits 0 with 6 new tests passing and all existing tests (including package-manifest README checks) passing.

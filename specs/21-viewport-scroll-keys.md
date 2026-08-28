# 21 — Viewport scroll keys

## Goal
Add keys that move the diff viewport without moving the line cursor, restoring the pre-cursor "just scroll the screen" feel. Reading around a line you are about to comment on should not drag your anchor with it.

## Depends on
- 19-diff-line-cursor (`LineAnchor`, `cursorByFile`, `ReviewEnv.lineAnchors`/`rowForAnchor`)
- 12-review-state-and-input (`reduce`, `UiAction`, `actionForKey`)

## Files
- modify `src/model/review-state.ts`
- modify `src/ui/input-controller.ts`
- modify `src/ui/footer-renderer.ts`
- modify `README.md`
- modify `test/unit/review-state.test.ts`, `test/unit/input-controller.test.ts`, `test/unit/list-renderers.test.ts`

## Interfaces
```ts
// review-state.ts — UiAction gains:
//   | { type: "scroll-view"; delta: number }   // delta is in rows, positive = down
```

## Behavior
- Keys (all four verified to parse with `matchesKey`): `Ctrl+E` and `shift+down` → `{type:"scroll-view", delta: 1}`; `Ctrl+Y` and `shift+up` → `{type:"scroll-view", delta: -1}`. Both spellings are bound because `Ctrl+E`/`Ctrl+Y` is vim muscle memory while `shift`+arrow is discoverable; some terminals do not send distinct shift+arrow sequences, which is why the ctrl pair is the primary binding.
- `scroll-view` applies only when the diff pane is focused; on the source or file list it is a no-op (no state change, no notice).
- It changes the selected file's entry in `verticalOffsetByFile` by `delta` rows, clamped to `[0, max(0, rowCount - layout.bodyHeight)]`. It never changes `selectedFileId`, `focusedPane` or `selectedHunkByFile`.
- **Cursor visibility rule (applies to `scroll-view` and to the existing `set-scroll` wheel action):** after the viewport moves, if the cursor's row is outside `[offset, offset + bodyHeight)`, the cursor is pulled to the nearest anchorable line inside the viewport — the first visible anchorable line when scrolling down, the last when scrolling up. The cursor is never left off-screen, so `c` (spec 20) can never target a line you cannot see. This **changes** the existing test "wheel scrolling moves the viewport without moving the cursor"; rewrite it to assert the pull-into-view behavior rather than deleting it.
- If the file has no anchorable lines (placeholder, binary, oversized) the action still scrolls and leaves the cursor undefined.
- Help overlay adds `Ctrl+E / Ctrl+Y  Scroll view (cursor stays)` and `Shift+↑ / Shift+↓  Scroll view`; README gains the same two rows after the `←`/`→` row.

## Tests
`test/unit/input-controller.test.ts`
- "ctrl+e and ctrl+y map to scroll-view"
- "shift+up and shift+down map to scroll-view"
`test/unit/review-state.test.ts`
- "scroll-view moves the viewport without moving the cursor while it stays visible"
- "scroll-view pulls the cursor into view once it would scroll off"
- "scroll-view clamps at the top and bottom of the diff"
- "scroll-view is a no-op on the source and file lists"
- "wheel scrolling also pulls the cursor into view"
`test/unit/list-renderers.test.ts`
- update the help-overlay length assertion and assert both new rows are present

## Out of scope
- Horizontal viewport keys, scroll-view in side-by-side-specific ways (it uses the same row model), mouse.

## Done when
`pnpm check` exits 0 with 7 new tests passing and all existing tests passing or updated only for the cursor-visibility rule.

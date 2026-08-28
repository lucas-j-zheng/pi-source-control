# 18 — Alternate back/enter keys

## Goal
Add `Backspace` and `h` as "back one level" keys and `l` as "enter" so narrow-mode navigation does not depend on `Esc`, which terminals deliver ambiguously. Existing `Esc`/`Enter` behavior is unchanged.

## Depends on
- 12-review-state-and-input (`actionForKey` in `src/ui/input-controller.ts`; `back`/`enter` actions)
- 17-fast-scroll-keys (help overlay and README key rows, `test/unit/package-manifest.test.ts` README check)

## Files
- modify `src/ui/input-controller.ts`
- modify `src/ui/footer-renderer.ts` — help overlay rows
- modify `README.md` — keyboard table rows
- modify `test/unit/input-controller.test.ts`, `test/unit/list-renderers.test.ts` (help line count)

## Interfaces
No new exports.

## Behavior
- `Backspace` (`matchesKey(data, "backspace")`) and `h` → `{ type: "back" }` — identical semantics to `Esc` (narrow: diff → files → sources; at sources or in two-pane modes: close).
- `l` → `{ type: "enter" }` — identical to `Enter`.
- Uppercase `H`/`L` are not bound. `←`/`→` keep horizontal scrolling.
- Help overlay adds: `h / Backspace  Back a level` and `l  Enter selected` (placed right after the `Esc` row). README table adds the same two rows after the `Esc` row.

## Tests
`test/unit/input-controller.test.ts`
- "backspace and h map to back"
- "l maps to enter"
- "escape and enter are unchanged"
`test/unit/list-renderers.test.ts`
- update the help-overlay length assertion (18 → 20) and assert both new rows are present

## Out of scope
- Rebinding, mouse, any reducer change.

## Done when
`pnpm check` exits 0 with 3 new tests and all existing tests passing.

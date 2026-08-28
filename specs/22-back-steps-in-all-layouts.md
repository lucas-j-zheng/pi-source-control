# 22 — Back steps focus in every layout

## Goal
Make `Esc` / `h` / `Backspace` step focus back one level (diff → files → sources) in **all** layout modes, closing only from the sources level. Today they step back only in narrow mode and close outright in wide/medium, so "go back one" destroys the whole review session.

## Depends on
- 12-review-state-and-input (`reduce`, the `back` action)
- 18-vim-back-keys (`h` / `Backspace` bindings)

## Files
- modify `src/model/review-state.ts`
- modify `src/ui/footer-renderer.ts`
- modify `README.md`
- modify `test/unit/review-state.test.ts`, `test/unit/source-control-view.test.ts`, `test/unit/list-renderers.test.ts`

## Interfaces
No new exports. The `back` action's behavior changes.

## Behavior
- `back` when `focusedPane === "diff"` → focus `files`. When `focusedPane === "files"` → focus `sources`. When `focusedPane === "sources"` → emit the `close` effect. **This applies in wide, medium and narrow modes identically**; the current `layout.mode === "narrow"` condition is removed.
- `back` never changes `selectedSourceId`, `selectedFileId`, scroll offsets or the line cursor — it only moves focus (and closes from sources).
- `q` (`close`) still closes immediately from any pane; that is the single-keystroke exit.
- Help overlay and README wording for `Esc` changes to `Back a level (closes from the source list)`, and the `h` / `Backspace` row matches.
- The existing narrow-mode walk (diff → files → sources → close) is unchanged in effect; it is now simply the universal rule.

## Tests
`test/unit/review-state.test.ts`
- "back steps diff to files to sources in wide mode then closes" (layout width 160)
- "back steps the same way in medium and narrow modes" (widths 110 and 60)
- "back preserves selection, scroll offsets and the line cursor"
- "q closes immediately from every pane"
- update the existing narrow-mode back/close test to the new universal wording rather than deleting it
`test/unit/source-control-view.test.ts`
- update "narrow mode renders one pane and Enter/Esc walk the screens" if it asserts the old wide-mode close, and add "Esc from the diff pane in wide mode returns focus to the file list without closing"
`test/unit/list-renderers.test.ts`
- update the help-overlay text assertion for the reworded `Esc` row

## Out of scope
- Changing `q`, `Tab`/`Shift+Tab`, or any other binding. Maximize/restore behavior.

## Done when
`pnpm check` exits 0 with the new tests passing and every existing test passing or updated only for the reworded help text and the new back semantics.

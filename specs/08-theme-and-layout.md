# 08 — Styler and layout calculator

## Goal
Define the color seam renderers use and compute the responsive pane geometry from width/height. Every later renderer takes a `Styler` and a `Layout`, so both must be pure and fully testable.

## Depends on
none (constants from `specs/00-architecture.md` "Layout constants").

## Files
- create `src/ui/theme.ts`
- create `src/ui/layout.ts`
- create `test/unit/layout.test.ts`

## Interfaces
```ts
// theme.ts
export type FgRole = "accent"|"borderAccent"|"borderMuted"|"muted"|"dim"|"text"|"warning"|"error"|"success"|"toolDiffAdded"|"toolDiffRemoved"|"toolDiffContext";
export type BgRole = "selectedBg";
export interface Styler { fg(role: FgRole, text: string): string; bg(role: BgRole, text: string): string; bold(text: string): string; }
export const plainStyler: Styler; // identity — used in tests
export function stylerFromTheme(theme: { fg(c: any, t: string): string; bg(c: any, t: string): string; bold(t: string): string }): Styler;

// layout.ts
export type LayoutMode = "wide" | "medium" | "narrow";
export interface Layout {
  mode: LayoutMode;
  width: number; height: number;
  leftWidth: number;   // 0 in narrow mode
  rightWidth: number;  // width - leftWidth - 1 (divider) in wide/medium; width in narrow
  bodyHeight: number;  // rows available for panes (>= 6)
  headerRows: number;  // 1
  footerRows: number;  // 1
  sideBySideAllowed: boolean;
  compactFooter: boolean; // height < 12
}
export const WIDE_MIN = 130; export const MEDIUM_MIN = 90;
export const MIN_BODY_HEIGHT = 6; export const MIN_SBS_CODE_WIDTH = 30;
export const UNIFIED_GUTTER_WIDTH = 11;  // "OOOO NNNN M" : two 4-wide numbers + spaces + marker
export const SBS_GUTTER_WIDTH = 6;       // per side: 4-wide number + space + marker
export function computeLayout(width: number, height: number): Layout;
export function leftPaneWidth(width: number): number; // clamp(round(width*0.30), 28, 34), capped at floor(width*0.35)
```

## Behavior
- `mode`: width ≥130 wide, 90–129 medium, else narrow.
- Wide/medium: `leftWidth = leftPaneWidth(width)`, `rightWidth = width - leftWidth - 1`. Narrow: `leftWidth = 0`, `rightWidth = width`.
- `bodyHeight = max(MIN_BODY_HEIGHT, height - headerRows - footerRows - 2)` (2 = top and bottom border rows).
- `compactFooter = height < 12`.
- `sideBySideAllowed` = mode !== narrow and `floor((rightWidth - 1)/2) - SBS_GUTTER_WIDTH >= MIN_SBS_CODE_WIDTH`.
- `plainStyler` returns text unchanged; `stylerFromTheme` forwards each call.
- Never returns negative or NaN widths for width ≥ 20; for width < 20 clamp `rightWidth` to ≥ 1.

## Tests
`test/unit/layout.test.ts`
- "classifies wide, medium and narrow at the boundaries" (89→narrow, 90→medium, 129→medium, 130→wide)
- "left pane width is between 28 and 34 and at most 35 percent" for widths 90,110,129,130,160,220
- "narrow layout has no left pane and full-width right pane"
- "pane widths plus divider equal terminal width in two-pane modes"
- "body height respects the minimum of six rows" (height 8 → 6)
- "compact footer below twelve rows"
- "side-by-side allowed only when both columns fit" (220 → true; 90 → false; 130 → compute and assert against formula)
- "plainStyler is identity"

## Out of scope
- Rendering anything.

## Done when
`pnpm check` exits 0 with 8 new tests passing.

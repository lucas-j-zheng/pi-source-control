export type LayoutMode = "wide" | "medium" | "narrow";

export interface Layout {
  mode: LayoutMode;
  width: number;
  height: number;
  leftWidth: number;
  rightWidth: number;
  bodyHeight: number;
  headerRows: number;
  footerRows: number;
  sideBySideAllowed: boolean;
  compactFooter: boolean;
}

export const WIDE_MIN = 130;
export const MEDIUM_MIN = 90;
export const MIN_BODY_HEIGHT = 6;
export const MIN_SBS_CODE_WIDTH = 30;
export const UNIFIED_GUTTER_WIDTH = 11;
export const SBS_GUTTER_WIDTH = 6;

export function leftPaneWidth(width: number): number {
  const proportionalWidth = Math.round(width * 0.3);
  const clampedWidth = Math.max(28, Math.min(34, proportionalWidth));

  return Math.min(clampedWidth, Math.floor(width * 0.35));
}

export function computeLayout(width: number, height: number): Layout {
  const mode: LayoutMode =
    width >= WIDE_MIN ? "wide" : width >= MEDIUM_MIN ? "medium" : "narrow";
  const headerRows = 1;
  const footerRows = 1;
  const leftWidth = mode === "narrow" ? 0 : leftPaneWidth(width);
  const rightWidth =
    mode === "narrow" ? Math.max(1, width) : Math.max(1, width - leftWidth - 1);
  const bodyHeight = Math.max(
    MIN_BODY_HEIGHT,
    height - headerRows - footerRows - 2,
  );
  const sideBySideAllowed =
    mode !== "narrow" &&
    Math.floor((rightWidth - 1) / 2) - SBS_GUTTER_WIDTH >=
      MIN_SBS_CODE_WIDTH;

  return {
    mode,
    width,
    height,
    leftWidth,
    rightWidth,
    bodyHeight,
    headerRows,
    footerRows,
    sideBySideAllowed,
    compactFooter: height < 12,
  };
}

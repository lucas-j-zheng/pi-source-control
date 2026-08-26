import { describe, expect, it } from "vitest";

import {
  MIN_SBS_CODE_WIDTH,
  SBS_GUTTER_WIDTH,
  computeLayout,
  leftPaneWidth,
} from "../../src/ui/layout.ts";
import { plainStyler } from "../../src/ui/theme.ts";

describe("layout", () => {
  it("classifies wide, medium and narrow at the boundaries", () => {
    expect(computeLayout(89, 24).mode).toBe("narrow");
    expect(computeLayout(90, 24).mode).toBe("medium");
    expect(computeLayout(129, 24).mode).toBe("medium");
    expect(computeLayout(130, 24).mode).toBe("wide");
  });

  it("left pane width is between 28 and 34 and at most 35 percent", () => {
    for (const width of [90, 110, 129, 130, 160, 220]) {
      const paneWidth = leftPaneWidth(width);

      expect(paneWidth).toBeGreaterThanOrEqual(28);
      expect(paneWidth).toBeLessThanOrEqual(34);
      expect(paneWidth).toBeLessThanOrEqual(Math.floor(width * 0.35));
    }
  });

  it("narrow layout has no left pane and full-width right pane", () => {
    const layout = computeLayout(89, 24);

    expect(layout.leftWidth).toBe(0);
    expect(layout.rightWidth).toBe(89);
  });

  it("pane widths plus divider equal terminal width in two-pane modes", () => {
    for (const width of [90, 129, 130, 220]) {
      const layout = computeLayout(width, 24);

      expect(layout.leftWidth + layout.rightWidth + 1).toBe(width);
    }
  });

  it("body height respects the minimum of six rows", () => {
    expect(computeLayout(90, 8).bodyHeight).toBe(6);
  });

  it("compact footer below twelve rows", () => {
    expect(computeLayout(90, 11).compactFooter).toBe(true);
    expect(computeLayout(90, 12).compactFooter).toBe(false);
  });

  it("side-by-side allowed only when both columns fit", () => {
    expect(computeLayout(220, 24).sideBySideAllowed).toBe(true);
    expect(computeLayout(90, 24).sideBySideAllowed).toBe(false);

    const layout = computeLayout(130, 24);
    const expected =
      Math.floor((layout.rightWidth - 1) / 2) - SBS_GUTTER_WIDTH >=
      MIN_SBS_CODE_WIDTH;
    expect(layout.sideBySideAllowed).toBe(expected);
  });

  it("plainStyler is identity", () => {
    expect(plainStyler.fg("accent", "text")).toBe("text");
    expect(plainStyler.bg("selectedBg", "text")).toBe("text");
    expect(plainStyler.bold("text")).toBe("text");
  });
});

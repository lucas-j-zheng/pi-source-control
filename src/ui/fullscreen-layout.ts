import {
  HStack,
  VStack,
  type Component,
  type StackChild,
} from "@earendil-works/pi-tui";

import type { FocusedPane } from "../model/review-state.ts";
import type { Layout } from "./layout.ts";
import type { SyncedScrollView } from "./synced-scroll-view.ts";
import type { Styler } from "./theme.ts";

export interface PaneContent {
  render(width: number): string[];
  invalidate(): void;
}

export interface FullscreenPanes {
  sources: SyncedScrollView;
  files: SyncedScrollView;
  diff: SyncedScrollView;
}

export interface FullscreenTreeInput {
  layout: Layout;
  focusedPane: FocusedPane;
  header: PaneContent;
  footer: PaneContent;
  panes: FullscreenPanes;
  styler: Styler;
}

class StaticContent implements Component {
  constructor(private readonly renderLines: (width: number) => string[]) {}

  render(width: number): string[] {
    return this.renderLines(width);
  }

  invalidate(): void {}
}

function border(
  layout: Layout,
  focusedPane: FocusedPane,
  styler: Styler,
  edge: "top" | "bottom",
): Component {
  return new StaticContent(() => {
    if (layout.mode === "narrow") {
      return [styler.fg("borderAccent", "─".repeat(layout.width))];
    }
    const leftRole =
      focusedPane === "diff" ? "borderMuted" : "borderAccent";
    const rightRole =
      focusedPane === "diff" ? "borderAccent" : "borderMuted";
    return [
      styler.fg(leftRole, "─".repeat(layout.leftWidth)) +
        styler.fg("borderMuted", edge === "top" ? "┬" : "┴") +
        styler.fg(rightRole, "─".repeat(layout.rightWidth)),
    ];
  });
}

function divider(
  layout: Layout,
  focusedPane: FocusedPane,
  styler: Styler,
): Component {
  return new StaticContent(() => {
    const role = focusedPane === "diff" ? "borderAccent" : "borderMuted";
    return Array.from({ length: layout.bodyHeight }, () =>
      styler.fg(role, "│"),
    );
  });
}

function body(input: FullscreenTreeInput): Component {
  const { layout, panes } = input;
  if (layout.mode === "narrow") return panes[input.focusedPane];

  const sourceRows = Math.min(
    panes.sources.render(layout.leftWidth).length,
    Math.floor(layout.bodyHeight / 2),
  );
  const leftColumn = new VStack([
    { component: panes.sources, basis: sourceRows, shrink: 0 },
    { component: panes.files, grow: 1 },
  ]);

  return new HStack([
    {
      component: leftColumn,
      basis: layout.leftWidth,
      grow: 0,
      shrink: 0,
    },
    {
      component: divider(layout, input.focusedPane, input.styler),
      basis: 1,
      grow: 0,
      shrink: 0,
    },
    { component: panes.diff, grow: 1 },
  ]);
}

export function buildFullscreenEntries(
  input: FullscreenTreeInput,
): StackChild[] {
  return [
    { component: input.header, shrink: 0 },
    {
      component: border(input.layout, input.focusedPane, input.styler, "top"),
      shrink: 0,
    },
    {
      component: body(input),
      basis: input.layout.bodyHeight,
      grow: 0,
      shrink: 1,
      minSize: 6,
    },
    {
      component: border(
        input.layout,
        input.focusedPane,
        input.styler,
        "bottom",
      ),
      shrink: 0,
    },
    { component: input.footer, shrink: 0 },
  ];
}

export function fullscreenHeight(rows: number): number {
  return rows - 1;
}

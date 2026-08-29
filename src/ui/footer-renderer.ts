import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { Styler } from "./theme.ts";

export interface FooterInput {
  reviewedCount: number;
  totalCount: number;
  focusedPane: "sources" | "files" | "diff";
  compact: boolean;
  helpVisible: boolean;
  commentCount?: number;
  notice?: string;
}

const HELP_LINES = [
  "↑ / ↓  Move selection or scroll the focused pane",
  "j / k  Vim-style equivalent of down/up",
  "J / K  Move 5 lines",
  "Ctrl+D / Ctrl+U  Half page",
  "Tab  Move focus to the next pane",
  "Shift+Tab  Move focus to the previous pane",
  "Enter  Open the selected item or move into the diff",
  "Esc  Back a level (closes from the source list)",
  "h / Backspace  Back a level (closes from the source list)",
  "l  Enter selected",
  "q  Close the reviewer",
  "n / p  Jump to the next/previous hunk",
  "PageDown / PageUp  Scroll the diff by approximately one viewport",
  "Home / End  Jump to the beginning/end of the selected file diff",
  "← / →  Horizontal scrolling when content is wider than its pane",
  "Ctrl+E / Ctrl+Y  Scroll view (cursor stays)",
  "Shift+↑ / Shift+↓  Scroll view",
  "v  Toggle unified and side-by-side views",
  "Space  Mark/unmark the selected file as reviewed",
  "c  Add or edit a comment on the selected line",
  "d  Delete the comment on the selected line",
  "S  Submit queued comments to the prompt",
  "g  Refresh sources and diffs",
  "?  Toggle help",
] as const;

function fitLine(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export function renderFooter(input: FooterInput, width: number, styler: Styler): string[] {
  const progress = `${input.reviewedCount}/${input.totalCount} reviewed`;
  const commentCount = input.commentCount ?? 0;
  const queued = commentCount === 0
    ? ""
    : `${commentCount} ${commentCount === 1 ? "comment" : "comments"} · S submit`;
  const status = queued === "" ? progress : `${progress} · ${queued}`;

  if (input.helpVisible) {
    return [
      styler.bold(fitLine(status, width)),
      ...HELP_LINES.map((line) => styler.fg("muted", fitLine(line, width))),
    ];
  }

  if (input.notice !== undefined) {
    return [styler.fg("warning", fitLine(`${status} · ${input.notice}`, width))];
  }

  const text = input.compact
    ? queued === "" ? "? help · q close" : `${queued} · ? help · q close`
    : `${status} · Tab pane · ↑↓ select · n/p hunk · v side-by-side · Space reviewed · g refresh · ? help · q close`;
  return [fitLine(text, width)];
}

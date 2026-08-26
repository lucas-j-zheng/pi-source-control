import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { FileStatus, SourceListItem } from "../model/diff.ts";
import type { Styler } from "./theme.ts";

export interface SourceRowInput {
  items: SourceListItem[];
  counts: Record<string, number | undefined>;
  selectedId: string;
  focused: boolean;
  scrollOffset: number;
  maxRows: number;
}

export interface RenderedRows {
  lines: string[];
  rowIds: (string | undefined)[];
}

interface SourceRenderRow {
  text: string;
  id?: string;
  heading?: boolean;
  selected?: boolean;
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function fitWithCount(text: string, count: number | undefined, width: number): string {
  if (count === undefined) return fitLine(text, width);

  const suffix = ` (${count})`;
  const suffixWidth = visibleWidth(suffix);
  if (suffixWidth >= width) return fitLine(suffix, width);

  const textWidth = width - suffixWidth;
  const truncated = truncateToWidth(text, textWidth);
  return truncated + " ".repeat(Math.max(0, textWidth - visibleWidth(truncated))) + suffix;
}

function sourceText(item: SourceListItem, selected: boolean): string {
  const marker = selected ? ">" : " ";
  if (item.kind === "working") return `${marker} W ${item.label}`;
  if (item.kind === "staged") return `${marker} S ${item.label}`;
  return `${marker} ● ${item.shortOid} ${item.subject}`;
}

export function renderSourceList(
  input: SourceRowInput,
  width: number,
  styler: Styler,
): RenderedRows {
  const workspace = input.items.filter((item) => item.kind !== "commit");
  const commits = input.items.filter((item) => item.kind === "commit");
  const rows: SourceRenderRow[] = [
    { text: "WORKSPACE", heading: true },
    ...workspace.map((item) => ({
      text: sourceText(item, item.id === input.selectedId),
      id: item.id,
      selected: item.id === input.selectedId,
    })),
    { text: "" },
    { text: "RECENT COMMITS", heading: true },
    ...commits.map((item) => ({
      text: sourceText(item, item.id === input.selectedId),
      id: item.id,
      selected: item.id === input.selectedId,
    })),
  ];

  const start = Math.max(0, input.scrollOffset);
  const visibleRows = rows.slice(start, start + Math.max(0, input.maxRows));

  return {
    lines: visibleRows.map((row) => {
      let line = fitWithCount(row.text, row.id === undefined ? undefined : input.counts[row.id], width);
      if (row.heading) line = styler.bold(styler.fg("muted", line));
      if (row.selected) {
        line = input.focused ? styler.bg("selectedBg", line) : styler.bold(line);
      }
      return line;
    }),
    rowIds: visibleRows.map((row) => row.id),
  };
}

export function statusLetter(status: FileStatus): string {
  const letters: Record<FileStatus, string> = {
    modified: "M",
    added: "A",
    deleted: "D",
    renamed: "R",
    copied: "C",
    untracked: "U",
    unmerged: "!",
    "type-changed": "T",
  };
  return letters[status];
}

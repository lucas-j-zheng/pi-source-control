import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { ChangedFile } from "../model/diff.ts";
import type { RenderedRows } from "./source-list-renderer.ts";
import { statusLetter } from "./source-list-renderer.ts";
import type { Styler } from "./theme.ts";

export interface FileRowInput {
  files: ChangedFile[];
  selectedId?: string;
  reviewed: Set<string>;
  focused: boolean;
  scrollOffset: number;
  maxRows: number;
  title: string;
}

interface FileRenderRow {
  text: string;
  id?: string;
  title?: boolean;
  empty?: boolean;
  selected?: boolean;
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function fileRowText(file: ChangedFile, input: FileRowInput, width: number): string {
  const selected = file.id === input.selectedId;
  const reviewed = input.reviewed.has(file.id);
  const prefix = `${selected ? ">" : " "} ${reviewed ? "✓" : " "} ${statusLetter(file.status)} `;
  const directory = file.displayDirectory;
  const counts = `+${file.additions} −${file.deletions}`;
  const withDirectory = directory ? `${prefix}${file.displayName}  ${directory}` : `${prefix}${file.displayName}`;
  const complete = `${withDirectory}  ${counts}`;

  if (visibleWidth(complete) <= width) return complete;
  if (visibleWidth(withDirectory) <= width) return withDirectory;
  return `${prefix}${file.displayName}`;
}

export function renderFileList(
  input: FileRowInput,
  width: number,
  styler: Styler,
): RenderedRows {
  const title = `${input.title || "FILES CHANGED"} (${input.files.length})`;
  const rows: FileRenderRow[] = [
    { text: title, title: true },
    ...(input.files.length === 0
      ? [{ text: "No changes", empty: true }]
      : input.files.map((file) => ({
          text: fileRowText(file, input, width),
          id: file.id,
          selected: file.id === input.selectedId,
        }))),
  ];

  const start = Math.max(0, input.scrollOffset);
  const visibleRows = rows.slice(start, start + Math.max(0, input.maxRows));

  return {
    lines: visibleRows.map((row) => {
      let line = fitLine(row.text, width);
      if (row.title) line = styler.bold(styler.fg("muted", line));
      if (row.empty) line = styler.fg("muted", line);
      if (row.selected) {
        line = input.focused ? styler.bg("selectedBg", line) : styler.bold(line);
      }
      return line;
    }),
    rowIds: visibleRows.map((row) => row.id),
  };
}

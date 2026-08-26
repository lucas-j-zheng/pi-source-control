import {
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

export function expandTabs(text: string, tabWidth = 4): string {
  const stopWidth = Math.max(1, Math.trunc(tabWidth));
  const parts = text.split("\t");
  let expanded = "";
  let column = 0;

  for (const [index, part] of parts.entries()) {
    expanded += part;
    column += visibleWidth(part);

    if (index < parts.length - 1) {
      const spaces = stopWidth - (column % stopWidth);
      expanded += " ".repeat(spaces);
      column += spaces;
    }
  }

  return expanded;
}

export function sliceColumns(
  text: string,
  start: number,
  width: number,
): string {
  const safeStart = Math.max(0, Math.trunc(start));
  const safeWidth = Math.max(0, Math.trunc(width));
  const sliced = sliceByColumn(text, safeStart, safeWidth, true);

  return sliced + " ".repeat(Math.max(0, safeWidth - visibleWidth(sliced)));
}

export function padToWidth(line: string, width: number): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  const lineWidth = visibleWidth(line);

  if (lineWidth <= safeWidth) {
    return line + " ".repeat(safeWidth - lineWidth);
  }

  const truncated = truncateToWidth(line, safeWidth);
  return truncated +
    " ".repeat(Math.max(0, safeWidth - visibleWidth(truncated)));
}

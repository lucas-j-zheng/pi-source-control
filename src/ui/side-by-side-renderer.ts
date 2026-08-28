import { alignFile } from "../diff/side-by-side-aligner.ts";
import {
  expandTabs,
  padToWidth,
  sliceColumns,
} from "../diff/line-slicing.ts";
import type { ChangedFile, DiffCell, DiffHunk } from "../model/diff.ts";
import {
  anchorEquals,
  type LineAnchor,
} from "../model/review-state.ts";
import { MIN_SBS_CODE_WIDTH, SBS_GUTTER_WIDTH } from "./layout.ts";
import type { FgRole, Styler } from "./theme.ts";
import { placeholderFor } from "./unified-renderer.ts";

export const SBS_WIDTH_NOTICE = "Side-by-side requires a wider terminal";

export interface SbsRow {
  text: string;
  hunkIndex: number;
  isHunkHeader: boolean;
  anchor?: LineAnchor;
  anchors?: LineAnchor[];
}

export interface SbsViewInput {
  file?: ChangedFile;
  verticalOffset: number;
  horizontalOffset: number;
  height: number;
  cursor?: LineAnchor;
  focused?: boolean;
}

export function sideBySideFits(width: number): boolean {
  return Math.floor((Math.trunc(width) - 1) / 2) - SBS_GUTTER_WIDTH >=
    MIN_SBS_CODE_WIDTH;
}

export function buildSideBySideRows(
  file: ChangedFile,
  styler: Styler,
  width: number,
  horizontalOffset: number,
  cursor?: LineAnchor,
  focused = true,
): SbsRow[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHorizontalOffset = Math.max(0, Math.trunc(horizontalOffset));
  const leftWidth = Math.floor(Math.max(0, safeWidth - 1) / 2);
  const rightWidth = Math.max(0, safeWidth - leftWidth - 1);
  const divider = safeWidth === 0 ? "" : styler.fg("borderMuted", "│");
  const rows: SbsRow[] = [
    {
      text: joinColumns(
        renderColumnHeader("ORIGINAL", leftWidth, styler),
        renderColumnHeader("MODIFIED", rightWidth, styler),
        divider,
      ),
      hunkIndex: -1,
      isHunkHeader: false,
    },
  ];
  const hunkHeaders = new Map(
    file.hunks.map((hunk) => [hunk.index, hunk.header]),
  );

  const alignedRows = alignFile(file.hunks);
  const anchorsByRow = file.hunks.flatMap(anchorsForHunkRows);
  for (const [rowIndex, alignedRow] of alignedRows.entries()) {
    const hunkHeader = hunkHeaders.get(alignedRow.hunkIndex);
    const isHunkHeader =
      hunkHeader !== undefined &&
      alignedRow.left?.kind === "metadata" &&
      alignedRow.left.content === hunkHeader &&
      alignedRow.right?.kind === "metadata" &&
      alignedRow.right.content === hunkHeader;

    const anchors = anchorsByRow[rowIndex] ?? [];
    const cursorAnchor = anchors.find((anchor) => anchorEquals(anchor, cursor));
    let text = joinColumns(
        isHunkHeader
          ? renderHunkHeader(
              hunkHeader,
              leftWidth,
              safeHorizontalOffset,
              styler,
            )
          : renderCell(
              alignedRow.left,
              leftWidth,
              safeHorizontalOffset,
              styler,
            ),
        isHunkHeader
          ? renderHunkHeader(
              hunkHeader,
              rightWidth,
              safeHorizontalOffset,
              styler,
            )
          : renderCell(
              alignedRow.right,
              rightWidth,
              safeHorizontalOffset,
              styler,
            ),
        divider,
      );
    if (anchors.some((anchor) => anchorEquals(anchor, cursor))) {
      text = focused
        ? styler.bg("selectedBg", text)
        : styler.bold(text);
    }
    rows.push({
      text,
      hunkIndex: alignedRow.hunkIndex,
      isHunkHeader,
      ...(anchors[0] === undefined
        ? {}
        : { anchor: cursorAnchor ?? anchors[0], anchors }),
    });
  }

  return rows;
}

export function renderSideBySide(
  input: SbsViewInput,
  width: number,
  styler: Styler,
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(input.height));

  if (!sideBySideFits(safeWidth)) {
    return Array.from({ length: safeHeight }, (_, row) =>
      padToWidth(
        row === 0 ? styler.fg("warning", SBS_WIDTH_NOTICE) : "",
        safeWidth,
      ),
    );
  }

  const placeholder = placeholderFor(input.file);
  if (placeholder !== undefined) {
    return Array.from({ length: safeHeight }, (_, row) =>
      padToWidth(row === 1 ? placeholder : "", safeWidth),
    );
  }

  const rows = buildSideBySideRows(
    input.file!,
    styler,
    safeWidth,
    input.horizontalOffset,
    input.cursor,
    input.focused,
  );
  const maximumOffset = Math.max(0, rows.length - safeHeight);
  const verticalOffset = Math.min(
    Math.max(0, Math.trunc(input.verticalOffset)),
    maximumOffset,
  );
  const visibleRows = rows.slice(verticalOffset, verticalOffset + safeHeight);

  return Array.from({ length: safeHeight }, (_, row) =>
    padToWidth(visibleRows[row]?.text ?? "", safeWidth),
  );
}

function anchorsForHunkRows(hunk: DiffHunk): LineAnchor[][] {
  const rows: LineAnchor[][] = [[]];
  let lineIndex = 0;

  while (lineIndex < hunk.lines.length) {
    const line = hunk.lines[lineIndex];
    if (line === undefined) break;

    if (line.kind === "context") {
      rows.push([{ hunkIndex: hunk.index, lineIndex }]);
      lineIndex += 1;
      continue;
    }
    if (line.kind === "metadata") {
      rows.push([]);
      lineIndex += 1;
      continue;
    }

    const deletionIndexes: number[] = [];
    const additionIndexes: number[] = [];
    if (line.kind === "deletion") {
      while (hunk.lines[lineIndex]?.kind === "deletion") {
        deletionIndexes.push(lineIndex);
        lineIndex += 1;
      }
      while (hunk.lines[lineIndex]?.kind === "addition") {
        additionIndexes.push(lineIndex);
        lineIndex += 1;
      }
    } else {
      while (hunk.lines[lineIndex]?.kind === "addition") {
        additionIndexes.push(lineIndex);
        lineIndex += 1;
      }
    }

    const rowCount = Math.max(deletionIndexes.length, additionIndexes.length);
    for (let index = 0; index < rowCount; index += 1) {
      const anchors: LineAnchor[] = [];
      const deletionIndex = deletionIndexes[index];
      const additionIndex = additionIndexes[index];
      if (deletionIndex !== undefined) {
        anchors.push({ hunkIndex: hunk.index, lineIndex: deletionIndex });
      }
      if (additionIndex !== undefined) {
        anchors.push({ hunkIndex: hunk.index, lineIndex: additionIndex });
      }
      rows.push(anchors);
    }
  }

  return rows;
}

export function sbsHunkStartRows(file: ChangedFile): number[] {
  const rows: number[] = [];
  let row = 1;

  for (const hunk of file.hunks) {
    rows.push(row);
    row += alignFile([hunk]).length;
  }

  return rows;
}

function renderColumnHeader(
  label: string,
  width: number,
  styler: Styler,
): string {
  const codeWidth = Math.max(0, width - SBS_GUTTER_WIDTH);
  const text = " ".repeat(Math.min(SBS_GUTTER_WIDTH, width)) +
    sliceColumns(label, 0, codeWidth);

  return padToWidth(styler.fg("dim", text), width);
}

function renderHunkHeader(
  header: string,
  width: number,
  horizontalOffset: number,
  styler: Styler,
): string {
  const codeWidth = Math.max(0, width - SBS_GUTTER_WIDTH);
  const gutter = " ".repeat(Math.min(SBS_GUTTER_WIDTH, width));
  const code = sliceColumns(expandTabs(header), horizontalOffset, codeWidth);

  return padToWidth(gutter + styler.fg("accent", code), width);
}

function renderCell(
  cell: DiffCell | undefined,
  width: number,
  horizontalOffset: number,
  styler: Styler,
): string {
  const codeWidth = Math.max(0, width - SBS_GUTTER_WIDTH);
  const lineNumber = formatLineNumber(cell?.lineNumber);
  const marker = markerFor(cell);
  const code = sliceColumns(
    expandTabs(cell?.content ?? ""),
    horizontalOffset,
    codeWidth,
  );
  const content = marker + code;

  if (cell === undefined || cell.kind === "empty") {
    return padToWidth(`${lineNumber} ${content}`, width);
  }

  return padToWidth(
    `${lineNumber} ${styler.fg(roleFor(cell), content)}`,
    width,
  );
}

function joinColumns(left: string, right: string, divider: string): string {
  return left + divider + right;
}

function formatLineNumber(value: number | undefined): string {
  if (value === undefined) return "    ";
  return String(value).padStart(4).slice(-4);
}

function markerFor(cell: DiffCell | undefined): string {
  if (cell?.kind === "addition") return "+";
  if (cell?.kind === "deletion") return "-";
  return " ";
}

function roleFor(cell: DiffCell): FgRole {
  if (cell.kind === "addition") return "toolDiffAdded";
  if (cell.kind === "deletion") return "toolDiffRemoved";
  return "toolDiffContext";
}

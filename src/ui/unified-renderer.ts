import type {
  ChangedFile,
  DiffLine,
  DiffLineKind,
} from "../model/diff.ts";
import {
  anchorEquals,
  type LineAnchor,
} from "../model/review-state.ts";
import {
  expandTabs,
  padToWidth,
  sliceColumns,
} from "../diff/line-slicing.ts";
import { UNIFIED_GUTTER_WIDTH } from "./layout.ts";
import type { FgRole, Styler } from "./theme.ts";

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

export interface UnifiedRow {
  text: string;
  hunkIndex: number;
  isHunkHeader: boolean;
  anchor?: LineAnchor;
}

export interface UnifiedViewInput {
  file?: ChangedFile;
  verticalOffset: number;
  horizontalOffset: number;
  height: number;
  placeholder?: string;
  cursor?: LineAnchor;
  focused?: boolean;
}

export function buildUnifiedRows(
  file: ChangedFile,
  styler: Styler,
  codeWidth: number,
  horizontalOffset: number,
  cursor?: LineAnchor,
  focused = true,
): UnifiedRow[] {
  const safeCodeWidth = Math.max(0, Math.trunc(codeWidth));
  const safeHorizontalOffset = Math.max(0, Math.trunc(horizontalOffset));
  const blankGutter = " ".repeat(UNIFIED_GUTTER_WIDTH);
  const rows: UnifiedRow[] = [
    {
      text: styler.fg(
        "dim",
        padToWidth(" OLD  NEW", UNIFIED_GUTTER_WIDTH + safeCodeWidth),
      ),
      hunkIndex: -1,
      isHunkHeader: false,
    },
  ];

  for (const hunk of file.hunks) {
    const header = sliceCode(
      hunk.header,
      safeHorizontalOffset,
      safeCodeWidth,
    );
    rows.push({
      text: blankGutter + styler.fg("accent", header),
      hunkIndex: hunk.index,
      isHunkHeader: true,
    });

    for (const [lineIndex, line] of hunk.lines.entries()) {
      const anchor: LineAnchor | undefined = line.kind === "metadata"
        ? undefined
        : { hunkIndex: hunk.index, lineIndex };
      let text = renderDiffLine(
        line,
        styler,
        safeCodeWidth,
        safeHorizontalOffset,
      );
      if (anchorEquals(anchor, cursor)) {
        text = focused
          ? styler.bg("selectedBg", text)
          : styler.bold(text);
      }
      rows.push({
        text,
        hunkIndex: hunk.index,
        isHunkHeader: false,
        ...(anchor === undefined ? {} : { anchor }),
      });

      if (line.noNewlineAtEnd === true) {
        const marker = sliceCode(
          NO_NEWLINE_MARKER,
          safeHorizontalOffset,
          safeCodeWidth,
        );
        rows.push({
          text: blankGutter + styler.fg("muted", marker),
          hunkIndex: hunk.index,
          isHunkHeader: false,
        });
      }
    }
  }

  return rows;
}

export function renderUnifiedDiff(
  input: UnifiedViewInput,
  width: number,
  styler: Styler,
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(input.height));
  const placeholder = input.placeholder ?? placeholderFor(input.file);

  if (placeholder !== undefined) {
    return Array.from({ length: safeHeight }, (_, row) =>
      padToWidth(row === 1 ? placeholder : "", safeWidth),
    );
  }

  const rows = buildUnifiedRows(
    input.file!,
    styler,
    Math.max(0, safeWidth - UNIFIED_GUTTER_WIDTH),
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

export function hunkStartRows(file: ChangedFile): number[] {
  const rows: number[] = [];
  let row = 1;

  for (const hunk of file.hunks) {
    rows.push(row);
    row += 1;

    for (const line of hunk.lines) {
      row += line.noNewlineAtEnd === true ? 2 : 1;
    }
  }

  return rows;
}

export function placeholderFor(
  file: ChangedFile | undefined,
): string | undefined {
  if (file === undefined) return "No file selected.";
  if (file.isBinary) return "Binary file changed. Text diff is unavailable.";
  if (file.isOversized) {
    return "Diff omitted because this file exceeds the configured review size limit.";
  }
  if (file.status === "unmerged" && file.hunks.length === 0) {
    return "Unmerged file. Resolve the conflict to view a diff.";
  }
  if (file.hunks.length === 0) return "No textual changes.";

  return undefined;
}

function renderDiffLine(
  line: DiffLine,
  styler: Styler,
  codeWidth: number,
  horizontalOffset: number,
): string {
  const marker = markerFor(line.kind);
  const gutter = `${lineNumber(line.oldLineNumber)} ${lineNumber(
    line.newLineNumber,
  )} `;
  const code = sliceCode(line.content, horizontalOffset, codeWidth);
  const role = roleFor(line.kind);

  return gutter + styler.fg(role, marker + code);
}

function sliceCode(text: string, horizontalOffset: number, width: number): string {
  return sliceColumns(expandTabs(text), horizontalOffset, width);
}

function lineNumber(value: number | undefined): string {
  if (value === undefined) return "    ";
  return String(value).padStart(4).slice(-4);
}

function markerFor(kind: DiffLineKind): string {
  if (kind === "addition") return "+";
  if (kind === "deletion") return "-";
  return " ";
}

function roleFor(kind: DiffLineKind): FgRole {
  if (kind === "addition") return "toolDiffAdded";
  if (kind === "deletion") return "toolDiffRemoved";
  return "toolDiffContext";
}

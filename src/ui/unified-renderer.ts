import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

import type {
  ChangedFile,
  DiffLine,
  DiffLineKind,
} from "../model/diff.ts";
import {
  anchorEquals,
  type LineAnchor,
} from "../model/review-state.ts";
import type { ReviewComment } from "../model/review-comment.ts";
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
  isComment?: boolean;
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
  comments: readonly ReviewComment[] = [],
): UnifiedRow[] {
  const safeCodeWidth = Math.max(0, Math.trunc(codeWidth));
  const safeHorizontalOffset = Math.max(0, Math.trunc(horizontalOffset));
  const blankGutter = " ".repeat(UNIFIED_GUTTER_WIDTH);
  const commentsByAnchor = groupCommentsByAnchor(file.id, comments);
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

      if (anchor !== undefined) {
        const anchoredComments = commentsByAnchor.get(anchorKey(anchor)) ?? [];
        for (const comment of anchoredComments) {
          for (const commentText of buildCommentCodeRows(
            comment.body,
            safeCodeWidth,
            styler,
          )) {
            rows.push({
              text: blankGutter + commentText,
              hunkIndex: hunk.index,
              isHunkHeader: false,
              isComment: true,
            });
          }
        }
      }

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
  comments: readonly ReviewComment[] = [],
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
    comments,
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

export function buildCommentCodeRows(
  body: string,
  codeWidth: number,
  styler: Styler,
): string[] {
  const safeCodeWidth = Math.max(0, Math.trunc(codeWidth));
  const firstPrefixWidth = visibleWidth("│ 💬 ");
  const bodyWidth = Math.max(0, safeCodeWidth - firstPrefixWidth);
  const wrapped = wrapCommentBody(body, bodyWidth);

  return wrapped.map((line, index) => {
    const prefix = index === 0
      ? styler.fg("accent", "│") + " " + styler.fg("accent", "💬") + " "
      : styler.fg("accent", "│") + "    ";
    const text = prefix + styler.fg("muted", line);
    return safeCodeWidth >= firstPrefixWidth
      ? text
      : padToWidth(text, safeCodeWidth);
  });
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

function groupCommentsByAnchor(
  fileId: string,
  comments: readonly ReviewComment[],
): Map<string, ReviewComment[]> {
  const grouped = new Map<string, ReviewComment[]>();
  for (const comment of comments) {
    if (comment.fileId !== fileId) continue;
    const key = anchorKey(comment.anchor);
    const anchored = grouped.get(key) ?? [];
    anchored.push(comment);
    grouped.set(key, anchored);
  }
  for (const anchored of grouped.values()) {
    anchored.sort((left, right) => left.createdAt - right.createdAt);
  }
  return grouped;
}

function anchorKey(anchor: LineAnchor): string {
  return `${anchor.hunkIndex}:${anchor.lineIndex}`;
}

function wrapCommentBody(body: string, width: number): string[] {
  if (width <= 0) return [""];

  return body.split(/\r\n|\r|\n/u).flatMap((line) => {
    const expanded = expandTabs(line);
    const lineWidth = visibleWidth(expanded);
    if (lineWidth === 0) return [" ".repeat(width)];
    const rows: string[] = [];
    let start = 0;
    while (start < lineWidth) {
      const sliced = sliceByColumn(expanded, start, width, true);
      const slicedWidth = visibleWidth(sliced);
      if (slicedWidth === 0) {
        start += 1;
        continue;
      }
      rows.push(sliceColumns(sliced, 0, width));
      start += slicedWidth;
    }
    return rows.length === 0 ? [" ".repeat(width)] : rows;
  });
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

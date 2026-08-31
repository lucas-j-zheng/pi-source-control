import type { ChangedFile } from "../model/diff.ts";
import type { ReviewComment } from "../model/review-comment.ts";
import type { LineAnchor } from "../model/review-state.ts";
import { buildSideBySideRows } from "./side-by-side-renderer.ts";
import { plainStyler } from "./theme.ts";
import {
  buildUnifiedRows,
  type ComposingEditor,
} from "./unified-renderer.ts";

export interface Projection {
  rowCount: number;
  rowForAnchor(anchor: LineAnchor): number;
  anchors: readonly LineAnchor[];
  composerSpan?: { anchorRow: number; lastRow: number; rowCount: number };
}

export interface ProjectionKey {
  fileId: string;
  fingerprint: string;
  mode: "unified" | "side-by-side";
  width: number;
  horizontalOffset: number;
  commentsVersion: number;
  composerVersion: number;
}

export interface ProjectionInput {
  file: ChangedFile;
  mode: ProjectionKey["mode"];
  width: number;
  horizontalOffset: number;
  comments?: readonly ReviewComment[];
  composing?: ComposingEditor;
}

interface ProjectableRow {
  isComment?: boolean;
  anchor?: LineAnchor;
  anchors?: LineAnchor[];
}

interface CacheEntry {
  key: ProjectionKey;
  projection: Projection;
}

export function createProjectionCache(
  build: (key: ProjectionKey, file: ChangedFile) => Projection,
): {
  get(key: ProjectionKey, file: ChangedFile): Projection;
  clear(): void;
} {
  const entries: CacheEntry[] = [];

  return {
    get(key, file) {
      const index = entries.findIndex((entry) => keysEqual(entry.key, key));
      if (index >= 0) {
        const entry = entries[index]!;
        entries.splice(index, 1);
        entries.push(entry);
        return entry.projection;
      }

      const projection = build(key, file);
      entries.push({ key: { ...key }, projection });
      if (entries.length > 2) entries.shift();
      return projection;
    },
    clear() {
      entries.length = 0;
    },
  };
}

/** Build the measurement model with an identity styler; rendered text is ignored. */
export function buildDiffProjection(input: ProjectionInput): Projection {
  const comments = input.comments ?? [];
  const rows: ProjectableRow[] = input.mode === "side-by-side"
    ? buildSideBySideRows(
        input.file,
        plainStyler,
        input.width,
        input.horizontalOffset,
        undefined,
        true,
        comments,
        input.composing,
      )
    : buildUnifiedRows(
        input.file,
        plainStyler,
        input.width,
        input.horizontalOffset,
        undefined,
        true,
        comments,
        input.composing,
      );

  const rowByAnchor = new Map<string, number>();
  for (const [rowIndex, row] of rows.entries()) {
    const anchors = row.anchors ?? (row.anchor === undefined ? [] : [row.anchor]);
    for (const anchor of anchors) rowByAnchor.set(anchorKey(anchor), rowIndex);
  }

  // Preserve the source-line order used by cursor navigation. Side-by-side can
  // place a deletion and an addition on one visual row, but j/k still walks the
  // underlying diff in its original order.
  const anchors = input.file.hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line, lineIndex) =>
      line.kind === "metadata"
        ? []
        : [{ hunkIndex: hunk.index, lineIndex }]
    )
  );
  const anchorRow = input.composing === undefined
    ? -1
    : (rowByAnchor.get(anchorKey(input.composing.anchor)) ?? -1);
  let composerSpan: Projection["composerSpan"];
  if (anchorRow >= 0) {
    let lastRow = anchorRow;
    while (rows[lastRow + 1]?.isComment === true) lastRow += 1;
    composerSpan = { anchorRow, lastRow, rowCount: rows.length };
  }

  return {
    rowCount: rows.length,
    rowForAnchor: (anchor) => rowByAnchor.get(anchorKey(anchor)) ?? -1,
    anchors,
    ...(composerSpan === undefined ? {} : { composerSpan }),
  };
}

function keysEqual(left: ProjectionKey, right: ProjectionKey): boolean {
  // Horizontal slicing changes visible text but never row or anchor geometry,
  // which is the only data a projection retains.
  return left.fileId === right.fileId &&
    left.fingerprint === right.fingerprint &&
    left.mode === right.mode &&
    left.width === right.width &&
    left.commentsVersion === right.commentsVersion &&
    left.composerVersion === right.composerVersion;
}

function anchorKey(anchor: LineAnchor): string {
  return `${anchor.hunkIndex}:${anchor.lineIndex}`;
}

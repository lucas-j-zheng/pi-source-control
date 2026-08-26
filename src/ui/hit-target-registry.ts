import type { HitTarget } from "../model/diff.ts";
import type { Layout } from "./layout.ts";

export interface HitInput {
  layout: Layout;
  sourceRowIds: (string | undefined)[];
  fileRowIds: (string | undefined)[];
  sourceListTop: number;
  fileListTop: number;
  diffTop: number;
}

function listTargets(
  ids: (string | undefined)[],
  rowTop: number,
  columnEnd: number,
  type: "select-source" | "select-file",
): HitTarget[] {
  const targets: HitTarget[] = [];
  ids.forEach((id, index) => {
    if (id === undefined) return;
    targets.push({
      row: rowTop + index,
      columnStart: 0,
      columnEnd,
      action:
        type === "select-source"
          ? { type, sourceId: id }
          : { type, fileId: id },
    });
  });
  return targets;
}

function diffTargets(
  input: HitInput,
  columnStart: number,
): HitTarget[] {
  return Array.from({ length: input.layout.bodyHeight }, (_, index) => ({
    row: input.diffTop + index,
    columnStart,
    columnEnd: input.layout.width,
    action: { type: "focus-diff" } as const,
  }));
}

export function computeHitTargets(input: HitInput): HitTarget[] {
  const { layout } = input;
  if (layout.mode !== "narrow") {
    return [
      ...listTargets(
        input.sourceRowIds,
        input.sourceListTop,
        layout.leftWidth,
        "select-source",
      ),
      ...listTargets(
        input.fileRowIds,
        input.fileListTop,
        layout.leftWidth,
        "select-file",
      ),
      ...diffTargets(input, layout.leftWidth + 1),
    ];
  }

  const sourceTargets = listTargets(
    input.sourceRowIds,
    input.sourceListTop,
    layout.width,
    "select-source",
  );
  if (sourceTargets.length > 0) return sourceTargets;

  const fileTargets = listTargets(
    input.fileRowIds,
    input.fileListTop,
    layout.width,
    "select-file",
  );
  return fileTargets.length > 0 ? fileTargets : diffTargets(input, 0);
}

export function hitTest(
  targets: HitTarget[],
  row: number,
  column: number,
): HitTarget["action"] | undefined {
  return targets.find(
    (target) =>
      target.row === row &&
      column >= target.columnStart &&
      column < target.columnEnd,
  )?.action;
}

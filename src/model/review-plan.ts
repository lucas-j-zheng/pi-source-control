import type { ReviewComment } from "./review-comment.ts";

export interface WorkUnit {
  index: number;
  filePaths: string[];
  commentIds: string[];
}

export interface ReviewPlan {
  units: WorkUnit[];
  parallelSafe: boolean;
}

const commentNumbersByUnit = new WeakMap<WorkUnit, number[]>();

export function buildReviewPlan(comments: ReviewComment[]): ReviewPlan {
  const commentsByPath = new Map<
    string,
    Array<{ id: string; messageNumber: number }>
  >();

  comments.forEach((comment, index) => {
    const grouped = commentsByPath.get(comment.filePath) ?? [];
    grouped.push({ id: comment.id, messageNumber: index + 1 });
    commentsByPath.set(comment.filePath, grouped);
  });

  const units = [...commentsByPath.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map((filePath, index) => {
      const grouped = commentsByPath.get(filePath) ?? [];
      const unit: WorkUnit = {
        index: index + 1,
        filePaths: [filePath],
        commentIds: grouped.map((comment) => comment.id),
      };
      commentNumbersByUnit.set(
        unit,
        grouped.map((comment) => comment.messageNumber),
      );
      return unit;
    });

  return {
    units,
    parallelSafe: units.length > 1,
  };
}

export function renderPlan(plan: ReviewPlan): string {
  if (plan.units.length < 2) return "";

  let fallbackCommentNumber = 1;
  const unitLines = plan.units.map((unit) => {
    const commentNumbers =
      commentNumbersByUnit.get(unit) ??
      unit.commentIds.map(() => fallbackCommentNumber++);
    fallbackCommentNumber += commentNumbersByUnit.has(unit)
      ? unit.commentIds.length
      : 0;
    const commentLabel =
      commentNumbers.length === 1 ? "comment" : "comments";
    return `  Unit ${unit.index}: ${unit.filePaths[0]}  (${commentLabel} ${commentNumbers.join(", ")})`;
  });

  return (
    `\n\nSuggested plan — ${plan.units.length} independent units, one per file:\n\n` +
    `${unitLines.join("\n")}\n\n` +
    "Units touch disjoint files and may be worked in parallel, one worker per unit.\n" +
    "Do not split a unit across workers: comments in a unit edit the same file.\n" +
    "Merge units into one worker if the changes turn out to be coupled — for example a\n" +
    "rename whose call sites live in another unit's file."
  );
}

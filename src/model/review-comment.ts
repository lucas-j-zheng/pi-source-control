import type {
  ChangedFile,
  DiffLine,
  DiffLineKind,
  DiffReview,
} from "./diff.ts";
import { sanitizeLabel } from "../diff/sanitize.ts";
import { buildReviewPlan, renderPlan } from "./review-plan.ts";
import type { LineAnchor } from "./review-state.ts";

export interface ReviewComment {
  id: string;
  fileId: string;
  filePath: string;
  anchor: LineAnchor;
  oldLineNumber?: number;
  newLineNumber?: number;
  lineKind: "context" | "addition" | "deletion";
  lineText: string;
  contextText: string;
  scopeLabel: string;
  body: string;
  createdAt: number;
}

function markerFor(line: DiffLine): string {
  return markerForKind(line.kind);
}

function markerForKind(kind: DiffLineKind): string {
  if (kind === "addition") return "+";
  if (kind === "deletion") return "-";
  return " ";
}

export function describeScope(review: DiffReview): string {
  if (review.scope.kind === "workspace") {
    const groupsWithFiles = review.groups.filter((group) => group.files.length > 0);
    return (
        review.groups.length === 1 && review.groups[0]?.id === "staged"
      ) || (groupsWithFiles.length === 1 && groupsWithFiles[0]?.id === "staged")
      ? "staged changes"
      : "working tree";
  }

  if (review.scope.kind === "commit") {
    const metadata =
      review.metadata !== undefined && "subject" in review.metadata
        ? review.metadata
        : undefined;
    const shortOid = metadata?.shortOid ?? review.scope.commitOid.slice(0, 7);
    // A commit subject is repository-controlled text that ends up on a row and
    // inside the message handed to the agent.
    return sanitizeLabel(`commit ${shortOid} (${metadata?.subject ?? ""})`);
  }

  const metadata =
    review.metadata !== undefined && "expression" in review.metadata
      ? review.metadata
      : undefined;
  return sanitizeLabel(
    `range ${metadata?.expression ?? review.scope.requestedExpression}`,
  );
}

export function buildComment(input: {
  file: ChangedFile;
  anchor: LineAnchor;
  body: string;
  scopeLabel: string;
  now: number;
}): ReviewComment {
  const hunk = input.file.hunks.find(
    (candidate) => candidate.index === input.anchor.hunkIndex,
  );
  const line = hunk?.lines[input.anchor.lineIndex];
  if (hunk === undefined || line === undefined || line.kind === "metadata") {
    throw new Error("Cannot build a review comment for an invalid line anchor.");
  }

  const contextStart = Math.max(0, input.anchor.lineIndex - 3);
  const contextEnd = Math.min(
    hunk.lines.length,
    input.anchor.lineIndex + 4,
  );
  const contextText = hunk.lines
    .slice(contextStart, contextEnd)
    .map((contextLine) => `${markerFor(contextLine)}${contextLine.content}`)
    .join("\n");

  return {
    id:
      `${input.scopeLabel}\0${input.file.id}\0${input.anchor.hunkIndex}:${input.anchor.lineIndex}`,
    fileId: input.file.id,
    filePath: input.file.newPath,
    anchor: { ...input.anchor },
    oldLineNumber: line.oldLineNumber,
    newLineNumber: line.newLineNumber,
    lineKind: line.kind,
    lineText: line.content,
    contextText,
    scopeLabel: input.scopeLabel,
    body: input.body,
    createdAt: input.now,
  };
}

function lineNumber(comment: ReviewComment): number {
  return comment.newLineNumber ?? comment.oldLineNumber ?? 0;
}

function locationLine(comment: ReviewComment): string {
  return comment.newLineNumber !== undefined
    ? String(comment.newLineNumber)
    : `-${comment.oldLineNumber ?? 0}`;
}

function disposition(comment: ReviewComment): string {
  if (comment.lineKind === "addition") return "added";
  if (comment.lineKind === "deletion") return "removed";
  return "context";
}

function pluralComments(count: number): string {
  return `${count} ${count === 1 ? "comment" : "comments"}`;
}

export function buildReviewMessage(comments: ReviewComment[]): string {
  const ordered = [...comments].sort((left, right) => {
    const pathOrder = left.filePath.localeCompare(right.filePath);
    if (pathOrder !== 0) return pathOrder;
    const lineOrder = lineNumber(left) - lineNumber(right);
    if (lineOrder !== 0) return lineOrder;
    return left.createdAt - right.createdAt;
  });
  const scopes = new Set(ordered.map((comment) => comment.scopeLabel));
  const multipleScopes = scopes.size > 1;
  const scope = multipleScopes
    ? "multiple sources"
    : (ordered[0]?.scopeLabel ?? "multiple sources");
  const header = `Review of ${scope} — ${pluralComments(ordered.length)} from /diff.`;
  const entries = ordered.map((comment, index) => {
    const scopeSuffix = multipleScopes ? ` [${comment.scopeLabel}]` : "";
    // The agent has the file; the anchored line is enough to locate the comment
    // without spending context on surrounding lines it can read itself.
    const anchoredLine =
      `     ${markerForKind(comment.lineKind)}${comment.lineText}`;
    const body = comment.body
      .split("\n")
      .map((line) => `   ${line}`)
      .join("\n");
    return `${index + 1}. ${comment.filePath}:${locationLine(comment)} (${disposition(comment)})${scopeSuffix}\n${anchoredLine}\n\n${body}`;
  });

  const message = `${header}\n\n${entries.join("\n\n")}`;
  return message + renderPlan(buildReviewPlan(ordered));
}

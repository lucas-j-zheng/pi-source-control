import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { ChangedFile, CommitMetadata, DiffReview, RangeMetadata } from "../model/diff.ts";
import type { Styler } from "./theme.ts";

function fitLine(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function modeLabel(viewMode: "unified" | "side-by-side"): string {
  return viewMode === "unified" ? "UNIFIED -/+" : "SIDE-BY-SIDE";
}

function commitMetadata(review: DiffReview): CommitMetadata | undefined {
  return review.metadata && "subject" in review.metadata ? review.metadata : undefined;
}

function rangeMetadata(review: DiffReview): RangeMetadata | undefined {
  return review.metadata && "expression" in review.metadata ? review.metadata : undefined;
}

export function renderHeader(
  review: DiffReview,
  selectedFile: ChangedFile | undefined,
  viewMode: "unified" | "side-by-side",
  width: number,
  styler: Styler,
): string[] {
  const fileSegment = selectedFile ? ` · ${selectedFile.newPath}` : "";
  const mode = modeLabel(viewMode);
  let text: string;

  if (review.scope.kind === "workspace") {
    text = `SOURCE CONTROL${fileSegment} · ${mode}`;
  } else if (review.scope.kind === "commit") {
    const metadata = commitMetadata(review);
    const shortOid = metadata?.shortOid ?? review.scope.commitOid.slice(0, 7);
    const subject = metadata?.subject ?? "";
    const parent = review.scope.parentCount > 1 ? ` · parent 1/${review.scope.parentCount}` : "";
    text = `COMMIT ${shortOid}${subject ? ` · ${subject}` : ""}${fileSegment} · ${mode}${parent}`;
  } else {
    const metadata = rangeMetadata(review);
    const expression = metadata?.expression ?? review.scope.requestedExpression;
    const base = (metadata?.effectiveBaseOid ?? review.scope.effectiveBaseOid).slice(0, 7);
    const right = (metadata?.rightOid ?? review.scope.rightOid).slice(0, 7);
    const comparison = review.scope.mode === "three-dot" ? "merge-base" : "endpoint";
    text = `RANGE ${expression} · ${base} → ${right} · ${comparison} comparison${fileSegment} · ${mode}`;
  }

  return [styler.bold(fitLine(text, width))];
}

import { parseUnifiedDiff } from "../diff/unified-parser.ts";
import type { ChangedFile, DiffReview } from "../model/diff.ts";
import {
  GIT_SAFE_DIFF_FLAGS,
  GitReviewError,
  runOrThrow,
  type GitRunner,
} from "./git-client.ts";
import { resolveRevision } from "./revision-resolver.ts";

export interface RangeRequestInput {
  left: string;
  right: string;
  mode: "two-dot" | "three-dot";
}

export async function findSingleMergeBase(
  runner: GitRunner,
  leftOid: string,
  rightOid: string,
): Promise<string> {
  const result = await runner.run(["merge-base", "--all", leftOid, rightOid]);
  const shortLeft = leftOid.slice(0, 7);
  const shortRight = rightOid.slice(0, 7);
  const mergeBases = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (result.code !== 0 || mergeBases.length === 0) {
    throw new GitReviewError(
      "bad-revision",
      `No merge base between ${shortLeft} and ${shortRight}.`,
      result.stderr,
    );
  }

  if (mergeBases.length > 1) {
    throw new GitReviewError(
      "ambiguous-merge-base",
      `Multiple merge bases between ${shortLeft} and ${shortRight}; three-dot ranges with criss-cross history are unsupported. Use a two-dot range.`,
      result.stderr,
    );
  }

  return mergeBases[0]!;
}

export async function readRangeReview(
  runner: GitRunner,
  repoRoot: string,
  input: RangeRequestInput,
  signal?: AbortSignal,
): Promise<DiffReview> {
  const [leftOid, rightOid] = await Promise.all([
    resolveRevision(runner, input.left),
    resolveRevision(runner, input.right),
  ]);
  const effectiveBaseOid = input.mode === "two-dot"
    ? leftOid
    : await findSingleMergeBase(runner, leftOid, rightOid);
  const runOptions = signal === undefined ? undefined : { signal };
  const rawPatch = await runOrThrow(
    runner,
    [
      "diff",
      ...GIT_SAFE_DIFF_FLAGS,
      "--no-color",
      "--find-renames",
      "--unified=3",
      effectiveBaseOid,
      rightOid,
      "--",
    ],
    "git-failed",
    runOptions,
  );
  const files = parseUnifiedDiff(rawPatch, { group: "range" });
  files.sort(compareByPath);

  const separator = input.mode === "two-dot" ? ".." : "...";
  const requestedExpression = `${input.left}${separator}${input.right}`;

  return {
    repositoryRoot: repoRoot,
    scope: {
      kind: "range",
      requestedExpression,
      mode: input.mode,
      leftOid,
      rightOid,
      effectiveBaseOid,
    },
    groups: [{ id: "range", title: "Files changed", files }],
    metadata: {
      expression: requestedExpression,
      mode: input.mode,
      leftOid,
      rightOid,
      effectiveBaseOid,
    },
    generatedAt: Date.now(),
  };
}

function compareByPath(left: ChangedFile, right: ChangedFile): number {
  return left.newPath < right.newPath
    ? -1
    : left.newPath > right.newPath
      ? 1
      : 0;
}

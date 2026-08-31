import { parseUnifiedDiff } from "../diff/unified-parser.ts";
import type {
  CommitMetadata,
  DiffReview,
} from "../model/diff.ts";
import {
  GIT_SAFE_DIFF_FLAGS,
  runOrThrow,
  type GitRunner,
} from "./git-client.ts";
import {
  LOG_FORMAT,
  parseLogOutput,
} from "./commit-history-reader.ts";
import { resolveRevision } from "./revision-resolver.ts";

export function commitSourceId(oid: string): string {
  return `commit:${oid}`;
}

export async function readCommitMetadata(
  runner: GitRunner,
  commitOid: string,
): Promise<CommitMetadata> {
  const raw = await runOrThrow(runner, [
    "show",
    "-s",
    `--format=${LOG_FORMAT}`,
    commitOid,
    "--",
  ]);
  const commit = parseLogOutput(raw)[0];

  if (commit === undefined) {
    throw new Error(`Git returned no metadata for commit ${commitOid}.`);
  }

  return {
    oid: commit.commitOid,
    shortOid: commit.shortOid,
    subject: commit.subject,
    authorName: commit.author,
    authoredAt: commit.authoredAt,
    parentOids: commit.parentOids,
  };
}

export async function readCommitReview(
  runner: GitRunner,
  repoRoot: string,
  revision: string,
  signal?: AbortSignal,
): Promise<DiffReview> {
  const commitOid = await resolveRevision(runner, revision);
  const metadata = await readCommitMetadata(runner, commitOid);
  const parentOid = metadata.parentOids[0];
  const args = parentOid === undefined
    ? [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "-p",
        ...GIT_SAFE_DIFF_FLAGS,
        "--no-color",
        "--find-renames",
        commitOid,
        "--",
      ]
    : [
        "diff",
        ...GIT_SAFE_DIFF_FLAGS,
        "--no-color",
        "--find-renames",
        "--unified=3",
        parentOid,
        commitOid,
        "--",
      ];
  const rawPatch = await runOrThrow(
    runner,
    args,
    "git-failed",
    signal === undefined ? undefined : { signal },
  );
  const files = parseUnifiedDiff(rawPatch, { group: "commit" });
  files.sort((left, right) =>
    left.newPath < right.newPath ? -1 : left.newPath > right.newPath ? 1 : 0
  );

  return {
    repositoryRoot: repoRoot,
    scope: {
      kind: "commit",
      requestedRevision: revision,
      commitOid,
      parentOid,
      parentIndex: metadata.parentOids.length > 0 ? 0 : undefined,
      parentCount: metadata.parentOids.length,
    },
    groups: [{ id: "commit", title: "Files changed", files }],
    metadata,
    generatedAt: Date.now(),
  };
}

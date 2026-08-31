import type { SourceListItem } from "../model/diff.ts";
import {
  GitReviewError,
  type GitRunner,
} from "./git-client.ts";

export const DEFAULT_HISTORY_COUNT = 20;
export const LOG_FORMAT = "%H%x00%h%x00%P%x00%an%x00%aI%x00%s%x00";

type CommitSource = Extract<SourceListItem, { kind: "commit" }>;

function commitSourceId(oid: string): string {
  return `commit:${oid}`;
}

export function parseLogOutput(raw: string): CommitSource[] {
  const fields = raw.split("\0");
  const commits: CommitSource[] = [];

  for (let offset = 0; offset + 5 < fields.length; offset += 6) {
    // Git terminates each formatted log record with a newline in addition to the
    // final NUL in LOG_FORMAT. That newline prefixes the next record's OID.
    const oid = fields[offset]?.replace(/^[\r\n]+/, "") ?? "";
    if (oid === "") continue;

    const shortOid = fields[offset + 1] ?? "";
    const parents = fields[offset + 2] ?? "";
    const author = fields[offset + 3] ?? "";
    const authoredAt = fields[offset + 4] ?? "";
    const subject = fields[offset + 5] ?? "";

    commits.push({
      kind: "commit",
      id: commitSourceId(oid),
      commitOid: oid,
      shortOid,
      subject,
      author,
      authoredAt,
      parentOids: parents === "" ? [] : parents.split(" "),
    });
  }

  return commits;
}

export const HEAD_VERIFY_ARGS: readonly string[] = Object.freeze([
  "rev-parse",
  "--verify",
  "--quiet",
  "--end-of-options",
  "HEAD",
]);

/**
 * Does the repository have no commits yet?
 *
 * Structural, not textual: `rev-parse --verify --quiet HEAD` prints nothing and
 * exits 1 when HEAD is unborn, so no English (or translated) stderr is read.
 * A repository that is not a repository at all, or any other hard failure,
 * exits 128 with stderr and is deliberately *not* reported as empty — that must
 * still surface as an error from the caller.
 */
async function headIsUnborn(
  runner: GitRunner,
  signal?: AbortSignal,
): Promise<boolean> {
  const args = [...HEAD_VERIFY_ARGS];
  const result = await (signal === undefined
    ? runner.run(args)
    : runner.run(args, { signal })).catch(() => undefined);

  if (result === undefined) return false;
  return result.code === 1 && result.stdout.trim() === "" &&
    result.stderr.trim() === "";
}

export async function readRecentCommits(
  runner: GitRunner,
  count = DEFAULT_HISTORY_COUNT,
  signal?: AbortSignal,
): Promise<CommitSource[]> {
  const args = [
    "log",
    `--max-count=${count}`,
    `--format=${LOG_FORMAT}`,
    "HEAD",
    "--",
  ];
  const result = signal === undefined
    ? await runner.run(args)
    : await runner.run(args, { signal });

  if (result.code !== 0) {
    if (await headIsUnborn(runner, signal)) {
      return [];
    }

    // Fallback only: git's English wording, for a host where the structural
    // check above could not be made. The environment cannot be pinned to
    // `LC_ALL=C` under Pi, so a translated git reaches here with localized
    // stderr and must not be the thing the empty-repository path depends on.
    if (
      /unknown revision|does not have any commits/i.test(result.stderr) ||
      /bad revision ['"]?HEAD['"]?/i.test(result.stderr)
    ) {
      return [];
    }

    const firstStderrLine = result.stderr.trim().split(/\r?\n/, 1)[0];
    throw new GitReviewError(
      "git-failed",
      firstStderrLine || "Git command failed.",
      result.stderr,
    );
  }

  return parseLogOutput(result.stdout);
}

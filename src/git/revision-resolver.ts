import { isSafeRevision } from "../command/review-request-parser.ts";
import {
  GitReviewError,
  type GitRunner,
} from "./git-client.ts";

const FULL_OID = /^[0-9a-f]{40}$/;

export async function resolveRevision(
  runner: GitRunner,
  revision: string,
): Promise<string> {
  if (!isSafeRevision(revision)) {
    throw badRevision(revision);
  }

  const result = await runner.run([
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${revision}^{commit}`,
  ]);
  const oid = result.stdout.trim();

  if (result.code !== 0 || !FULL_OID.test(oid)) {
    throw badRevision(revision, result.stderr);
  }

  return oid;
}

function badRevision(revision: string, stderr?: string): GitReviewError {
  return new GitReviewError(
    "bad-revision",
    `Could not resolve revision: ${revision}\nUse /diff commit <revision> or /diff range <base>...<head>.`,
    stderr,
  );
}

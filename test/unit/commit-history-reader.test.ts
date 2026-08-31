import { describe, expect, it } from "vitest";

import { readRecentCommits } from "../../src/git/commit-history-reader.ts";
import {
  GitReviewError,
  type GitResult,
  type GitRunner,
} from "../../src/git/git-client.ts";

interface Recorded {
  calls: string[][];
  runner: GitRunner;
}

function runnerFor(
  respond: (args: string[]) => GitResult,
): Recorded {
  const calls: string[][] = [];
  return {
    calls,
    runner: {
      async run(args) {
        calls.push([...args]);
        return respond(args);
      },
    },
  };
}

function result(overrides: Partial<GitResult>): GitResult {
  return { stdout: "", stderr: "", code: 0, ...overrides };
}

/**
 * `git log HEAD` in an unborn repository, as a translated git reports it. The
 * shipped Pi drops `env`, so `LC_ALL=C` cannot be relied on and no
 * English-literal match may be what decides this case.
 */
const LOCALIZED_LOG_FAILURE = result({
  code: 128,
  stderr:
    "fatal: Ihr aktueller Branch 'main' hat noch keine Commits.\n",
});

describe("commit history reader", () => {
  it("an empty repository is detected without relying on English stderr", async () => {
    const subject = runnerFor((args) =>
      args[0] === "log"
        ? LOCALIZED_LOG_FAILURE
        // `rev-parse --verify --quiet HEAD` on an unborn HEAD: exit 1, silent.
        : result({ code: 1 })
    );

    await expect(readRecentCommits(subject.runner)).resolves.toEqual([]);
    expect(subject.calls[1]).toEqual([
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      "HEAD",
    ]);
  });

  it("a hard git failure is still an error, not an empty history", async () => {
    // A non-repository (or a broken one) also fails `git log`, but `rev-parse`
    // exits 128 with stderr rather than 1 in silence — that must not be read as
    // "no commits yet".
    const subject = runnerFor(() =>
      result({
        code: 128,
        stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
      })
    );

    const failure = await readRecentCommits(subject.runner).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(GitReviewError);
    expect((failure as GitReviewError).message).toBe(
      "fatal: not a git repository (or any of the parent directories): .git",
    );
  });

  it("the English stderr match survives only as a fallback", async () => {
    // HEAD verifies, so the structural check says nothing; the legacy wording
    // match is what recognizes the empty history here.
    const subject = runnerFor((args) =>
      args[0] === "log"
        ? result({
          code: 128,
          stderr: "fatal: bad revision 'HEAD'\n",
        })
        : result({ code: 0, stdout: `${"a".repeat(40)}\n` })
    );

    await expect(readRecentCommits(subject.runner)).resolves.toEqual([]);
  });

  it("a successful log is parsed without any extra rev-parse", async () => {
    const oid = "c".repeat(40);
    const subject = runnerFor(() =>
      result({
        stdout: [
          oid,
          oid.slice(0, 7),
          "",
          "Ada",
          "2026-08-25T12:00:00Z",
          "Only commit",
          "",
        ].join("\0"),
      })
    );

    const commits = await readRecentCommits(subject.runner);

    expect(commits).toMatchObject([{ commitOid: oid, subject: "Only commit" }]);
    expect(subject.calls).toHaveLength(1);
  });
});

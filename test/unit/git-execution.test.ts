import { describe, expect, it } from "vitest";

import {
  createPiGitRunner,
  type ExecLike,
} from "../../src/command/diff-command.ts";
import {
  ALLOWED_GLOBAL_GIT_FLAGS,
  assertReadOnly,
  GIT_GLOBAL_FLAGS,
  GitReviewError,
  runOrThrow,
  type GitRunner,
} from "../../src/git/git-client.ts";
import { readCommitReview } from "../../src/git/commit-review-reader.ts";
import { readRangeReview } from "../../src/git/range-review-reader.ts";
import { readWorkspaceReview } from "../../src/git/workspace-review-reader.ts";

const ROOT = "/repo";
const COMMIT_OID = "a".repeat(40);
const PARENT_OID = "b".repeat(40);
const LEFT_OID = "c".repeat(40);
const RIGHT_OID = "d".repeat(40);

interface ExecCall {
  cmd: string;
  args: string[];
  opts?: {
    cwd?: string;
    signal?: AbortSignal;
    timeout?: number;
    env?: Readonly<Record<string, string>>;
  };
}

type ExecResult = Awaited<ReturnType<ExecLike>>;

function ok(stdout = ""): ExecResult {
  return { stdout, stderr: "", code: 0, killed: false };
}

function logRecord(oid: string, parentOids: string): string {
  return [
    oid,
    oid.slice(0, 7),
    parentOids,
    "Ada",
    "2026-08-25T12:00:00Z",
    "A commit",
    "",
  ].join("\0");
}

/** The argv minus the global flags the runner prepends. */
function subcommand(args: string[]): string[] {
  let index = 0;
  while (GIT_GLOBAL_FLAGS.includes(args[index] ?? "")) index += 1;
  return args.slice(index);
}

/** Recorded argv, global flags stripped, for the given subcommand only. */
function argvFor(calls: ExecCall[], name: string): string[][] {
  return calls
    .map((call) => subcommand(call.args))
    .filter((args) => args[0] === name);
}

function cannedResult(args: string[]): ExecResult {
  const command = args[0];
  if (command === "rev-parse" && args[1] === "--show-toplevel") {
    return ok(`${ROOT}\n`);
  }
  if (command === "rev-parse" && args[1] === "--verify") {
    const revision = args[4]?.replace(/\^\{commit\}$/u, "");
    const oid = revision === "left"
      ? LEFT_OID
      : revision === "right"
        ? RIGHT_OID
        : COMMIT_OID;
    return ok(`${oid}\n`);
  }
  if (command === "show" || command === "log") {
    return ok(logRecord(COMMIT_OID, PARENT_OID));
  }
  if (command === "merge-base") {
    return ok(`${LEFT_OID}\n`);
  }
  return ok();
}

function recorder(
  responder: (args: string[]) => ExecResult = cannedResult,
): { calls: ExecCall[]; exec: ExecLike; runner: GitRunner } {
  const calls: ExecCall[] = [];
  const exec: ExecLike = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return responder(subcommand(args));
  };
  return { calls, exec, runner: createPiGitRunner(exec, ROOT) };
}

describe("git execution hardening", () => {
  it("a killed result is an error even when the exit code is zero", async () => {
    // Pi resolves a SIGTERM'd child as `code ?? 0`, so a timed-out `git diff`
    // would otherwise hand a truncated patch to the reviewer as the whole truth.
    const { runner } = recorder(() => ({
      stdout: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-par",
      stderr: "",
      code: 0,
      killed: true,
    }));

    const failure = await runOrThrow(runner, [
      "diff",
      "--no-ext-diff",
      "--",
    ]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GitReviewError);
    expect((failure as GitReviewError).code).toBe("git-failed");
    expect((failure as GitReviewError).message).toBe(
      "Git command timed out after 10000 ms.",
    );
  });

  it("an aborted command reports the abort rather than a timeout", async () => {
    const controller = new AbortController();
    const { runner } = recorder(() => {
      controller.abort();
      return { stdout: "partial", stderr: "", code: 0, killed: true };
    });

    const failure = await runOrThrow(
      runner,
      ["status", "--porcelain=v1"],
      "git-failed",
      { signal: controller.signal },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GitReviewError);
    expect((failure as GitReviewError).message).toBe(
      "Git command was cancelled.",
    );
  });

  it("the runner pins GIT_OPTIONAL_LOCKS, LC_ALL and GIT_PAGER", async () => {
    const { calls, runner } = recorder();

    await runner.run(["rev-parse", "--show-toplevel"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts?.env).toEqual({
      GIT_OPTIONAL_LOCKS: "0",
      LC_ALL: "C",
      GIT_PAGER: "cat",
    });
  });

  it("patch commands carry --no-textconv and pin the prefixes on older git", async () => {
    const workspace = recorder();
    await readWorkspaceReview(workspace.runner, ROOT);
    expect(argvFor(workspace.calls, "diff")).toEqual([
      [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--no-color",
        "--find-renames",
        "--unified=3",
        "--",
      ],
    ]);
    expect(argvFor(workspace.calls, "diff-files")).toEqual([
      [
        "diff-files",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--no-color",
        "--find-renames",
        "--unified=3",
        "--",
      ],
    ]);

    const commit = recorder();
    await readCommitReview(commit.runner, ROOT, "HEAD");
    expect(argvFor(commit.calls, "diff")).toEqual([
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--no-color",
        "--find-renames",
        "--unified=3",
        PARENT_OID,
        COMMIT_OID,
        "--",
      ],
    ]);

    const rootCommit = recorder((args) =>
      args[0] === "show" ? ok(logRecord(COMMIT_OID, "")) : cannedResult(args)
    );
    await readCommitReview(rootCommit.runner, ROOT, "HEAD");
    expect(argvFor(rootCommit.calls, "diff-tree")).toEqual([
      [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "-p",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--no-color",
        "--find-renames",
        COMMIT_OID,
        "--",
      ],
    ]);

    const range = recorder();
    await readRangeReview(range.runner, ROOT, {
      left: "left",
      right: "right",
      mode: "two-dot",
    });
    expect(argvFor(range.calls, "diff")).toEqual([
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--no-color",
        "--find-renames",
        "--unified=3",
        LEFT_OID,
        RIGHT_OID,
        "--",
      ],
    ]);
  });

  it("status, log and rev-parse argv are unchanged", async () => {
    const workspace = recorder();
    await readWorkspaceReview(workspace.runner, ROOT);
    expect(argvFor(workspace.calls, "status")).toEqual([
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ]);

    const commit = recorder();
    await readCommitReview(commit.runner, ROOT, "HEAD");
    const plumbing = commit.calls
      .map((call) => subcommand(call.args))
      .filter((args) => args[0] !== "diff" && args[0] !== "diff-tree");
    for (const args of plumbing) {
      expect(args).not.toContain("--no-textconv");
      expect(args).not.toContain("--src-prefix=a/");
      expect(args).not.toContain("--dst-prefix=b/");
      expect(args).not.toContain("--no-ext-diff");
    }
    expect(plumbing[0]).toEqual([
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      "HEAD^{commit}",
    ]);
  });
  it("every git invocation carries --no-optional-locks", async () => {
    // `GIT_OPTIONAL_LOCKS=0` is inert under the shipped Pi — its `ExecOptions`
    // is `{ signal?, timeout?, cwd? }` and `execCommand` never forwards `env` to
    // `spawn` — so this argv-level flag is the only thing that stops a plain
    // `git status` from refreshing stale stat data and rewriting `.git/index`.
    const workspace = recorder();
    await readWorkspaceReview(workspace.runner, ROOT);
    const commit = recorder();
    await readCommitReview(commit.runner, ROOT, "HEAD");
    const range = recorder();
    await readRangeReview(range.runner, ROOT, {
      left: "left",
      right: "right",
      mode: "three-dot",
    });

    const calls = [...workspace.calls, ...commit.calls, ...range.calls];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.cmd).toBe("git");
      expect(call.args[0]).toBe("--no-optional-locks");
      // Once, and only ahead of the subcommand: git rejects a global flag that
      // appears after it, so a duplicate would break the command outright.
      expect(call.args.indexOf("--no-optional-locks")).toBe(
        call.args.lastIndexOf("--no-optional-locks"),
      );
      expect(subcommand(call.args)[0]).not.toMatch(/^-/u);
    }
  });

  it("assertReadOnly accepts a leading global flag and still validates the subcommand", () => {
    expect(() => assertReadOnly(["--no-optional-locks", "status"])).not.toThrow();
    expect(() =>
      assertReadOnly(["--no-optional-locks", "--no-pager", "diff", "--"])
    ).not.toThrow();
    expect(() => assertReadOnly(["--no-pager", "log", "--max-count=1"]))
      .not.toThrow();
    // Unchanged: an argv with no global flag at all is still validated.
    expect(() => assertReadOnly(["rev-parse", "--show-toplevel"])).not.toThrow();

    // A leading global flag must not smuggle a mutating subcommand past the
    // guard: the first non-flag token is still the thing being checked.
    for (
      const command of [
        "commit",
        "clean",
        "checkout",
        "add",
        "reset",
        "push",
        "gc",
        "config",
        "stash",
        "update-index",
      ]
    ) {
      expect(
        () => assertReadOnly(["--no-optional-locks", command]),
        command,
      ).toThrowError(`Refusing to run non-read-only Git command: ${command}`);
      expect(() => assertReadOnly([command]), command).toThrowError(
        GitReviewError,
      );
    }

    // The allowlist is exactly two value-less literals. Widening it is the
    // failure mode this whole test exists to catch.
    expect([...ALLOWED_GLOBAL_GIT_FLAGS].sort()).toEqual([
      "--no-optional-locks",
      "--no-pager",
    ]);
  });

  it("assertReadOnly rejects -c, --exec-path, a value-taking flag, and a flags-only argv", () => {
    const rejected: string[][] = [
      // -c can hand git code to run (`core.fsmonitor`, `core.pager`, aliases),
      // and its value token would otherwise be mistaken for the subcommand.
      ["-c", "core.fsmonitor=/tmp/evil", "status"],
      ["-c", "core.pager=/tmp/evil", "log"],
      ["--config-env=core.fsmonitor=EVIL", "status"],
      // --exec-path relocates the git binaries directory.
      ["--exec-path=/tmp/evil", "diff"],
      ["--exec-path", "/tmp/evil", "diff"],
      // Repository redirection, in both the separate and =-joined spellings.
      ["--git-dir", "/tmp/other/.git", "status"],
      ["--git-dir=/tmp/other/.git", "status"],
      ["--work-tree", "/tmp/other", "status"],
      ["--work-tree=/tmp/other", "status"],
      ["--namespace", "refs/evil", "log"],
      ["--namespace=refs/evil", "log"],
      ["-C", "/tmp/other", "status"],
      ["--upload-pack=/tmp/evil", "rev-list"],
      // Anything unrecognized, even where it is harmless in isolation.
      ["--literal-pathspecs", "status"],
      ["--bare", "status"],
      ["--no-optional-locks=0", "status"],
      ["--", "status"],
      ["", "status"],
      // No subcommand at all, with and without allowed global flags.
      [],
      ["--no-optional-locks"],
      ["--no-pager"],
      ["--no-optional-locks", "--no-pager"],
      // Still rejected behind an allowed flag.
      ["--no-optional-locks", "commit", "-m", "nope"],
      ["--no-pager", "-c", "core.fsmonitor=/tmp/evil", "status"],
    ];

    for (const args of rejected) {
      expect(() => assertReadOnly(args), args.join(" ") || "<empty argv>")
        .toThrowError(GitReviewError);
    }
  });
});

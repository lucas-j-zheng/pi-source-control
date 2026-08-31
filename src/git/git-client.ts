import { spawn } from "node:child_process";

export type GitErrorCode =
  | "not-a-repo"
  | "git-unavailable"
  | "bad-revision"
  | "ambiguous-merge-base"
  | "git-failed";

export class GitReviewError extends Error {
  constructor(
    public readonly code: GitErrorCode,
    message: string,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "GitReviewError";
  }
}

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GitRunner {
  run(
    args: string[],
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<GitResult>;
}

export const GIT_TIMEOUT_MS = 10_000;

/**
 * Environment pinned onto every git invocation.
 *
 * `GIT_OPTIONAL_LOCKS=0` suppresses the optional index refreshes that honour
 * it, `LC_ALL=C` makes diagnostics deterministic when the host forwards the
 * environment, and `GIT_PAGER=cat` stops a user's pager from ever being
 * spawned around captured output.
 *
 * The shipped Pi host cannot honour this: its `ExecOptions` is
 * `{ signal?, timeout?, cwd? }` and `execCommand` never forwards `env` to
 * `spawn`, so under Pi these pins are inert. They still apply under
 * `createNodeGitRunner`, and become effective under Pi if it gains support, but
 * nothing may depend on them — see `GIT_GLOBAL_FLAGS` for the argv-level pin
 * that always works, and `commit-history-reader.ts` for the locale-independent
 * replacement of the `LC_ALL=C` stderr matching.
 */
export const GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
  GIT_PAGER: "cat",
});

/**
 * Flags every patch-producing command carries.
 *
 * `--no-ext-diff` and `--no-textconv` stop a repository-supplied
 * `.gitattributes` (plus a `diff.<driver>.textconv` / `diff.external` config)
 * from executing a command while we merely read a diff. `--src-prefix=a/` and
 * `--dst-prefix=b/` pin the prefixes so `diff.noprefix`, `diff.mnemonicPrefix`
 * or a custom `diff.srcPrefix` / `diff.dstPrefix` cannot corrupt the paths the
 * unified parser reads back out. They say the same thing as
 * `--default-prefix` but exist on every git that has `--no-ext-diff`, whereas
 * `--default-prefix` needs git >= 2.41 and this package declares no git floor.
 */
export const GIT_SAFE_DIFF_FLAGS: readonly string[] = Object.freeze([
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
]);

/**
 * Global flags prepended to every git invocation, ahead of the subcommand.
 *
 * `--no-optional-locks` is the argv-level equivalent of `GIT_OPTIONAL_LOCKS=0`
 * and needs no environment support, so it holds even under a host that drops
 * `env`. Without it a plain `git status` refreshes stale stat data and rewrites
 * `.git/index` underneath a review that is supposed to only read.
 */
export const GIT_GLOBAL_FLAGS: readonly string[] = Object.freeze([
  "--no-optional-locks",
]);

/** Prepend {@link GIT_GLOBAL_FLAGS} to a caller-supplied argv. */
export function withGlobalFlags(args: readonly string[]): string[] {
  return [...GIT_GLOBAL_FLAGS, ...args];
}

/**
 * The only tokens allowed before the subcommand.
 *
 * This is an exact-literal allowlist, deliberately not a pattern. Every other
 * global flag is refused, including any flag that consumes the token after it
 * (`-c`, `-C`, `--git-dir`, `--work-tree`, `--namespace`) or carries a value in
 * an `=` suffix (`--exec-path=…`), because such a flag would let the token this
 * function validates as "the subcommand" be an argument instead — and because
 * `-c` alone can turn a read-only command into one that runs code
 * (`-c core.fsmonitor=…`).
 */
export const ALLOWED_GLOBAL_GIT_FLAGS: ReadonlySet<string> = new Set([
  "--no-optional-locks",
  "--no-pager",
]);

export const READ_ONLY_GIT_COMMANDS: ReadonlySet<string> = new Set([
  "rev-parse",
  "status",
  "diff",
  "diff-files",
  "diff-tree",
  "show",
  "rev-list",
  "merge-base",
  "log",
]);

export function assertReadOnly(args: readonly string[]): void {
  let index = 0;
  while (
    index < args.length &&
    ALLOWED_GLOBAL_GIT_FLAGS.has(args[index] as string)
  ) {
    index += 1;
  }

  const command = args[index];
  if (command === undefined || !READ_ONLY_GIT_COMMANDS.has(command)) {
    throw new GitReviewError(
      "git-failed",
      `Refusing to run non-read-only Git command: ${command ?? "<missing>"}`,
    );
  }
}

/**
 * The error a killed git child reports. A killed command has partial output at
 * best, so it is never a success no matter what exit code the host reports.
 */
export function killedError(
  reason: "abort" | "timeout",
  timeoutMs: number,
  stderr?: string,
): GitReviewError {
  return new GitReviewError(
    "git-failed",
    reason === "abort"
      ? "Git command was cancelled."
      : `Git command timed out after ${timeoutMs} ms.`,
    stderr,
  );
}

export function createNodeGitRunner(cwd: string): GitRunner {
  return {
    async run(args, options = {}) {
      // Validate the argv that actually reaches git, global flags included, so
      // the guard can never be handed a different command than the one spawned.
      const argv = withGlobalFlags(args);
      assertReadOnly(argv);

      return await new Promise<GitResult>((resolve, reject) => {
        const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
        const child = spawn("git", argv, {
          cwd,
          shell: false,
          env: {
            ...process.env,
            ...GIT_ENV,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        // Pi resolves a SIGTERM'd child as `code ?? 0`; the same partial-output
        // trap exists here, so a child we killed never resolves successfully.
        let killedBy: "abort" | "timeout" | undefined;

        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", abort);
          callback();
        };

        const abort = (): void => {
          killedBy = "abort";
          child.kill();
          const reason = options.signal?.reason;
          finish(() =>
            reject(
              reason instanceof Error
                ? reason
                : new DOMException("The operation was aborted", "AbortError"),
            ),
          );
        };

        const timeout = setTimeout(() => {
          killedBy = "timeout";
          child.kill();
          finish(() => reject(killedError("timeout", timeoutMs, stderr)));
        }, timeoutMs);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", (error: NodeJS.ErrnoException) => {
          const detail = stderr.trim() || error.message;
          finish(() => {
            if (error.code === "ENOENT") {
              reject(
                new GitReviewError(
                  "git-unavailable",
                  `Git could not be executed.\n${detail}`,
                  detail,
                ),
              );
              return;
            }

            reject(new GitReviewError("git-failed", detail, detail));
          });
        });
        child.on("close", (code) => {
          finish(() => {
            if (killedBy !== undefined) {
              reject(killedError(killedBy, timeoutMs, stderr));
              return;
            }
            resolve({ stdout, stderr, code: code ?? 1 });
          });
        });

        if (options.signal?.aborted) {
          abort();
        } else {
          options.signal?.addEventListener("abort", abort, { once: true });
        }
      });
    },
  };
}

export async function detectRepositoryRoot(runner: GitRunner): Promise<string> {
  const result = await runner.run(["rev-parse", "--show-toplevel"]);
  if (result.code !== 0) {
    throw new GitReviewError(
      "not-a-repo",
      "This directory is not inside a Git repository.\nRun Pi from a repository or initialize one with git init.",
      result.stderr,
    );
  }

  return result.stdout.trim();
}

export async function runOrThrow(
  runner: GitRunner,
  args: string[],
  code: GitErrorCode = "git-failed",
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<string> {
  const result = options === undefined
    ? await runner.run(args)
    : await runner.run(args, options);
  if (result.code !== 0) {
    const firstStderrLine = result.stderr.trim().split(/\r?\n/, 1)[0];
    throw new GitReviewError(
      code,
      firstStderrLine || "Git command failed.",
      result.stderr,
    );
  }

  return result.stdout;
}

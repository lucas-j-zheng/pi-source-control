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

export const READ_ONLY_GIT_COMMANDS: ReadonlySet<string> = new Set([
  "rev-parse",
  "status",
  "diff",
  "diff-tree",
  "show",
  "rev-list",
  "merge-base",
  "log",
]);

export function assertReadOnly(args: string[]): void {
  const command = args[0];
  if (command === undefined || !READ_ONLY_GIT_COMMANDS.has(command)) {
    throw new GitReviewError(
      "git-failed",
      `Refusing to run non-read-only Git command: ${command ?? "<missing>"}`,
    );
  }
}

export function createNodeGitRunner(cwd: string): GitRunner {
  return {
    async run(args, options = {}) {
      assertReadOnly(args);

      return await new Promise<GitResult>((resolve, reject) => {
        const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
        const child = spawn("git", args, {
          cwd,
          shell: false,
          env: {
            ...process.env,
            GIT_OPTIONAL_LOCKS: "0",
            LC_ALL: "C",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (callback: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", abort);
          callback();
        };

        const abort = (): void => {
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
          child.kill();
          finish(() =>
            reject(
              new GitReviewError(
                "git-failed",
                `Git command timed out after ${timeoutMs} ms.`,
                stderr,
              ),
            ),
          );
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
          finish(() => resolve({ stdout, stderr, code: code ?? 1 }));
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

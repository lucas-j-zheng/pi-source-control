import { readRecentCommits } from "../git/commit-history-reader.ts";
import {
  commitSourceId,
  readCommitReview,
} from "../git/commit-review-reader.ts";
import {
  assertReadOnly,
  detectRepositoryRoot,
  GIT_ENV,
  GIT_TIMEOUT_MS,
  GitReviewError,
  killedError,
  withGlobalFlags,
  type GitRunner,
} from "../git/git-client.ts";
import { readRangeReview } from "../git/range-review-reader.ts";
import { readWorkspaceReview } from "../git/workspace-review-reader.ts";
import type {
  DiffReview,
  ReviewRequest,
  SourceListItem,
} from "../model/diff.ts";
import {
  SourceControlView,
  type ViewDataSource,
} from "../ui/source-control-view.ts";
import type { Styler } from "../ui/theme.ts";
import {
  deliverReview,
  type ReviewDeliverySink,
} from "./review-delivery.ts";
import {
  parseReviewRequest,
  ReviewRequestError,
} from "./review-request-parser.ts";

export interface ExecLike {
  (
    cmd: string,
    args: string[],
    opts?: {
      cwd?: string;
      signal?: AbortSignal;
      timeout?: number;
      env?: Readonly<Record<string, string>>;
    },
  ): Promise<{
    stdout: string;
    stderr: string;
    code: number;
    killed: boolean;
  }>;
}

export function createPiGitRunner(exec: ExecLike, cwd: string): GitRunner {
  return {
    async run(args, options = {}) {
      // Validate the argv that actually reaches git, global flags included, so
      // the guard can never be handed a different command than the one spawned.
      const argv = withGlobalFlags(args);
      assertReadOnly(argv);
      const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
      const result = await exec("git", argv, {
        cwd,
        signal: options.signal,
        timeout: timeoutMs,
        // The shipped Pi drops `env` (its ExecOptions has no such field and
        // execCommand never forwards one to spawn), so nothing may depend on
        // these pins: `--no-optional-locks` in the argv carries the guarantee
        // that matters. Passing them stays correct if Pi gains support.
        env: GIT_ENV,
      });
      // Pi kills a timed-out or aborted child with SIGTERM and then resolves it
      // as `code ?? 0` (see pi-coding-agent dist/core/exec.js), so the exit code
      // alone would report a truncated patch as a complete one. `killed` is the
      // only signal that the output is partial, and it outranks the code.
      if (result.killed) {
        throw killedError(
          options.signal?.aborted === true ? "abort" : "timeout",
          timeoutMs,
          result.stderr,
        );
      }
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      };
    },
  };
}

export interface LoadedReview {
  review: DiffReview;
  recentCommits: SourceListItem[];
  initialSourceId: string;
}

export async function loadInitialReview(
  runner: GitRunner,
  request: ReviewRequest,
  signal?: AbortSignal,
): Promise<LoadedReview> {
  const root = await detectRepositoryRoot(runner);
  if (request.kind === "workspace") {
    const [review, recentCommits] = await Promise.all([
      readWorkspaceReview(runner, root, { signal }),
      readRecentCommits(runner, undefined, signal),
    ]);
    return {
      review,
      recentCommits,
      initialSourceId: request.initialSource,
    };
  }

  if (request.kind === "commit") {
    const review = await readCommitReview(
      runner,
      root,
      request.revision,
      signal,
    );
    if (review.scope.kind !== "commit") {
      throw new Error("Commit reader returned a non-commit review.");
    }
    return {
      review,
      recentCommits: [],
      initialSourceId: commitSourceId(review.scope.commitOid),
    };
  }

  return {
    review: await readRangeReview(runner, root, request, signal),
    recentCommits: [],
    initialSourceId: "range",
  };
}

export function createDataSource(
  runner: GitRunner,
  request: ReviewRequest,
  loaded: LoadedReview,
): ViewDataSource {
  const root = loaded.review.repositoryRoot;
  return {
    initialReview: loaded.review,
    recentCommits: loaded.recentCommits,
    loadCommit: async (oid, signal) =>
      await readCommitReview(runner, root, oid, signal),
    refresh: async (signal) => {
      const refreshed = await loadInitialReview(runner, request, signal);
      return {
        review: refreshed.review,
        recentCommits: refreshed.recentCommits,
      };
    },
  };
}

export function userMessageForError(err: unknown): string {
  if (err instanceof ReviewRequestError || err instanceof GitReviewError) {
    return err.message;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `Unexpected error: ${message}`;
}

export interface DiffCommandDeps {
  exec: ExecLike;
  cwd: string;
  mode: string;
  notify(msg: string, level: "info" | "warning" | "error"): void;
  setEditorText(text: string): void;
  /**
   * Submit the review as a user turn so Pi starts on it without a further
   * keypress. Undefined when the host build cannot send; delivery then falls
   * back to setEditorText.
   */
  sendUserMessage?: ReviewDeliverySink;
  openView(
    factory: (
      host: { requestRender(): void; rows(): number },
      styler: Styler,
      done: () => void,
    ) => SourceControlView,
  ): Promise<void>;
  signal?: AbortSignal;
}

export async function runDiffCommand(
  args: string,
  deps: DiffCommandDeps,
): Promise<void> {
  if (deps.mode !== "tui") {
    deps.notify("/diff requires interactive TUI mode", "error");
    return;
  }

  try {
    const request = parseReviewRequest(args);
    const runner = createPiGitRunner(deps.exec, deps.cwd);
    await detectRepositoryRoot(runner);
    const loaded = await loadInitialReview(runner, request, deps.signal);
    const data = createDataSource(runner, request, loaded);
    // Pi snapshots the prompt text when the custom view opens and restores it on
    // close, so the review message has to be set after the view has gone.
    let reviewMessage: string | undefined;
    let reviewCommentCount = 0;
    await deps.openView(
      (host, styler, done) =>
        new SourceControlView({
          data,
          host,
          styler,
          initialSourceId: loaded.initialSourceId,
          submitReview: (message, commentCount) => {
            reviewMessage = message;
            reviewCommentCount = commentCount;
          },
          onClose: done,
        }),
    );
    if (reviewMessage !== undefined) {
      deliverReview(reviewMessage, reviewCommentCount, deps);
    }
  } catch (error) {
    deps.notify(userMessageForError(error), "error");
  }
}

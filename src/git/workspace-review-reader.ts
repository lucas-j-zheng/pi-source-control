import { fingerprintFilePatch } from "../diff/patch-fingerprint.ts";
import type {
  ChangedFile,
  DiffGroupId,
  DiffReview,
  StatusEntry,
} from "../model/diff.ts";
import {
  GIT_SAFE_DIFF_FLAGS,
  runOrThrow,
  type GitRunner,
} from "./git-client.ts";
import {
  parsePorcelainStatus,
  statusForIndex,
  statusForWorkTree,
} from "./status-parser.ts";
import { readUntrackedFile } from "./untracked-file.ts";
import {
  applyPatchLimit,
  consumePatchBudget,
  createPatchBudget,
  MAX_PATCH_BYTES,
  MAX_TOTAL_PATCH_BYTES,
} from "./patch-limits.ts";

export { MAX_PATCH_BYTES, MAX_TOTAL_PATCH_BYTES } from "./patch-limits.ts";

export interface WorkspaceReadOptions {
  signal?: AbortSignal;
  maxPatchBytes?: number;
  maxTotalPatchBytes?: number;
}

export const STAGED_DIFF_ARGS: readonly string[] = [
  "diff",
  "--cached",
  ...GIT_SAFE_DIFF_FLAGS,
  "--no-color",
  "--find-renames",
  "--unified=3",
  "--",
];

export const WORKING_DIFF_ARGS: readonly string[] = [
  // `git diff` refreshes and writes stale index stat data even with the global
  // `--no-optional-locks` flag. `diff-files` is its read-only plumbing
  // equivalent for comparing the index to the work tree and does not write the
  // refreshed cache back to `.git/index`.
  "diff-files",
  ...GIT_SAFE_DIFF_FLAGS,
  "--no-color",
  "--find-renames",
  "--unified=3",
  "--",
];

const STATUS_ARGS = [
  "status",
  "--porcelain=v1",
  "-z",
  "--untracked-files=all",
] as const;
export const MAX_UNTRACKED_READ_CONCURRENCY = 8;

export async function readWorkspaceReview(
  runner: GitRunner,
  repoRoot: string,
  options: WorkspaceReadOptions = {},
): Promise<DiffReview> {
  const runOptions = options.signal === undefined
    ? undefined
    : { signal: options.signal };
  const [rawStatus, stagedPatch, workingPatch] = await Promise.all([
    runOrThrow(runner, [...STATUS_ARGS], "git-failed", runOptions),
    runOrThrow(runner, [...STAGED_DIFF_ARGS], "git-failed", runOptions),
    runOrThrow(runner, [...WORKING_DIFF_ARGS], "git-failed", runOptions),
  ]);

  const entries = parsePorcelainStatus(rawStatus);
  const maxPatchBytes = options.maxPatchBytes ?? MAX_PATCH_BYTES;
  const budget = createPatchBudget(
    options.maxTotalPatchBytes ?? MAX_TOTAL_PATCH_BYTES,
  );
  const stagedFiles = applyStatusToFiles(
    applyPatchLimit(stagedPatch, "staged", budget, maxPatchBytes),
    entries,
    "index",
  );
  const trackedWorkingFiles = applyStatusToFiles(
    applyPatchLimit(workingPatch, "working", budget, maxPatchBytes),
    entries,
    "workTree",
  );
  const untrackedEntries = entries.filter(
    (entry) => entry.index === "?" && entry.workTree === "?",
  );
  const untrackedFiles = await mapWithConcurrency(
    untrackedEntries,
    MAX_UNTRACKED_READ_CONCURRENCY,
    (entry) =>
      readUntrackedFile(repoRoot, entry.path, {
        reserveBytes: (byteLength) => consumePatchBudget(budget, byteLength),
      }),
  );
  const workingFiles = [...trackedWorkingFiles, ...untrackedFiles];

  stagedFiles.sort(compareByPath);
  workingFiles.sort(compareByPath);

  return {
    repositoryRoot: repoRoot,
    scope: { kind: "workspace" },
    groups: [
      { id: "working", title: "Working Tree", files: workingFiles },
      { id: "staged", title: "Staged Changes", files: stagedFiles },
    ],
    generatedAt: Date.now(),
  };
}

export function applyStatusToFiles(
  files: ChangedFile[],
  entries: StatusEntry[],
  column: "index" | "workTree",
): ChangedFile[] {
  const statusForEntry = column === "index" ? statusForIndex : statusForWorkTree;
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const result = files.map((file) => {
    const entry = entriesByPath.get(file.newPath);
    if (entry === undefined) return file;

    const status = statusForEntry(entry);
    return status === undefined ? file : { ...file, status };
  });
  const existingPaths = new Set(result.map((file) => file.newPath));
  const group: DiffGroupId = column === "index" ? "staged" : "working";

  for (const entry of entries) {
    if (
      statusForEntry(entry) === "unmerged" &&
      !existingPaths.has(entry.path)
    ) {
      result.push(statusOnlyFile(group, entry.path));
      existingPaths.add(entry.path);
    }
  }

  return result;
}

function statusOnlyFile(group: DiffGroupId, newPath: string): ChangedFile {
  const slash = newPath.lastIndexOf("/");
  const rawPatch = "";

  return {
    id: `${group}:${newPath}`,
    group,
    status: "unmerged",
    newPath,
    displayName: slash === -1 ? newPath : newPath.slice(slash + 1),
    displayDirectory: slash === -1 ? "" : newPath.slice(0, slash),
    additions: 0,
    deletions: 0,
    isBinary: false,
    isOversized: false,
    rawPatch,
    patchFingerprint: fingerprintFilePatch(rawPatch, "unmerged", newPath),
    hunks: [],
  };
}

function compareByPath(left: ChangedFile, right: ChangedFile): number {
  return left.newPath < right.newPath
    ? -1
    : left.newPath > right.newPath
      ? 1
      : 0;
}

export async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  map: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.trunc(concurrency)),
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await map(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

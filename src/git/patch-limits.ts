import { fingerprintFilePatch } from "../diff/patch-fingerprint.ts";
import {
  parseUnifiedDiff,
  splitPatchByFile,
} from "../diff/unified-parser.ts";
import type { ChangedFile, DiffGroupId } from "../model/diff.ts";

export const MAX_PATCH_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_PATCH_BYTES = 32 * 1024 * 1024;

export interface PatchLimitOptions {
  maxPatchBytes?: number;
  maxTotalPatchBytes?: number;
}

export interface PatchBudget {
  readonly maxBytes: number;
  consumedBytes: number;
  exhausted: boolean;
}

export function createPatchBudget(
  maxBytes = MAX_TOTAL_PATCH_BYTES,
): PatchBudget {
  return {
    maxBytes: Math.max(0, maxBytes),
    consumedBytes: 0,
    exhausted: false,
  };
}

/** Reserve bytes in source order. Once crossed, the remainder stays omitted. */
export function consumePatchBudget(
  budget: PatchBudget,
  byteLength: number,
): boolean {
  if (budget.exhausted) return false;
  const next = budget.consumedBytes + Math.max(0, byteLength);
  budget.consumedBytes = next;
  if (next <= budget.maxBytes) return true;
  budget.exhausted = true;
  return false;
}

/**
 * Parse only chunks admitted by both limits. Oversized chunks are reduced to
 * header-only placeholders, avoiding allocation of their hunk and line model.
 */
export function applyPatchLimit(
  rawPatch: string,
  group: DiffGroupId,
  budget: PatchBudget,
  maxPatchBytes = MAX_PATCH_BYTES,
): ChangedFile[] {
  const safeFileLimit = Math.max(0, maxPatchBytes);
  const files: ChangedFile[] = [];

  for (const chunk of splitPatchByFile(rawPatch)) {
    const byteLength = Buffer.byteLength(chunk);
    const withinTotalBudget = consumePatchBudget(budget, byteLength);
    if (withinTotalBudget && byteLength <= safeFileLimit) {
      files.push(...parseUnifiedDiff(chunk, { group }));
    } else {
      files.push(oversizedPlaceholder(chunk, group));
    }
  }

  return files;
}

function oversizedPlaceholder(
  rawPatch: string,
  group: DiffGroupId,
): ChangedFile {
  const firstHunk = rawPatch.search(/^@@ /mu);
  const metadata = firstHunk < 0 ? rawPatch : rawPatch.slice(0, firstHunk);
  const parsed = parseUnifiedDiff(metadata, { group })[0];
  if (parsed === undefined) {
    throw new Error("Oversized patch did not contain a file header.");
  }

  return {
    ...parsed,
    additions: 0,
    deletions: 0,
    isOversized: true,
    rawPatch: "",
    patchFingerprint: fingerprintFilePatch("", parsed.status, parsed.newPath),
    hunks: [],
  };
}

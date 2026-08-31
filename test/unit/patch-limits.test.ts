import { describe, expect, it } from "vitest";

import {
  applyPatchLimit,
  createPatchBudget,
} from "../../src/git/patch-limits.ts";
import {
  mapWithConcurrency,
  MAX_UNTRACKED_READ_CONCURRENCY,
} from "../../src/git/workspace-review-reader.ts";

describe("patch limits", () => {
  it("oversized file hunks are not parsed", () => {
    const rawPatch = [
      "diff --git a/large.ts b/large.ts",
      "index 1111111..2222222 100644",
      "--- a/large.ts",
      "+++ b/large.ts",
      "@@ -1,1 +1,1 @@",
      "this malformed hunk line would throw if parsed",
      "",
    ].join("\n");

    const files = applyPatchLimit(
      rawPatch,
      "commit",
      createPatchBudget(),
      100,
    );

    expect(files).toMatchObject([
      { newPath: "large.ts", isOversized: true, hunks: [] },
    ]);
  });

  it("untracked file reads are limited to 8 concurrent operations", async () => {
    let active = 0;
    let maximum = 0;
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = mapWithConcurrency(
      Array.from({ length: 24 }, (_, index) => index),
      MAX_UNTRACKED_READ_CONCURRENCY,
      async (value) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await barrier;
        active -= 1;
        return value;
      },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(maximum).toBe(MAX_UNTRACKED_READ_CONCURRENCY);
    release?.();
    await expect(operation).resolves.toEqual(
      Array.from({ length: 24 }, (_, index) => index),
    );
  });
});

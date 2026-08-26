import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readRangeReview,
} from "../../src/git/range-review-reader.ts";
import type { GitRunner } from "../../src/git/git-client.ts";
import { createTempRepo, type TempRepo } from "../helpers/temp-repo.ts";

describe("range review reader", () => {
  let repo: TempRepo;
  let aOid: string;
  let mainOid: string;
  let featureOid: string;

  beforeEach(async () => {
    repo = await createTempRepo();
    await repo.write("shared.txt", "base\n");
    await repo.git(["add", "shared.txt"]);
    await repo.git(["commit", "-m", "A"]);
    aOid = (await repo.git(["rev-parse", "HEAD"])).trim();

    await repo.git(["checkout", "-b", "feature"]);
    await repo.write("feature.txt", "feature change\n");
    await repo.git(["add", "feature.txt"]);
    await repo.git(["commit", "-m", "C"]);
    featureOid = (await repo.git(["rev-parse", "HEAD"])).trim();

    await repo.git(["checkout", "main"]);
    await repo.write("shared.txt", "main change\n");
    await repo.git(["add", "shared.txt"]);
    await repo.git(["commit", "-m", "B"]);
    mainOid = (await repo.git(["rev-parse", "HEAD"])).trim();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("two-dot range with divergent endpoints shows the net endpoint-to-endpoint diff", async () => {
    const review = await readRangeReview(repo.runner, repo.root, {
      left: "main",
      right: "feature",
      mode: "two-dot",
    });
    const files = review.groups[0]?.files ?? [];

    expect(files.map((file) => file.newPath)).toEqual([
      "feature.txt",
      "shared.txt",
    ]);
    expect(files.find((file) => file.newPath === "feature.txt")).toMatchObject({
      status: "added",
      additions: 1,
      deletions: 0,
    });
    expect(files.find((file) => file.newPath === "shared.txt")).toMatchObject({
      status: "modified",
      additions: 1,
      deletions: 1,
    });
    expect(review.scope).toMatchObject({
      kind: "range",
      leftOid: mainOid,
      rightOid: featureOid,
      effectiveBaseOid: mainOid,
    });
  });

  it("three-dot range whose merge base differs from the left endpoint diffs from the merge base", async () => {
    const review = await readRangeReview(repo.runner, repo.root, {
      left: "main",
      right: "feature",
      mode: "three-dot",
    });

    expect(review.groups[0]?.files.map((file) => file.newPath)).toEqual([
      "feature.txt",
    ]);
    expect(review.scope).toMatchObject({
      kind: "range",
      leftOid: mainOid,
      rightOid: featureOid,
      effectiveBaseOid: aOid,
    });
  });

  it("criss-cross history with multiple best merge bases produces ambiguous-merge-base error", async () => {
    const crissCross = await createTempRepo();

    try {
      await crissCross.write("root.txt", "root\n");
      await crissCross.git(["add", "root.txt"]);
      await crissCross.git(["commit", "-m", "root"]);

      await crissCross.git(["checkout", "-b", "left"]);
      await crissCross.write("left.txt", "left\n");
      await crissCross.git(["add", "left.txt"]);
      await crissCross.git(["commit", "-m", "left base"]);
      const leftBase = (await crissCross.git(["rev-parse", "HEAD"])).trim();

      await crissCross.git(["checkout", "-b", "right", "main"]);
      await crissCross.write("right.txt", "right\n");
      await crissCross.git(["add", "right.txt"]);
      await crissCross.git(["commit", "-m", "right base"]);
      const rightBase = (await crissCross.git(["rev-parse", "HEAD"])).trim();

      await crissCross.git(["checkout", "left"]);
      await crissCross.git(["merge", "--no-ff", rightBase, "-m", "left merge"]);
      await crissCross.git(["checkout", "right"]);
      await crissCross.git(["merge", "--no-ff", leftBase, "-m", "right merge"]);

      await expect(
        readRangeReview(crissCross.runner, crissCross.root, {
          left: "left",
          right: "right",
          mode: "three-dot",
        }),
      ).rejects.toMatchObject({
        code: "ambiguous-merge-base",
        message: expect.stringContaining("Multiple merge bases between"),
      });
    } finally {
      await crissCross.cleanup();
    }
  });

  it("identical endpoints yield an empty review", async () => {
    const review = await readRangeReview(repo.runner, repo.root, {
      left: "main",
      right: "main",
      mode: "two-dot",
    });

    expect(review.groups).toEqual([
      { id: "range", title: "Files changed", files: [] },
    ]);
  });

  it("invalid endpoint throws bad-revision before any diff runs", async () => {
    const run = vi.fn<GitRunner["run"]>(async (args) => {
      if (args[0] === "rev-parse" && args.at(-1) === "valid^{commit}") {
        return { stdout: `${"a".repeat(40)}\n`, stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "unknown revision", code: 1 };
    });

    await expect(
      readRangeReview({ run }, repo.root, {
        left: "valid",
        right: "missing",
        mode: "two-dot",
      }),
    ).rejects.toMatchObject({ code: "bad-revision" });
    expect(run.mock.calls.some(([args]) => args[0] === "diff")).toBe(false);
  });

  it("requestedExpression preserves the user expression", async () => {
    const review = await readRangeReview(repo.runner, repo.root, {
      left: "main",
      right: "feature",
      mode: "three-dot",
    });

    expect(review.scope).toMatchObject({
      requestedExpression: "main...feature",
    });
    expect(review.metadata).toMatchObject({ expression: "main...feature" });
  });

  it("reader leaves repository unchanged", async () => {
    const before = await repo.snapshot();

    await readRangeReview(repo.runner, repo.root, {
      left: "main",
      right: "feature",
      mode: "two-dot",
    });

    expect(await repo.snapshot()).toBe(before);
  });
});

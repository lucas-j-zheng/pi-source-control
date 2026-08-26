import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readCommitReview,
} from "../../src/git/commit-review-reader.ts";
import type { GitRunner } from "../../src/git/git-client.ts";
import { createTempRepo, type TempRepo } from "../helpers/temp-repo.ts";

describe("commit review reader", () => {
  let repo: TempRepo;
  let rootOid: string;

  beforeEach(async () => {
    repo = await createTempRepo();
    await repo.write("base.txt", "base\n");
    await repo.git(["add", "base.txt"]);
    await repo.git(["commit", "-m", "root commit"]);
    rootOid = (await repo.git(["rev-parse", "HEAD"])).trim();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("normal commit against its parent shows only that commit's files", async () => {
    await repo.write("later.txt", "later\n");
    await repo.git(["add", "later.txt"]);
    await repo.git(["commit", "-m", "add later"]);
    const commitOid = (await repo.git(["rev-parse", "HEAD"])).trim();

    const review = await readCommitReview(repo.runner, repo.root, "HEAD");

    expect(review.scope).toEqual({
      kind: "commit",
      requestedRevision: "HEAD",
      commitOid,
      parentOid: rootOid,
      parentIndex: 0,
      parentCount: 1,
    });
    expect(review.groups[0]?.files.map((file) => file.newPath)).toEqual(["later.txt"]);
    expect(review.metadata).toMatchObject({ oid: commitOid, subject: "add later" });
  });

  it("root commit against an empty tree renders as added files", async () => {
    const review = await readCommitReview(repo.runner, repo.root, rootOid);

    expect(review.scope).toMatchObject({
      kind: "commit",
      commitOid: rootOid,
      parentCount: 0,
    });
    expect(review.scope).toHaveProperty("parentIndex", undefined);
    expect(review.groups[0]?.files).not.toHaveLength(0);
    expect(review.groups[0]?.files.every((file) => file.status === "added")).toBe(true);
  });

  it("merge commit is compared against parent 1 with explicit parent metadata", async () => {
    await repo.git(["checkout", "-b", "side"]);
    await repo.write("side.txt", "side\n");
    await repo.git(["add", "side.txt"]);
    await repo.git(["commit", "-m", "side"]);
    const sideOid = (await repo.git(["rev-parse", "HEAD"])).trim();
    await repo.git(["checkout", "main"]);
    await repo.write("main.txt", "main\n");
    await repo.git(["add", "main.txt"]);
    await repo.git(["commit", "-m", "main"]);
    const mainOid = (await repo.git(["rev-parse", "HEAD"])).trim();
    await repo.git(["merge", "--no-ff", "side", "-m", "merge side"]);

    const review = await readCommitReview(repo.runner, repo.root, "HEAD");

    expect(review.scope).toMatchObject({
      parentOid: mainOid,
      parentIndex: 0,
      parentCount: 2,
    });
    expect(review.metadata).toMatchObject({ parentOids: [mainOid, sideOid] });
    expect(review.groups[0]?.files.map((file) => file.newPath)).toEqual(["side.txt"]);
  });

  it("tag and short-hash resolution", async () => {
    await repo.git(["tag", "v1"]);

    const fromTag = await readCommitReview(repo.runner, repo.root, "v1");
    const fromShortHash = await readCommitReview(
      repo.runner,
      repo.root,
      rootOid.slice(0, 7),
    );

    expect(fromTag.scope).toMatchObject({ commitOid: rootOid });
    expect(fromShortHash.scope).toMatchObject({ commitOid: rootOid });
  });

  it("invalid revision throws bad-revision before any diff runs", async () => {
    const run = vi.fn<GitRunner["run"]>(async (args) => {
      if (args[0] === "rev-parse") return { stdout: "", stderr: "bad revision", code: 1 };
      throw new Error(`Unexpected Git command: ${args[0]}`);
    });

    await expect(
      readCommitReview({ run }, repo.root, "missing"),
    ).rejects.toMatchObject({ code: "bad-revision" });
    expect(run.mock.calls.some(([args]) => args[0] === "diff" || args[0] === "diff-tree"))
      .toBe(false);
  });

  it("reader leaves repository unchanged", async () => {
    const before = await repo.snapshot();

    await readCommitReview(repo.runner, repo.root, "HEAD");

    expect(await repo.snapshot()).toBe(before);
  });
});

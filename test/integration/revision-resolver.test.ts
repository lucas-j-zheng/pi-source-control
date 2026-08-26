import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertReadOnly,
  createNodeGitRunner,
  detectRepositoryRoot,
  GitReviewError,
  type GitRunner,
} from "../../src/git/git-client.ts";
import { resolveRevision } from "../../src/git/revision-resolver.ts";
import { createTempRepo, type TempRepo } from "../helpers/temp-repo.ts";

describe("revision resolution", () => {
  let repo: TempRepo;
  let fullOid: string;

  beforeEach(async () => {
    repo = await createTempRepo();
    await repo.write("tracked.txt", "initial\n");
    await repo.git(["add", "tracked.txt"]);
    await repo.git(["commit", "-m", "initial"]);
    await repo.git(["tag", "v1"]);
    fullOid = (await repo.git(["rev-parse", "HEAD"])).trim();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("resolves HEAD, short hash and tag to the same full oid", async () => {
    const shortOid = fullOid.slice(0, 7);

    await expect(resolveRevision(repo.runner, "HEAD")).resolves.toBe(fullOid);
    await expect(resolveRevision(repo.runner, shortOid)).resolves.toBe(fullOid);
    await expect(resolveRevision(repo.runner, "v1")).resolves.toBe(fullOid);
  });

  it("missing revision produces bad-revision error", async () => {
    await expect(resolveRevision(repo.runner, "missing")).rejects.toMatchObject({
      code: "bad-revision",
      message:
        "Could not resolve revision: missing\nUse /diff commit <revision> or /diff range <base>...<head>.",
    });
  });

  it("a revision-like input beginning with - is rejected without running git", async () => {
    const run = vi.fn<GitRunner["run"]>();

    await expect(resolveRevision({ run }, "--help")).rejects.toMatchObject({
      code: "bad-revision",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("detectRepositoryRoot throws not-a-repo outside a repository", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "pi-source-control-outside-"));

    try {
      await expect(
        detectRepositoryRoot(createNodeGitRunner(outside)),
      ).rejects.toMatchObject({
        code: "not-a-repo",
        message:
          "This directory is not inside a Git repository.\nRun Pi from a repository or initialize one with git init.",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("reader leaves repository unchanged", async () => {
    const before = await repo.snapshot();

    expect(await detectRepositoryRoot(repo.runner)).toBe(repo.root);
    await resolveRevision(repo.runner, "HEAD");

    expect(await repo.snapshot()).toBe(before);
  });

  it("assertReadOnly rejects add/commit/reset", () => {
    for (const command of ["add", "commit", "reset"]) {
      expect(() => assertReadOnly([command, "--help"])).toThrowError(GitReviewError);
      try {
        assertReadOnly([command]);
      } catch (error) {
        expect(error).toMatchObject({ code: "git-failed" });
      }
    }
  });
});

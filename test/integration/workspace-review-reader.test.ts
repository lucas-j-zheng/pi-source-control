import { unlink } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DiffGroup, DiffReview } from "../../src/model/diff.ts";
import { readWorkspaceReview } from "../../src/git/workspace-review-reader.ts";
import { WORKING_DIFF_ARGS } from "../../src/git/workspace-review-reader.ts";
import { splitPatchByFile } from "../../src/diff/unified-parser.ts";
import { createTempRepo, type TempRepo } from "../helpers/temp-repo.ts";

describe("workspace review reader", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempRepo();
    await repo.write("a.ts", "export const value = 1;\n");
    await repo.git(["add", "a.ts"]);
    await repo.git(["commit", "-m", "initial"]);
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("clean repository yields two empty groups", async () => {
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(review).toMatchObject({
      repositoryRoot: repo.root,
      scope: { kind: "workspace" },
      groups: [
        { id: "working", title: "Working Tree", files: [] },
        { id: "staged", title: "Staged Changes", files: [] },
      ],
    });
    expect(review.metadata).toBeUndefined();
    expect(review.generatedAt).toEqual(expect.any(Number));
    expect(await repo.snapshot()).toBe(before);
  });

  it("one unstaged modification appears only in working group", async () => {
    await repo.write("a.ts", "export const value = 2;\n");
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "working").files).toMatchObject([
      { id: "working:a.ts", status: "modified", newPath: "a.ts" },
    ]);
    expect(group(review, "staged").files).toEqual([]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("one staged modification appears only in staged group", async () => {
    await repo.write("a.ts", "export const value = 2;\n");
    await repo.git(["add", "a.ts"]);
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "working").files).toEqual([]);
    expect(group(review, "staged").files).toMatchObject([
      { id: "staged:a.ts", status: "modified", newPath: "a.ts" },
    ]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("same file staged and then modified again appears under both sources", async () => {
    await repo.write("a.ts", "export const value = 2;\n");
    await repo.git(["add", "a.ts"]);
    await repo.write("a.ts", "export const value = 3;\n");
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    const staged = group(review, "staged").files[0];
    const working = group(review, "working").files[0];
    expect(staged?.id).toBe("staged:a.ts");
    expect(working?.id).toBe("working:a.ts");
    expect(staged?.patchFingerprint).not.toBe(working?.patchFingerprint);
    expect(await repo.snapshot()).toBe(before);
  });

  it("added tracked file is staged with status added", async () => {
    await repo.write("new.ts", "export const added = true;\n");
    await repo.git(["add", "new.ts"]);
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "staged").files).toMatchObject([
      { id: "staged:new.ts", status: "added", additions: 1 },
    ]);
    expect(group(review, "working").files).toEqual([]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("untracked text file appears as untracked addition without touching the index", async () => {
    await repo.write("notes/new.txt", "first\nsecond\n");
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "working").files).toMatchObject([
      {
        id: "working:notes/new.txt",
        status: "untracked",
        additions: 2,
        deletions: 0,
      },
    ]);
    expect(await repo.git(["status", "--porcelain"])).toContain("?? notes/");
    expect(await repo.git(["diff", "--cached", "--name-only"])).toBe("");
    expect(await repo.snapshot()).toBe(before);
  });

  it("deleted file has status deleted", async () => {
    await unlink(path.join(repo.root, "a.ts"));
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "working").files).toMatchObject([
      { id: "working:a.ts", status: "deleted", deletions: 1 },
    ]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("renamed file has status renamed with oldPath", async () => {
    await repo.git(["mv", "a.ts", "renamed.ts"]);
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "staged").files).toMatchObject([
      {
        id: "staged:renamed.ts",
        status: "renamed",
        oldPath: "a.ts",
        newPath: "renamed.ts",
      },
    ]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("binary file is flagged binary and has no hunks", async () => {
    await repo.write("a.ts", "binary\0content\n");
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "working").files).toMatchObject([
      { id: "working:a.ts", isBinary: true, hunks: [] },
    ]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("large untracked file is flagged oversized", async () => {
    await repo.write("large.txt", "x".repeat(1_048_577));
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "working").files).toMatchObject([
      {
        id: "working:large.txt",
        status: "untracked",
        isOversized: true,
        hunks: [],
      },
    ]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("files are sorted by path", async () => {
    await repo.write("z.ts", "z\n");
    await repo.write("nested/m.ts", "m\n");
    await repo.write("a.ts", "changed\n");
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "working").files.map((file) => file.newPath)).toEqual([
      "a.ts",
      "nested/m.ts",
      "z.ts",
    ]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("oversized patch is flagged", async () => {
    await repo.write("a.ts", "export const value = 200;\n");
    const before = await repo.snapshot();
    const review = await readWorkspaceReview(repo.runner, repo.root, {
      maxPatchBytes: 10,
    });

    expect(group(review, "working").files).toMatchObject([
      { id: "working:a.ts", isOversized: true, hunks: [] },
    ]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("a review whose files exceed the total budget marks the remainder oversized", async () => {
    await repo.write("b.ts", "export const b = 1;\n");
    await repo.git(["add", "b.ts"]);
    await repo.git(["commit", "-m", "add b"]);
    await repo.write("a.ts", "export const value = 200;\n");
    await repo.write("b.ts", "export const b = 200;\n");
    const raw = await repo.runner.run([...WORKING_DIFF_ARGS]);
    const firstChunk = splitPatchByFile(raw.stdout)[0];
    if (firstChunk === undefined) throw new Error("expected a working patch");
    const before = await repo.snapshot();

    const review = await readWorkspaceReview(repo.runner, repo.root, {
      maxTotalPatchBytes: Buffer.byteLength(firstChunk),
    });
    const files = group(review, "working").files;

    expect(files).toMatchObject([
      { newPath: "a.ts", isOversized: false },
      { newPath: "b.ts", isOversized: true, hunks: [] },
    ]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("merge conflict file is reported as unmerged", async () => {
    await repo.git(["checkout", "-b", "side"]);
    await repo.write("a.ts", "export const side = true;\n");
    await repo.git(["add", "a.ts"]);
    await repo.git(["commit", "-m", "side change"]);
    await repo.git(["checkout", "main"]);
    await repo.write("a.ts", "export const main = true;\n");
    await repo.git(["add", "a.ts"]);
    await repo.git(["commit", "-m", "main change"]);
    await expect(repo.git(["merge", "side"])).rejects.toThrow();
    expect(await repo.git(["status", "--porcelain"])).toContain("UU a.ts");
    const before = await repo.snapshot();

    const review = await readWorkspaceReview(repo.runner, repo.root);

    expect(group(review, "working").files).toContainEqual(
      expect.objectContaining({
        id: "working:a.ts",
        status: "unmerged",
        newPath: "a.ts",
      }),
    );
    expect(await repo.snapshot()).toBe(before);
  });
});

function group(review: DiffReview, id: "working" | "staged"): DiffGroup {
  const result = review.groups.find((candidate) => candidate.id === id);
  if (result === undefined) throw new Error(`Missing ${id} group`);
  return result;
}

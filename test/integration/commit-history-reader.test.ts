import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOG_FORMAT,
  parseLogOutput,
  readRecentCommits,
} from "../../src/git/commit-history-reader.ts";
import { createTempRepo, type TempRepo } from "../helpers/temp-repo.ts";

describe("commit history reader", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempRepo();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("empty repository yields no commits", async () => {
    const before = await repo.snapshot();

    await expect(readRecentCommits(repo.runner)).resolves.toEqual([]);
    expect(await repo.snapshot()).toBe(before);
  });

  it("returns commits newest first with full and short oid, subject, author and parents", async () => {
    const oids: string[] = [];
    for (const subject of ["oldest", "middle", "newest"]) {
      await repo.write("history.txt", `${subject}\n`);
      await repo.git(["add", "history.txt"]);
      await repo.git(["commit", "-m", subject]);
      oids.push((await repo.git(["rev-parse", "HEAD"])).trim());
    }
    const before = await repo.snapshot();

    const commits = await readRecentCommits(repo.runner);

    expect(commits.map((commit) => commit.commitOid)).toEqual([...oids].reverse());
    expect(commits).toMatchObject([
      {
        id: `commit:${oids[2]}`,
        shortOid: oids[2]?.slice(0, 7),
        subject: "newest",
        author: "Pi Source Control Tests",
        parentOids: [oids[1]],
      },
      { subject: "middle", parentOids: [oids[0]] },
      { subject: "oldest", parentOids: [] },
    ]);
    expect(commits.every((commit) => commit.authoredAt.length > 0)).toBe(true);
    expect(await repo.snapshot()).toBe(before);
  });

  it("count limits the number of commits", async () => {
    for (const subject of ["one", "two", "three"]) {
      await repo.write("count.txt", `${subject}\n`);
      await repo.git(["add", "count.txt"]);
      await repo.git(["commit", "-m", subject]);
    }

    const commits = await readRecentCommits(repo.runner, 2);

    expect(commits).toHaveLength(2);
    expect(commits.map((commit) => commit.subject)).toEqual(["three", "two"]);
  });

  it("parseLogOutput handles subjects containing spaces and pipes", () => {
    const oid = "a".repeat(40);
    const parent = "b".repeat(40);
    const raw = [
      oid,
      "abcdef0",
      parent,
      "A U Thor",
      "2026-08-25T12:00:00-07:00",
      "subject with spaces | and pipes",
      "\n",
    ].join("\0");

    expect(LOG_FORMAT).toBe("%H%x00%h%x00%P%x00%an%x00%aI%x00%s%x00");
    expect(parseLogOutput(raw)).toEqual([
      {
        kind: "commit",
        id: `commit:${oid}`,
        commitOid: oid,
        shortOid: "abcdef0",
        subject: "subject with spaces | and pipes",
        author: "A U Thor",
        authoredAt: "2026-08-25T12:00:00-07:00",
        parentOids: [parent],
      },
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOG_FORMAT,
  parseLogOutput,
  readRecentCommits,
} from "../../src/git/commit-history-reader.ts";
import { readCommitMetadata } from "../../src/git/commit-review-reader.ts";
import type { DiffReview } from "../../src/model/diff.ts";
import { renderHeader } from "../../src/ui/review-header-renderer.ts";
import { renderSourceList } from "../../src/ui/source-list-renderer.ts";
import { plainStyler } from "../../src/ui/theme.ts";
import { createTempRepo, type TempRepo } from "../helpers/temp-repo.ts";

const ESC = "\u001b";
const BEL = "\u0007";
const REPLACEMENT = "\ufffd";

function logOutput(subject: string, author: string): string {
  return [
    "a".repeat(40),
    "abcdef0",
    "",
    author,
    "2026-08-25T12:00:00-07:00",
    subject,
    "",
  ].join("\0");
}

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

  it("a hostile commit subject cannot reach the source list or the header", async () => {
    const hostile =
      `subject-A${ESC}]52;c;cGF5bG9hZA==${BEL}B${ESC}]0 title${BEL}C${ESC}[31m\rF\u009b31mG-end`;
    const safe = `subject-ABC${REPLACEMENT}F${REPLACEMENT}31mG-end`;
    const raw = logOutput(hostile, "Safe Author");
    const source = parseLogOutput(raw)[0]!;
    const metadata = await readCommitMetadata({
      run: async () => ({ stdout: raw, stderr: "", code: 0 }),
    }, source.commitOid);
    const review: DiffReview = {
      repositoryRoot: "/repo",
      scope: {
        kind: "commit",
        requestedRevision: "HEAD",
        commitOid: source.commitOid,
        parentCount: 0,
      },
      groups: [],
      metadata,
      generatedAt: 0,
    };

    const sourceRows = renderSourceList({
      items: [source],
      counts: {},
      selectedId: source.id,
      focused: true,
      scrollOffset: 0,
      maxRows: 1,
    }, 160, plainStyler).lines.join("\n");
    const header = renderHeader(
      review,
      undefined,
      "unified",
      160,
      plainStyler,
    ).join("\n");

    expect(source.subject).toBe(safe);
    expect(metadata.subject).toBe(safe);
    expect(sourceRows).toContain(safe);
    expect(header).toContain(safe);
    for (const rendered of [sourceRows, header]) {
      expect(rendered).not.toContain(ESC);
      expect(rendered).not.toContain(BEL);
      expect(rendered).not.toContain("\r");
      expect(rendered).not.toContain("\u009b");
    }
  });

  it("a hostile author name is inert in both commit readers", async () => {
    const hostile =
      `author-A${ESC}]52;c;cGF5bG9hZA==${BEL}B${ESC}]0 title${BEL}C${ESC}[31m\rF\u009b31mG-end`;
    const safe = `author-ABC${REPLACEMENT}F${REPLACEMENT}31mG-end`;
    const raw = logOutput("Safe subject", hostile);

    const source = parseLogOutput(raw)[0]!;
    const metadata = await readCommitMetadata({
      run: async () => ({ stdout: raw, stderr: "", code: 0 }),
    }, source.commitOid);

    expect(source.author).toBe(safe);
    expect(metadata.authorName).toBe(safe);
    expect(JSON.stringify([source, metadata])).not.toContain(ESC);
    expect(JSON.stringify([source, metadata])).not.toContain(BEL);
    expect(JSON.stringify([source, metadata])).not.toContain("\r");
    expect(JSON.stringify([source, metadata])).not.toContain("\u009b");
  });
});

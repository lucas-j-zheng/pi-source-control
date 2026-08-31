import { spawn } from "node:child_process";
import { readFile, utimes } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runDiffCommand,
  type DiffCommandDeps,
  type ExecLike,
} from "../../src/command/diff-command.ts";
import { createTempRepo, type TempRepo } from "../helpers/temp-repo.ts";

/**
 * `exec` with the shipped Pi's semantics: `spawn` with `{ cwd, shell: false }`
 * and nothing else. It deliberately ignores `env`, exactly like
 * `pi-coding-agent/dist/core/exec.js`, so this test proves the hardening holds
 * without any environment support at all.
 */
function piLikeExec(calls: string[][]): ExecLike {
  return (cmd, args, opts) =>
    new Promise((resolve) => {
      calls.push([...args]);
      const child = spawn(cmd, args, {
        cwd: opts?.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("close", (code) => {
        resolve({ stdout, stderr, code: code ?? 0, killed: false });
      });
    });
}

function deps(repo: TempRepo, calls: string[][]): DiffCommandDeps {
  const notices: Array<[string, string]> = [];
  return {
    exec: piLikeExec(calls),
    cwd: repo.root,
    mode: "tui",
    notify: (message, level) => {
      notices.push([message, level]);
      if (level === "error") throw new Error(`/diff reported: ${message}`);
    },
    setEditorText: () => undefined,
    // The view itself is out of scope here; every git invocation a `/diff` open
    // makes has already happened by the time the factory would be called.
    openView: async () => undefined,
  };
}

/** Give a file stale stat data: new mtime, byte-identical content. */
async function touchWithoutChanging(
  repo: TempRepo,
  relative: string,
): Promise<void> {
  const target = path.resolve(repo.root, relative);
  const later = new Date(Date.now() + 5_000);
  await utimes(target, later, later);
}

describe("git execution against a real repository", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempRepo();
    await repo.write("tracked.txt", "one\ntwo\nthree\n");
    await repo.write("nested/other.txt", "alpha\n");
    await repo.git(["add", "."]);
    await repo.git(["commit", "-m", "seed"]);
    await repo.write("tracked.txt", "one\ntwo\nthree\nfour\n");
    await repo.git(["add", "tracked.txt"]);
    await repo.write("untracked.txt", "new\n");
    // Refresh the index once so the stat data it holds is current, and only
    // then invalidate it below.
    await repo.git(["status", "--porcelain"]);
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("a /diff open leaves .git/index byte-identical despite stale stat data", async () => {
    // Stale stat data is the trigger: with matching content but a changed
    // mtime, a plain `git status` re-hashes the file and writes the refreshed
    // index back. `--no-optional-locks` is what suppresses that write, and it
    // is an argv flag precisely because the shipped Pi drops `env`, leaving
    // `GIT_OPTIONAL_LOCKS=0` inert.
    await touchWithoutChanging(repo, "nested/other.txt");
    const indexPath = path.join(repo.root, ".git", "index");
    const before = await readFile(indexPath);

    const calls: string[][] = [];
    await runDiffCommand("", deps(repo, calls));

    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      expect(args[0]).toBe("--no-optional-locks");
    }
    expect(calls.some((args) => args[1] === "status")).toBe(true);

    const after = await readFile(indexPath);
    expect(after.equals(before)).toBe(true);
  });

  it("the same open without the flag does rewrite the index", async () => {
    // The control case: it is the flag doing the work above, not the fact that
    // nothing in this repository changed. If a future git stops refreshing here
    // this test is the one that should be revisited first.
    await touchWithoutChanging(repo, "nested/other.txt");
    const indexPath = path.join(repo.root, ".git", "index");
    const before = await readFile(indexPath);

    const calls: string[][] = [];
    const exec = piLikeExec(calls);
    await exec("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: repo.root,
    });

    const after = await readFile(indexPath);
    expect(after.equals(before)).toBe(false);
  });

  it("the real Node runner reads a workspace without touching the index", async () => {
    await touchWithoutChanging(repo, "nested/other.txt");
    const indexPath = path.join(repo.root, ".git", "index");
    const before = await readFile(indexPath);

    const status = await repo.runner.run([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const patch = await repo.runner.run([
      "diff-files",
      "--no-ext-diff",
      "--no-textconv",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--no-color",
      "--unified=3",
      "--",
    ]);

    expect(status.code).toBe(0);
    // The prefixes the parser expects are what git actually emitted, on this
    // git, with no --default-prefix in sight.
    expect(patch.code).toBe(0);
    expect(await readFile(indexPath)).toEqual(before);
  });

  it("--src-prefix/--dst-prefix beat a repository's diff.noprefix", async () => {
    await repo.git(["config", "diff.noprefix", "true"]);
    await repo.git(["config", "diff.mnemonicPrefix", "true"]);

    const patch = await repo.runner.run([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--no-color",
      "--cached",
      "--unified=3",
      "--",
    ]);

    expect(patch.stdout).toContain("diff --git a/tracked.txt b/tracked.txt");
    expect(patch.stdout).toContain("--- a/tracked.txt");
    expect(patch.stdout).toContain("+++ b/tracked.txt");
  });
});

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createNodeGitRunner,
  type GitRunner,
} from "../../src/git/git-client.ts";

export interface TempRepo {
  root: string;
  runner: GitRunner;
  git(args: string[]): Promise<string>;
  write(rel: string, content: string): Promise<void>;
  snapshot(): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createTempRepo(): Promise<TempRepo> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pi-source-control-"));
  const root = await realpath(temporaryRoot);
  const git = (args: string[]): Promise<string> => executeGit(root, args);

  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "Pi Source Control Tests"]);
  await git(["config", "user.email", "pi-source-control@example.test"]);

  return {
    root,
    runner: createNodeGitRunner(root),
    git,
    async write(rel, content) {
      const target = path.resolve(root, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    },
    async snapshot() {
      const status = await git(["status", "--porcelain", "-z"]);
      const head = await git(["rev-parse", "HEAD"]).catch(() => "no-head");
      return `${status}\n${head.trim()}`;
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function executeGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

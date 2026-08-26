import { describe, expect, it, vi } from "vitest";

import {
  createPiGitRunner,
  runDiffCommand,
  type DiffCommandDeps,
  type ExecLike,
} from "../../src/command/diff-command.ts";
import register from "../../src/extension.ts";
import { READ_ONLY_GIT_COMMANDS } from "../../src/git/git-client.ts";
import { SourceControlView } from "../../src/ui/source-control-view.ts";
import { plainStyler } from "../../src/ui/theme.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ROOT = "/repo";
const COMMIT_OID = "a".repeat(40);
const PARENT_OID = "b".repeat(40);
const LEFT_OID = "c".repeat(40);
const RIGHT_OID = "d".repeat(40);

interface ExecCall {
  cmd: string;
  args: string[];
  opts?: { cwd?: string; signal?: AbortSignal; timeout?: number };
}

interface Harness {
  calls: ExecCall[];
  exec: ExecLike;
  notify: DiffCommandDeps["notify"];
  openView: DiffCommandDeps["openView"];
  factory?: Parameters<DiffCommandDeps["openView"]>[0];
  deps(overrides?: Partial<DiffCommandDeps>): DiffCommandDeps;
}

function logRecord(
  oid: string,
  parentOids: string,
  subject = "A commit",
): string {
  return [
    oid,
    oid.slice(0, 7),
    parentOids,
    "Ada",
    "2026-08-25T12:00:00Z",
    subject,
    "",
  ].join("\0");
}

function cannedResult(args: string[]): {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
} {
  const command = args[0];
  if (command === "rev-parse" && args[1] === "--show-toplevel") {
    return { stdout: `${ROOT}\n`, stderr: "", code: 0, killed: false };
  }
  if (command === "rev-parse" && args[1] === "--verify") {
    const revision = args[4]?.replace(/\^\{commit\}$/u, "");
    const oid = revision === "left"
      ? LEFT_OID
      : revision === "right"
        ? RIGHT_OID
        : COMMIT_OID;
    return { stdout: `${oid}\n`, stderr: "", code: 0, killed: false };
  }
  if (command === "show") {
    return {
      stdout: logRecord(COMMIT_OID, PARENT_OID),
      stderr: "",
      code: 0,
      killed: false,
    };
  }
  if (command === "log") {
    return {
      stdout: logRecord(COMMIT_OID, PARENT_OID),
      stderr: "",
      code: 0,
      killed: false,
    };
  }
  if (command === "merge-base") {
    return { stdout: `${LEFT_OID}\n`, stderr: "", code: 0, killed: false };
  }
  return { stdout: "", stderr: "", code: 0, killed: false };
}

function harness(
  responder: (args: string[]) => ReturnType<typeof cannedResult> = cannedResult,
): Harness {
  const calls: ExecCall[] = [];
  const notify = vi.fn<DiffCommandDeps["notify"]>();
  const openView = vi.fn<DiffCommandDeps["openView"]>(async (factory) => {
    subject.factory = factory;
  });
  const subject: Harness = {
    calls,
    exec: async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return responder(args);
    },
    notify,
    openView,
    deps(overrides = {}) {
      return {
        exec: subject.exec,
        cwd: ROOT,
        mode: "tui",
        notify,
        openView: subject.openView,
        ...overrides,
      };
    },
  };
  return subject;
}

function openedView(subject: Harness): SourceControlView {
  if (subject.factory === undefined) throw new Error("view was not opened");
  return subject.factory(
    { requestRender: () => undefined, rows: () => 24 },
    plainStyler,
    () => undefined,
  );
}

describe("diff command", () => {
  it("refuses to run outside tui mode without executing git", async () => {
    const subject = harness();

    await runDiffCommand("", subject.deps({ mode: "json" }));

    expect(subject.calls).toEqual([]);
    expect(subject.openView).not.toHaveBeenCalled();
    expect(subject.notify).toHaveBeenCalledWith(
      "/diff requires interactive TUI mode",
      "error",
    );
  });

  it("usage errors are reported via notify and git is not executed", async () => {
    const subject = harness();

    await runDiffCommand("not-a-mode", subject.deps());

    expect(subject.calls).toEqual([]);
    expect(subject.openView).not.toHaveBeenCalled();
    expect(subject.notify).toHaveBeenCalledWith(
      expect.stringMatching(/^Usage: \/diff/u),
      "error",
    );
  });

  it("workspace request loads status, both patches and recent commits then opens the view", async () => {
    const subject = harness();

    await runDiffCommand("staged", subject.deps());

    const invocations = subject.calls.map((call) => call.args);
    expect(invocations).toContainEqual([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    expect(invocations).toContainEqual([
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-color",
      "--find-renames",
      "--unified=3",
      "--",
    ]);
    expect(invocations).toContainEqual([
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--find-renames",
      "--unified=3",
      "--",
    ]);
    expect(invocations.some((args) => args[0] === "log")).toBe(true);
    expect(subject.openView).toHaveBeenCalledOnce();
    expect(openedView(subject).getState().selectedSourceId).toBe("staged");
  });

  it("commit request preselects the commit source", async () => {
    const subject = harness();

    await runDiffCommand("commit HEAD", subject.deps());

    expect(subject.openView).toHaveBeenCalledOnce();
    expect(openedView(subject).getState().selectedSourceId).toBe(
      `commit:${COMMIT_OID}`,
    );
  });

  it("range request preselects the range source", async () => {
    const subject = harness();

    await runDiffCommand("range left..right", subject.deps());

    expect(subject.openView).toHaveBeenCalledOnce();
    expect(openedView(subject).getState().selectedSourceId).toBe("range");
  });

  it("git errors are surfaced through notify as the user-facing message", async () => {
    const subject = harness((args) =>
      args[0] === "status"
        ? {
            stdout: "",
            stderr: "fatal: could not read the index\nmore detail",
            code: 128,
            killed: false,
          }
        : cannedResult(args)
    );

    await runDiffCommand("", subject.deps());

    expect(subject.openView).not.toHaveBeenCalled();
    expect(subject.notify).toHaveBeenCalledWith(
      "fatal: could not read the index",
      "error",
    );
  });

  it("pi runner refuses mutating git commands", async () => {
    const subject = harness();
    const runner = createPiGitRunner(subject.exec, ROOT);

    await expect(runner.run(["commit", "-m", "nope"])).rejects.toThrow(
      "Refusing to run non-read-only Git command: commit",
    );
    expect(subject.calls).toEqual([]);
  });

  it("all git invocations use argument arrays and read-only subcommands", async () => {
    const subject = harness();

    await runDiffCommand("", subject.deps());
    await runDiffCommand("commit HEAD", subject.deps());
    await runDiffCommand("range left...right", subject.deps());

    expect(subject.calls.length).toBeGreaterThan(0);
    for (const call of subject.calls) {
      expect(call.cmd).toBe("git");
      expect(Array.isArray(call.args)).toBe(true);
      expect(READ_ONLY_GIT_COMMANDS.has(call.args[0] ?? "")).toBe(true);
      expect(call.opts).toMatchObject({ cwd: ROOT, timeout: 10_000 });

      const separator = call.args.indexOf("--end-of-options");
      if (separator >= 0) {
        for (const argument of call.args.slice(separator + 1)) {
          expect(argument.startsWith("-")).toBe(false);
          expect(argument.endsWith("^{commit}")).toBe(true);
        }
      }
    }
  });

  it("register registers a diff command with a description", () => {
    const registerCommand = vi.fn();
    const pi = { registerCommand } as unknown as ExtensionAPI;

    register(pi);

    expect(registerCommand).toHaveBeenCalledWith(
      "diff",
      expect.objectContaining({
        description:
          "Review workspace, commit, or revision-range changes (read-only)",
        handler: expect.any(Function),
      }),
    );
  });
});

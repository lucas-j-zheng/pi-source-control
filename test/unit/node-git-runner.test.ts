import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: childProcess.spawn }));

import { createNodeGitRunner } from "../../src/git/git-client.ts";

describe("Node Git runner", () => {
  it("prepends --no-optional-locks to the argv passed to git", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    childProcess.spawn.mockReturnValue(child);
    const runner = createNodeGitRunner("/repo");

    const result = runner.run(["status", "--short"]);
    child.emit("close", 0);

    await expect(result).resolves.toMatchObject({ code: 0 });
    expect(childProcess.spawn).toHaveBeenCalledOnce();
    expect(childProcess.spawn.mock.calls[0]?.[0]).toBe("git");
    expect(childProcess.spawn.mock.calls[0]?.[1]).toEqual([
      "--no-optional-locks",
      "status",
      "--short",
    ]);
  });
});

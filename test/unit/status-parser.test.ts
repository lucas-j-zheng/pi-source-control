import { describe, expect, it } from "vitest";

import {
  parsePorcelainStatus,
  statusForIndex,
  statusForWorkTree,
} from "../../src/git/status-parser.ts";

describe("porcelain status", () => {
  it("modified only in working tree", () => {
    const [entry] = parsePorcelainStatus(" M a.ts\0");

    expect(entry).toBeDefined();
    expect(statusForIndex(entry!)).toBeUndefined();
    expect(statusForWorkTree(entry!)).toBe("modified");
  });

  it("modified only in index", () => {
    const [entry] = parsePorcelainStatus("M  a.ts\0");

    expect(statusForIndex(entry!)).toBe("modified");
    expect(statusForWorkTree(entry!)).toBeUndefined();
  });

  it("modified in both index and working tree", () => {
    const [entry] = parsePorcelainStatus("MM a.ts\0");

    expect(statusForIndex(entry!)).toBe("modified");
    expect(statusForWorkTree(entry!)).toBe("modified");
  });

  it("added", () => {
    const [entry] = parsePorcelainStatus("A  added.ts\0");

    expect(statusForIndex(entry!)).toBe("added");
    expect(statusForWorkTree(entry!)).toBeUndefined();
  });

  it("deleted", () => {
    const [indexEntry, workTreeEntry] = parsePorcelainStatus(
      "D  index.ts\0 D working.ts\0",
    );

    expect(statusForIndex(indexEntry!)).toBe("deleted");
    expect(statusForWorkTree(workTreeEntry!)).toBe("deleted");
  });

  it("renamed", () => {
    const [entry] = parsePorcelainStatus("R  new.ts\0old.ts\0");

    expect(entry).toMatchObject({ path: "new.ts", origPath: "old.ts" });
    expect(statusForIndex(entry!)).toBe("renamed");
  });

  it("copied", () => {
    const [entry] = parsePorcelainStatus("C  copy.ts\0source.ts\0");

    expect(entry).toMatchObject({ path: "copy.ts", origPath: "source.ts" });
    expect(statusForIndex(entry!)).toBe("copied");
  });

  it("untracked", () => {
    const [entry] = parsePorcelainStatus("?? new.ts\0");

    expect(statusForIndex(entry!)).toBeUndefined();
    expect(statusForWorkTree(entry!)).toBe("untracked");
  });

  it("unmerged", () => {
    const [entry] = parsePorcelainStatus("UU conflict.ts\0");

    expect(statusForIndex(entry!)).toBe("unmerged");
    expect(statusForWorkTree(entry!)).toBe("unmerged");
  });

  it("unmerged", () => {
    const [entry] = parsePorcelainStatus("AA conflict.ts\0");

    expect(statusForIndex(entry!)).toBe("unmerged");
    expect(statusForWorkTree(entry!)).toBe("unmerged");
  });

  it("unmerged", () => {
    const [entry] = parsePorcelainStatus("DD conflict.ts\0");

    expect(statusForIndex(entry!)).toBe("unmerged");
    expect(statusForWorkTree(entry!)).toBe("unmerged");
  });

  it("spaces in filenames", () => {
    const [entry] = parsePorcelainStatus(" M dir/file name.ts\0");

    expect(entry?.path).toBe("dir/file name.ts");
  });

  it("unicode filenames", () => {
    const [entry] = parsePorcelainStatus(" M café-你好.ts\0");

    expect(entry?.path).toBe("café-你好.ts");
  });

  it("NUL-separated records", () => {
    const entries = parsePorcelainStatus(" M one.ts\0A  two.ts\0?? three.ts\0");

    expect(entries.map((entry) => entry.path)).toEqual([
      "one.ts",
      "two.ts",
      "three.ts",
    ]);
  });
});

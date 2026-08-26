import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fingerprintPatch } from "../../src/diff/patch-fingerprint.ts";
import {
  DiffParseError,
  parseUnifiedDiff,
} from "../../src/diff/unified-parser.ts";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture(name: string): string {
  return readFileSync(`${fixtureDirectory}/${name}`, "utf8");
}

describe("parseUnifiedDiff", () => {
  it("one file, one hunk", () => {
    const files = parseUnifiedDiff(fixture("modified.diff"), { group: "working" });

    expect(files).toHaveLength(1);
    expect(files[0]?.status).toBe("modified");
    expect(files[0]?.hunks).toHaveLength(1);
    expect(files[0]?.hunks[0]?.header).toBe(
      "@@ -10,4 +10,5 @@ export function issueSession() {",
    );
    expect(files[0]?.hunks[0]).toMatchObject({ oldStart: 10, newStart: 10 });
  });

  it("line numbers are assigned per unified rules", () => {
    const [hunk] = parseUnifiedDiff(fixture("modified.diff"), {
      group: "working",
    })[0]?.hunks ?? [];

    expect(hunk?.lines).toEqual([
      {
        kind: "context",
        content: "const userId = getUserId();",
        oldLineNumber: 10,
        newLineNumber: 10,
      },
      {
        kind: "deletion",
        content: "const oldToken = issueToken(userId);",
        oldLineNumber: 11,
      },
      {
        kind: "addition",
        content: "const token = issueToken(userId);",
        newLineNumber: 11,
      },
      {
        kind: "context",
        content: "return token;",
        oldLineNumber: 12,
        newLineNumber: 12,
      },
      {
        kind: "addition",
        content: "logSession(token);",
        newLineNumber: 13,
      },
      {
        kind: "context",
        content: "}",
        oldLineNumber: 13,
        newLineNumber: 14,
      },
    ]);
  });

  it("multiple files", () => {
    const files = parseUnifiedDiff(fixture("multi.diff"), { group: "staged" });

    expect(files).toHaveLength(2);
    expect(files.map((file) => file.id)).toEqual([
      "staged:README.md",
      "staged:src/api/session.ts",
    ]);
  });

  it("multiple hunks", () => {
    const files = parseUnifiedDiff(fixture("multi.diff"), { group: "working" });

    expect(files[1]?.hunks.map((hunk) => hunk.index)).toEqual([0, 1]);
  });

  it("added file", () => {
    const [file] = parseUnifiedDiff(fixture("added.diff"), { group: "commit" });

    expect(file?.status).toBe("added");
    expect(file?.oldPath).toBeUndefined();
    expect(file?.hunks[0]?.lines.every((line) => line.kind === "addition")).toBe(true);
    expect(file?.hunks[0]?.lines[0]?.newLineNumber).toBe(1);
  });

  it("deleted file", () => {
    const [file] = parseUnifiedDiff(fixture("deleted.diff"), { group: "commit" });

    expect(file?.status).toBe("deleted");
    expect(file?.hunks[0]?.lines.every((line) => line.kind === "deletion")).toBe(true);
  });

  it("renamed file", () => {
    const [file] = parseUnifiedDiff(fixture("renamed.diff"), { group: "range" });

    expect(file?.status).toBe("renamed");
    expect(file?.oldPath).toBe("docs/old-name.md");
    expect(file?.newPath).toBe("docs/new-name.md");
  });

  it("empty file", () => {
    const patch = [
      "diff --git a/empty.txt b/empty.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/empty.txt",
      "",
    ].join("\n");
    const [file] = parseUnifiedDiff(patch, { group: "working" });

    expect(file).toMatchObject({ status: "added", hunks: [], additions: 0 });
  });

  it("blank lines", () => {
    const patch = [
      "diff --git a/blank.txt b/blank.txt",
      "--- a/blank.txt",
      "+++ b/blank.txt",
      "@@ -1,2 +1,2 @@",
      " first",
      "",
      "",
    ].join("\n");
    const [file] = parseUnifiedDiff(patch, { group: "working" });

    expect(file?.hunks[0]?.lines[1]).toEqual({
      kind: "context",
      content: "",
      oldLineNumber: 2,
      newLineNumber: 2,
    });
  });

  it("no final newline", () => {
    const [file] = parseUnifiedDiff(fixture("no-newline.diff"), { group: "working" });
    const lines = file?.hunks[0]?.lines;

    expect(lines).toHaveLength(2);
    expect(lines?.[0]?.noNewlineAtEnd).toBe(true);
    expect(lines?.[1]?.noNewlineAtEnd).toBe(true);
  });

  it("binary marker", () => {
    const [file] = parseUnifiedDiff(fixture("binary.diff"), { group: "working" });

    expect(file).toMatchObject({ isBinary: true, hunks: [], additions: 0, deletions: 0 });
  });

  it("code lines beginning with +++ or --- inside a hunk", () => {
    const patch = [
      "diff --git a/markers.txt b/markers.txt",
      "--- a/markers.txt",
      "+++ b/markers.txt",
      "@@ -1 +1 @@",
      "---- y",
      "++++ x",
    ].join("\n");
    const [file] = parseUnifiedDiff(patch, { group: "working" });

    expect(file?.hunks[0]?.lines).toEqual([
      { kind: "deletion", content: "--- y", oldLineNumber: 1 },
      { kind: "addition", content: "+++ x", newLineNumber: 1 },
    ]);
  });

  it("quoted/escaped paths", () => {
    const files = parseUnifiedDiff(fixture("unusual-paths.diff"), { group: "working" });

    expect(files.map((file) => file.newPath)).toEqual([
      "dir/with space.txt",
      "café.txt",
    ]);
  });

  it("CRLF patches parse", () => {
    const patch = fixture("modified.diff");
    const lf = parseUnifiedDiff(patch, { group: "working" });
    const crlf = parseUnifiedDiff(patch.replaceAll("\n", "\r\n"), { group: "working" });

    expect(crlf[0]?.hunks).toEqual(lf[0]?.hunks);
  });

  it("malformed hunk line throws DiffParseError with file and nearHunk", () => {
    const header = "@@ -1 +1 @@";
    const patch = [
      "diff --git a/bad.txt b/bad.txt",
      "--- a/bad.txt",
      "+++ b/bad.txt",
      header,
      "not a diff line",
    ].join("\n");

    try {
      parseUnifiedDiff(patch, { group: "working" });
      throw new Error("Expected parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DiffParseError);
      expect(error).toMatchObject({ file: "bad.txt", nearHunk: header });
    }
  });

  it("fingerprint is stable and content-sensitive", () => {
    expect(fingerprintPatch("patch")).toBe(fingerprintPatch("patch"));
    expect(fingerprintPatch("patch")).not.toBe(fingerprintPatch("different patch"));
    expect(fingerprintPatch("patch")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("displayName and displayDirectory", () => {
    const patch = [
      "diff --git a/src/api/session.ts b/src/api/session.ts",
      "diff --git a/README.md b/README.md",
    ].join("\n");
    const files = parseUnifiedDiff(patch, { group: "working" });

    expect(files[0]).toMatchObject({
      displayName: "session.ts",
      displayDirectory: "src/api",
    });
    expect(files[1]).toMatchObject({ displayName: "README.md", displayDirectory: "" });
  });
});

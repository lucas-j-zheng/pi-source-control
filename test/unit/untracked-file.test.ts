import { describe, expect, it } from "vitest";

import { fingerprintPatch } from "../../src/diff/patch-fingerprint.ts";
import {
  isLikelyBinary,
  synthesizeUntrackedFile,
} from "../../src/git/untracked-file.ts";

describe("untracked files", () => {
  it("synthesizes an added file with new line numbers from 1", () => {
    const file = synthesizeUntrackedFile(
      "src/new file.ts",
      "first\nsecond\n",
      "working",
    );

    expect(file).toMatchObject({
      id: "working:src/new file.ts",
      group: "working",
      status: "untracked",
      newPath: "src/new file.ts",
      displayName: "new file.ts",
      displayDirectory: "src",
      additions: 2,
      deletions: 0,
      isBinary: false,
      isOversized: false,
    });
    expect(file.hunks).toEqual([
      {
        index: 0,
        header: "@@ -0,0 +1,2 @@",
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: 2,
        lines: [
          { kind: "addition", content: "first", newLineNumber: 1 },
          { kind: "addition", content: "second", newLineNumber: 2 },
        ],
      },
    ]);
    expect(file.rawPatch).toContain("diff --git a/src/new file.ts b/src/new file.ts");
    expect(file.rawPatch).toContain("new file mode 100644");
    expect(file.patchFingerprint).toBe(fingerprintPatch(file.rawPatch));
  });

  it("marks missing trailing newline", () => {
    const file = synthesizeUntrackedFile("note.txt", "first\nlast", "working");

    expect(file.hunks[0]?.lines[0]?.noNewlineAtEnd).toBeUndefined();
    expect(file.hunks[0]?.lines[1]?.noNewlineAtEnd).toBe(true);
    expect(file.rawPatch).toContain("+last\n\\ No newline at end of file");
  });

  it("empty content yields no hunks", () => {
    const file = synthesizeUntrackedFile("empty.txt", "", "working");

    expect(file).toMatchObject({ hunks: [], additions: 0, deletions: 0 });
    expect(file.rawPatch).not.toContain("@@");
  });

  it("isLikelyBinary detects NUL", () => {
    expect(isLikelyBinary(Uint8Array.from([65, 0, 66]))).toBe(true);
    expect(isLikelyBinary(new TextEncoder().encode("plain text"))).toBe(false);
    const afterSample = new Uint8Array(8_001);
    afterSample.fill(65);
    afterSample[8_000] = 0;
    expect(isLikelyBinary(afterSample)).toBe(false);
  });
});

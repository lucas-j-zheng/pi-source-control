import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { fingerprintPatch } from "../diff/patch-fingerprint.ts";
import { sanitizeContent, sanitizeLabel } from "../diff/sanitize.ts";
import type { ChangedFile, DiffLine } from "../model/diff.ts";

export const MAX_UNTRACKED_BYTES = 1_048_576;

export function isLikelyBinary(sample: Uint8Array): boolean {
  return sample.subarray(0, 8_000).includes(0);
}

export function synthesizeUntrackedFile(
  relPath: string,
  content: string,
  group: "working",
): ChangedFile {
  const rawLines = content === "" ? [] : content.split("\n");
  const hasTrailingNewline = content.endsWith("\n");
  if (hasTrailingNewline) rawLines.pop();

  // A tracked diff never carries the CR of a CRLF line ending, so drop it here
  // too; every other control byte is untrusted repository content and is
  // neutralised at this synthesis boundary, exactly as the parser does.
  const contentLines = rawLines.map((line) =>
    sanitizeContent(line.endsWith("\r") ? line.slice(0, -1) : line)
  );
  const safePath = sanitizeLabel(relPath);

  const lines: DiffLine[] = contentLines.map((line, index) => ({
    kind: "addition",
    content: line,
    newLineNumber: index + 1,
    ...(!hasTrailingNewline && index === contentLines.length - 1
      ? { noNewlineAtEnd: true }
      : {}),
  }));
  const hunkHeader = `@@ -0,0 +1,${lines.length} @@`;
  const patchLines = [
    `diff --git a/${safePath} b/${safePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${safePath}`,
  ];

  if (lines.length > 0) {
    patchLines.push(hunkHeader);
    for (const line of lines) {
      patchLines.push(`+${line.content}`);
      if (line.noNewlineAtEnd) {
        patchLines.push("\\ No newline at end of file");
      }
    }
  }

  const rawPatch = `${patchLines.join("\n")}\n`;
  const slash = safePath.lastIndexOf("/");

  return {
    id: `${group}:${safePath}`,
    group,
    status: "untracked",
    newPath: safePath,
    displayName: slash === -1 ? safePath : safePath.slice(slash + 1),
    displayDirectory: slash === -1 ? "" : safePath.slice(0, slash),
    additions: lines.length,
    deletions: 0,
    isBinary: false,
    isOversized: false,
    rawPatch,
    patchFingerprint: fingerprintPatch(rawPatch),
    hunks:
      lines.length === 0
        ? []
        : [
            {
              index: 0,
              header: hunkHeader,
              oldStart: 0,
              oldCount: 0,
              newStart: 1,
              newCount: lines.length,
              lines,
            },
          ],
  };
}

export async function readUntrackedFile(
  repoRoot: string,
  relPath: string,
): Promise<ChangedFile> {
  const absolutePath = path.resolve(repoRoot, relPath);

  try {
    const [realRepoRoot, realFilePath] = await Promise.all([
      realpath(repoRoot),
      realpath(absolutePath),
    ]);
    if (!isWithin(realRepoRoot, realFilePath)) {
      return placeholder(relPath, { isBinary: true });
    }

    const stats = await lstat(absolutePath);
    if (!stats.isFile()) {
      return placeholder(relPath, { isBinary: true });
    }
    if (stats.size > MAX_UNTRACKED_BYTES) {
      return placeholder(relPath, { isOversized: true });
    }

    const content = await readFile(absolutePath);
    if (isLikelyBinary(content)) {
      return placeholder(relPath, { isBinary: true });
    }

    return synthesizeUntrackedFile(relPath, content.toString("utf8"), "working");
  } catch {
    return placeholder(relPath, { isBinary: true });
  }
}

function isWithin(repoRoot: string, candidate: string): boolean {
  const relative = path.relative(repoRoot, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function placeholder(
  relPath: string,
  flags: { isBinary?: boolean; isOversized?: boolean },
): ChangedFile {
  const safePath = sanitizeLabel(relPath);
  const slash = safePath.lastIndexOf("/");
  const rawPatch = "";

  return {
    id: `working:${safePath}`,
    group: "working",
    status: "untracked",
    newPath: safePath,
    displayName: slash === -1 ? safePath : safePath.slice(slash + 1),
    displayDirectory: slash === -1 ? "" : safePath.slice(0, slash),
    additions: 0,
    deletions: 0,
    isBinary: flags.isBinary ?? false,
    isOversized: flags.isOversized ?? false,
    rawPatch,
    patchFingerprint: fingerprintPatch(rawPatch),
    hunks: [],
  };
}

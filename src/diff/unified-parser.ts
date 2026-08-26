import type {
  ChangedFile,
  DiffGroupId,
  DiffHunk,
  DiffLine,
  FileStatus,
} from "../model/diff.ts";
import { fingerprintPatch } from "./patch-fingerprint.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

export class DiffParseError extends Error {
  constructor(
    message: string,
    public readonly file?: string,
    public readonly nearHunk?: string,
  ) {
    super(message);
    this.name = "DiffParseError";
  }
}

export interface ParseOptions {
  group: DiffGroupId;
}

export function splitPatchByFile(raw: string): string[] {
  const starts = Array.from(raw.matchAll(/^diff --git /gm), (match) => match.index);

  return starts.map((start, index) => raw.slice(start, starts[index + 1]));
}

export function parseUnifiedDiff(raw: string, options: ParseOptions): ChangedFile[] {
  return splitPatchByFile(raw).map((chunk) => parseFileChunk(chunk, options.group));
}

function parseFileChunk(rawPatch: string, group: DiffGroupId): ChangedFile {
  const lines = splitLines(rawPatch);
  const firstLine = lines[0];
  if (firstLine === undefined) {
    throw new DiffParseError("Diff file chunk is empty");
  }

  const headerPaths = parseDiffHeader(firstLine);
  let oldPath = stripSidePrefix(headerPaths.oldPath, "a/");
  let newPath = stripSidePrefix(headerPaths.newPath, "b/");
  let renameFrom: string | undefined;
  let renameTo: string | undefined;
  let copyFrom: string | undefined;
  let copyTo: string | undefined;
  let oldIsNull = false;
  let newIsNull = false;
  let isNewFile = false;
  let isDeletedFile = false;

  const firstHunkIndex = lines.findIndex((line) => HUNK_HEADER.test(line));
  const metadataEnd = firstHunkIndex === -1 ? lines.length : firstHunkIndex;

  for (const line of lines.slice(1, metadataEnd)) {
    if (line.startsWith("--- ")) {
      oldIsNull = parseMetadataPath(line.slice(4)) === "/dev/null";
    } else if (line.startsWith("+++ ")) {
      newIsNull = parseMetadataPath(line.slice(4)) === "/dev/null";
    } else if (line.startsWith("rename from ")) {
      renameFrom = parseMetadataPath(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) {
      renameTo = parseMetadataPath(line.slice("rename to ".length));
    } else if (line.startsWith("copy from ")) {
      copyFrom = parseMetadataPath(line.slice("copy from ".length));
    } else if (line.startsWith("copy to ")) {
      copyTo = parseMetadataPath(line.slice("copy to ".length));
    } else if (line.startsWith("new file mode ")) {
      isNewFile = true;
    } else if (line.startsWith("deleted file mode ")) {
      isDeletedFile = true;
    }
  }

  const status = deriveStatus({
    renameFrom,
    renameTo,
    copyFrom,
    copyTo,
    oldIsNull,
    newIsNull,
    isNewFile,
    isDeletedFile,
  });

  if (status === "renamed") {
    oldPath = renameFrom ?? oldPath;
    newPath = renameTo ?? newPath;
  } else if (status === "copied") {
    oldPath = copyFrom ?? oldPath;
    newPath = copyTo ?? newPath;
  } else if (newPath === "/dev/null") {
    newPath = oldPath;
  }

  const fileForErrors = newPath;
  const isBinary = lines.some(
    (line) => line.startsWith("Binary files ") && line.endsWith(" differ"),
  ) || lines.some((line) => line === "GIT binary patch");
  const hunks = isBinary ? [] : parseHunks(lines, fileForErrors);
  const additions = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "addition").length,
    0,
  );
  const deletions = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "deletion").length,
    0,
  );
  const slash = newPath.lastIndexOf("/");

  return {
    id: `${group}:${newPath}`,
    group,
    status,
    ...(status === "renamed" || status === "copied" ? { oldPath } : {}),
    newPath,
    displayName: slash === -1 ? newPath : newPath.slice(slash + 1),
    displayDirectory: slash === -1 ? "" : newPath.slice(0, slash),
    additions,
    deletions,
    isBinary,
    isOversized: false,
    rawPatch,
    patchFingerprint: fingerprintPatch(rawPatch),
    hunks,
  };
}

interface StatusMetadata {
  renameFrom?: string;
  renameTo?: string;
  copyFrom?: string;
  copyTo?: string;
  oldIsNull: boolean;
  newIsNull: boolean;
  isNewFile: boolean;
  isDeletedFile: boolean;
}

function deriveStatus(metadata: StatusMetadata): FileStatus {
  if (metadata.renameFrom !== undefined || metadata.renameTo !== undefined) {
    return "renamed";
  }
  if (metadata.copyFrom !== undefined || metadata.copyTo !== undefined) {
    return "copied";
  }
  if (metadata.oldIsNull || metadata.isNewFile) {
    return "added";
  }
  if (metadata.newIsNull || metadata.isDeletedFile) {
    return "deleted";
  }
  return "modified";
}

function parseHunks(lines: string[], file: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const headerMatch = HUNK_HEADER.exec(line);
    if (headerMatch !== null) {
      const oldStart = Number(headerMatch[1]);
      const newStart = Number(headerMatch[3]);
      current = {
        index: hunks.length,
        header: line,
        oldStart,
        oldCount: headerMatch[2] === undefined ? 1 : Number(headerMatch[2]),
        newStart,
        newCount: headerMatch[4] === undefined ? 1 : Number(headerMatch[4]),
        lines: [],
      };
      hunks.push(current);
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }

    if (current === undefined) {
      continue;
    }

    if (line === NO_NEWLINE_MARKER) {
      const previous = current.lines.at(-1);
      if (previous !== undefined) {
        previous.noNewlineAtEnd = true;
      }
      continue;
    }

    const parsed = parseHunkLine(line, oldLine, newLine, file, current.header);
    current.lines.push(parsed.line);
    oldLine += parsed.oldIncrement;
    newLine += parsed.newIncrement;
  }

  return hunks;
}

function parseHunkLine(
  source: string,
  oldLine: number,
  newLine: number,
  file: string,
  nearHunk: string,
): { line: DiffLine; oldIncrement: number; newIncrement: number } {
  const marker = source[0];
  const content = source === "" ? "" : source.slice(1);

  if (source === "" || marker === " ") {
    return {
      line: {
        kind: "context",
        content,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      },
      oldIncrement: 1,
      newIncrement: 1,
    };
  }
  if (marker === "-") {
    return {
      line: { kind: "deletion", content, oldLineNumber: oldLine },
      oldIncrement: 1,
      newIncrement: 0,
    };
  }
  if (marker === "+") {
    return {
      line: { kind: "addition", content, newLineNumber: newLine },
      oldIncrement: 0,
      newIncrement: 1,
    };
  }
  if (marker === "\\") {
    return {
      line: { kind: "metadata", content },
      oldIncrement: 0,
      newIncrement: 0,
    };
  }

  throw new DiffParseError(
    `Malformed line in diff for ${file} near ${nearHunk}`,
    file,
    nearHunk,
  );
}

function splitLines(value: string): string[] {
  const lines = value.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function parseDiffHeader(line: string): { oldPath: string; newPath: string } {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) {
    throw new DiffParseError(`Malformed diff header: ${line}`);
  }

  const source = line.slice(prefix.length);
  if (!source.startsWith('"')) {
    const separators = Array.from(source.matchAll(/ b\//g), (match) => match.index);
    const separator = separators.find((index) => {
      const oldPath = source.slice(0, index);
      const newPath = source.slice(index + 1);
      return stripSidePrefix(oldPath, "a/") === stripSidePrefix(newPath, "b/");
    }) ?? separators[0];

    if (separator !== undefined) {
      return {
        oldPath: source.slice(0, separator),
        newPath: source.slice(separator + 1),
      };
    }
  }

  const first = readPathOperand(source, 0);
  const second = readPathOperand(source, first.next);
  if (first.value === undefined || second.value === undefined) {
    throw new DiffParseError(`Malformed diff header: ${line}`);
  }

  return { oldPath: first.value, newPath: second.value };
}

function readPathOperand(
  source: string,
  offset: number,
): { value?: string; next: number } {
  let start = offset;
  while (source[start] === " ") start += 1;
  if (start >= source.length) return { next: start };

  if (source[start] !== '"') {
    const end = source.indexOf(" ", start);
    const next = end === -1 ? source.length : end;
    return { value: source.slice(start, next), next };
  }

  let end = start + 1;
  while (end < source.length) {
    if (source[end] === "\\") {
      end += 2;
      continue;
    }
    if (source[end] === '"') {
      const quoted = source.slice(start, end + 1);
      return { value: decodeQuotedPath(quoted), next: end + 1 };
    }
    end += 1;
  }

  return { next: source.length };
}

function parseMetadataPath(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? decodeQuotedPath(value) : value;
}

function decodeQuotedPath(value: string): string {
  const source = value.slice(1, -1);
  let result = "";
  let octets: number[] = [];

  const flushOctets = (): void => {
    if (octets.length > 0) {
      result += Buffer.from(octets).toString("utf8");
      octets = [];
    }
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== "\\") {
      flushOctets();
      result += char;
      continue;
    }

    const escaped = source[index + 1];
    if (escaped === undefined) {
      flushOctets();
      result += "\\";
      continue;
    }

    if (/[0-7]/.test(escaped)) {
      let digits = escaped;
      while (digits.length < 3 && /[0-7]/.test(source[index + 1 + digits.length] ?? "")) {
        digits += source[index + 1 + digits.length];
      }
      octets.push(Number.parseInt(digits, 8));
      index += digits.length;
      continue;
    }

    flushOctets();
    const escapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      a: "\x07",
      b: "\b",
      t: "\t",
      n: "\n",
      v: "\v",
      f: "\f",
      r: "\r",
    };
    result += escapes[escaped] ?? escaped;
    index += 1;
  }

  flushOctets();
  return result;
}

function stripSidePrefix(path: string, prefix: "a/" | "b/"): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

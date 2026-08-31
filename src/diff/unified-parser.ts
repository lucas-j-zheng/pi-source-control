import type {
  ChangedFile,
  DiffGroupId,
  DiffHunk,
  DiffLine,
  FileStatus,
} from "../model/diff.ts";
import { fingerprintPatch } from "./patch-fingerprint.ts";
import { pathKey, sanitizeContent, sanitizeLabel } from "./sanitize.ts";

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
  // Structural parsing must only inspect inert text. In particular, a bare CR
  // is a JavaScript line terminator, so leaving one in a hunk header makes the
  // header regex miss a real hunk and hides the diff from review. Keep the raw
  // patch separately for its lossless fingerprint, but sanitize every parsed
  // line before any prefix or regex match.
  const lines = splitLines(rawPatch).map(sanitizeContent);
  const firstLine = lines[0];
  if (firstLine === undefined) {
    throw new DiffParseError("Diff file chunk is empty");
  }

  const headerPaths = parseDiffHeader(firstLine);
  let oldPath = stripSidePrefix(headerPaths.oldPath, "a/");
  let newPath = stripSidePrefix(headerPaths.newPath, "b/");
  let renameFrom: RawPath | undefined;
  let renameTo: RawPath | undefined;
  let copyFrom: RawPath | undefined;
  let copyTo: RawPath | undefined;
  let oldIsNull = false;
  let newIsNull = false;
  let isNewFile = false;
  let isDeletedFile = false;

  const firstHunkIndex = lines.findIndex((line) => HUNK_HEADER.test(line));
  const metadataEnd = firstHunkIndex === -1 ? lines.length : firstHunkIndex;

  for (const line of lines.slice(1, metadataEnd)) {
    if (line.startsWith("--- ")) {
      oldIsNull = parseMetadataPath(line.slice(4)).text === "/dev/null";
    } else if (line.startsWith("+++ ")) {
      newIsNull = parseMetadataPath(line.slice(4)).text === "/dev/null";
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
  } else if (newPath.text === "/dev/null") {
    newPath = oldPath;
  }

  // Every path field is a label: it is drawn on one row and is repository-
  // controlled, so it must not carry escapes or line breaks.
  const displayPath = sanitizeLabel(newPath.text);
  const displayOldPath = sanitizeLabel(oldPath.text);
  const fileForErrors = displayPath;
  const isBinary = isBinaryPatch(lines);
  const hunks = isBinary ? [] : parseHunks(lines, fileForErrors);
  const additions = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "addition").length,
    0,
  );
  const deletions = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "deletion").length,
    0,
  );
  const slash = displayPath.lastIndexOf("/");

  return {
    id: `${group}:${pathIdentity(newPath)}`,
    group,
    status,
    ...(status === "renamed" || status === "copied"
      ? { oldPath: displayOldPath }
      : {}),
    newPath: displayPath,
    displayName: slash === -1 ? displayPath : displayPath.slice(slash + 1),
    displayDirectory: slash === -1 ? "" : displayPath.slice(0, slash),
    additions,
    deletions,
    isBinary,
    isOversized: false,
    rawPatch,
    patchFingerprint: fingerprintPatch(rawPatch),
    hunks,
  };
}

/**
 * Detect git's binary summary without depending on its localized sentence.
 *
 * A normal textual patch has `---`/`+++` markers. A binary patch instead has
 * an `index old..new` header followed by either the stable binary-patch marker
 * or one localized summary line. Empty-file and mode-only diffs stop at their
 * structural headers, so requiring payload after `index` avoids classifying
 * those as binary.
 */
function isBinaryPatch(lines: string[]): boolean {
  if (lines.some((line) => line === "GIT binary patch")) return true;
  if (
    lines.some((line) => line.startsWith("--- ")) ||
    lines.some((line) => line.startsWith("+++ ")) ||
    lines.some((line) => HUNK_HEADER.test(line))
  ) {
    return false;
  }

  const index = lines.findIndex((line) =>
    /^index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?$/u.test(line)
  );
  return index >= 0 && lines.slice(index + 1).some((line) => line !== "");
}

interface StatusMetadata {
  renameFrom?: RawPath;
  renameTo?: RawPath;
  copyFrom?: RawPath;
  copyTo?: RawPath;
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
  // `parseFileChunk` sanitized the complete source line before any structural
  // matching, so the content stored in the model is already inert too.
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

/** A path exactly as git named it: the decoded text plus the bytes behind it. */
interface RawPath {
  text: string;
  octets: number[];
}

const OCTAL_DIGIT = /[0-7]/;
const NAMED_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  a: "\u0007",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
};

function rawPathFromText(text: string): RawPath {
  return { text, octets: Array.from(Buffer.from(text, "utf8")) };
}

/**
 * A display path is lossy twice over: invalid UTF-8 collapses to U+FFFD and
 * sanitization drops escape bytes, so two distinct filenames can share one
 * display string. Ids fall back to the raw bytes whenever that happens, which
 * keeps every id unique without churning the readable ids of ordinary paths.
 */
function pathIdentity(path: RawPath): string {
  const safe = sanitizeLabel(path.text);
  const roundTrips = Buffer.from(path.text, "utf8").equals(
    Buffer.from(Uint8Array.from(path.octets)),
  );

  return safe === path.text && roundTrips
    ? safe
    : `${safe}#${pathKey(path.octets)}`;
}

function parseDiffHeader(line: string): { oldPath: RawPath; newPath: RawPath } {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) {
    throw new DiffParseError(`Malformed diff header: ${sanitizeLabel(line)}`);
  }

  const source = line.slice(prefix.length);
  if (!source.startsWith('"')) {
    const separators = Array.from(source.matchAll(/ b\//g), (match) => match.index);
    const separator = separators.find((index) => {
      const oldPath = source.slice(0, index);
      const newPath = source.slice(index + 1);
      return (
        stripSidePrefix(rawPathFromText(oldPath), "a/").text ===
          stripSidePrefix(rawPathFromText(newPath), "b/").text
      );
    }) ?? separators[0];

    if (separator !== undefined) {
      return {
        oldPath: rawPathFromText(source.slice(0, separator)),
        newPath: rawPathFromText(source.slice(separator + 1)),
      };
    }
  }

  const first = readPathOperand(source, 0);
  const second = readPathOperand(source, first.next);
  if (first.value === undefined || second.value === undefined) {
    throw new DiffParseError(`Malformed diff header: ${sanitizeLabel(line)}`);
  }

  return { oldPath: first.value, newPath: second.value };
}

function readPathOperand(
  source: string,
  offset: number,
): { value?: RawPath; next: number } {
  let start = offset;
  while (source[start] === " ") start += 1;
  if (start >= source.length) return { next: start };

  if (source[start] !== '"') {
    const end = source.indexOf(" ", start);
    const next = end === -1 ? source.length : end;
    return { value: rawPathFromText(source.slice(start, next)), next };
  }

  let end = start + 1;
  while (end < source.length) {
    if (source[end] === "\\") {
      end += 2;
      continue;
    }
    if (source[end] === '"') {
      const quoted = source.slice(start, end + 1);
      return { value: decodeQuotedPathBytes(quoted), next: end + 1 };
    }
    end += 1;
  }

  return { next: source.length };
}

function parseMetadataPath(value: string): RawPath {
  return value.startsWith('"') && value.endsWith('"')
    ? decodeQuotedPathBytes(value)
    : rawPathFromText(value);
}

/**
 * git quotes a path precisely because it is not safe to print, so un-escaping
 * one without sanitizing hands the terminal back exactly the control bytes git
 * hid. The decoded text returned here is display-safe; callers that need a
 * lossless identity use {@link decodeQuotedPathBytes} and `pathKey` instead.
 */
export function decodeQuotedPath(value: string): string {
  return sanitizeLabel(decodeQuotedPathBytes(value).text);
}

function decodeQuotedPathBytes(value: string): RawPath {
  const source = value.slice(1, -1);
  const octets: number[] = [];
  const pushText = (text: string): void => {
    for (const byte of Buffer.from(text, "utf8")) octets.push(byte);
  };

  let index = 0;
  while (index < source.length) {
    const backslash = source.indexOf("\\", index);
    if (backslash === -1) {
      pushText(source.slice(index));
      break;
    }
    if (backslash > index) pushText(source.slice(index, backslash));

    const escaped = source[backslash + 1];
    if (escaped === undefined) {
      pushText("\\");
      index = backslash + 1;
      continue;
    }

    if (OCTAL_DIGIT.test(escaped)) {
      let digits = escaped;
      while (
        digits.length < 3 &&
        OCTAL_DIGIT.test(source[backslash + 1 + digits.length] ?? "")
      ) {
        digits += source[backslash + 1 + digits.length];
      }
      octets.push(Number.parseInt(digits, 8) & 0xff);
      index = backslash + 1 + digits.length;
      continue;
    }

    pushText(NAMED_ESCAPES[escaped] ?? escaped);
    index = backslash + 2;
  }

  return {
    text: Buffer.from(Uint8Array.from(octets)).toString("utf8"),
    octets,
  };
}

function stripSidePrefix(path: RawPath, prefix: "a/" | "b/"): RawPath {
  return path.text.startsWith(prefix)
    ? {
      text: path.text.slice(prefix.length),
      octets: path.octets.slice(prefix.length),
    }
    : path;
}

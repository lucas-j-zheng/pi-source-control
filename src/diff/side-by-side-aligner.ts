import type { DiffCell, DiffHunk, DiffLine, SideBySideRow } from "../model/diff.ts";

function cellFor(line: DiffLine): DiffCell {
  const lineNumber =
    line.kind === "addition" ? line.newLineNumber : line.oldLineNumber;

  return {
    kind: line.kind,
    content: line.content,
    ...(lineNumber === undefined ? {} : { lineNumber }),
  };
}

function emptyCell(): DiffCell {
  return { kind: "empty", content: "" };
}

function pairedRows(
  deletions: DiffLine[],
  additions: DiffLine[],
  hunkIndex: number,
): SideBySideRow[] {
  const rowCount = Math.max(deletions.length, additions.length);
  const rows: SideBySideRow[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const deletion = deletions[index];
    const addition = additions[index];

    rows.push({
      left: deletion === undefined ? emptyCell() : cellFor(deletion),
      right: addition === undefined ? emptyCell() : cellFor(addition),
      hunkIndex,
    });
  }

  return rows;
}

export function alignHunk(hunk: DiffHunk): SideBySideRow[] {
  const metadataCell = (): DiffCell => ({
    kind: "metadata",
    content: hunk.header,
  });
  const rows: SideBySideRow[] = [
    {
      left: metadataCell(),
      right: metadataCell(),
      hunkIndex: hunk.index,
    },
  ];

  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index];
    if (line === undefined) break;

    if (line.kind === "context") {
      rows.push({
        left: {
          kind: "context",
          content: line.content,
          ...(line.oldLineNumber === undefined
            ? {}
            : { lineNumber: line.oldLineNumber }),
        },
        right: {
          kind: "context",
          content: line.content,
          ...(line.newLineNumber === undefined
            ? {}
            : { lineNumber: line.newLineNumber }),
        },
        hunkIndex: hunk.index,
      });
      index += 1;
      continue;
    }

    if (line.kind === "metadata") {
      const metadata: DiffCell = {
        kind: "metadata",
        content: line.content,
      };
      rows.push({
        left: { ...metadata },
        right: { ...metadata },
        hunkIndex: hunk.index,
      });
      index += 1;
      continue;
    }

    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];

    if (line.kind === "deletion") {
      while (hunk.lines[index]?.kind === "deletion") {
        deletions.push(hunk.lines[index] as DiffLine);
        index += 1;
      }
      while (hunk.lines[index]?.kind === "addition") {
        additions.push(hunk.lines[index] as DiffLine);
        index += 1;
      }
    } else {
      while (hunk.lines[index]?.kind === "addition") {
        additions.push(hunk.lines[index] as DiffLine);
        index += 1;
      }
    }

    rows.push(...pairedRows(deletions, additions, hunk.index));
  }

  return rows;
}

export function alignFile(hunks: DiffHunk[]): SideBySideRow[] {
  return hunks.flatMap(alignHunk);
}

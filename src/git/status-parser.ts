import type { FileStatus, StatusEntry } from "../model/diff.ts";

export function parsePorcelainStatus(raw: string): StatusEntry[] {
  const records = raw.split("\0");
  const entries: StatusEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record === "") continue;

    const entry: StatusEntry = {
      index: record[0] ?? " ",
      workTree: record[1] ?? " ",
      path: record.slice(3),
    };

    if (entry.index === "R" || entry.index === "C") {
      const origPath = records[index + 1];
      if (origPath !== undefined && origPath !== "") {
        entry.origPath = origPath;
        index += 1;
      }
    }

    entries.push(entry);
  }

  return entries;
}

export function statusForIndex(entry: StatusEntry): FileStatus | undefined {
  if (isUnmerged(entry)) return "unmerged";

  return statusForColumn(entry.index, {
    M: "modified",
    A: "added",
    D: "deleted",
    R: "renamed",
    C: "copied",
    T: "type-changed",
  });
}

export function statusForWorkTree(entry: StatusEntry): FileStatus | undefined {
  if (isUnmerged(entry)) return "unmerged";
  if (entry.index === "?" && entry.workTree === "?") return "untracked";

  return statusForColumn(entry.workTree, {
    M: "modified",
    D: "deleted",
    T: "type-changed",
  });
}

function isUnmerged(entry: StatusEntry): boolean {
  return (
    entry.index === "U" ||
    entry.workTree === "U" ||
    (entry.index === "A" && entry.workTree === "A") ||
    (entry.index === "D" && entry.workTree === "D")
  );
}

function statusForColumn(
  column: string,
  statuses: Readonly<Record<string, FileStatus>>,
): FileStatus | undefined {
  return statuses[column];
}

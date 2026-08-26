// Core data model. Source of truth: docs/plan.md §8–9. Do not redeclare elsewhere.

export type SourceListItem =
  | { kind: "working"; id: "working"; label: "Working Tree" }
  | { kind: "staged"; id: "staged"; label: "Staged Changes" }
  | { kind: "range"; id: "range"; label: string }
  | {
      kind: "commit";
      id: string; // `commit:${commitOid}`
      commitOid: string;
      shortOid: string;
      subject: string;
      author: string;
      authoredAt: string;
      parentOids: string[];
    };

export type DiffGroupId = "staged" | "working" | "commit" | "range";

export type ReviewScope =
  | { kind: "workspace" }
  | {
      kind: "commit";
      requestedRevision: string;
      commitOid: string;
      parentOid?: string;
      parentIndex?: number;
      parentCount: number;
    }
  | {
      kind: "range";
      requestedExpression: string;
      mode: "two-dot" | "three-dot";
      leftOid: string;
      rightOid: string;
      effectiveBaseOid: string;
    };

export type FileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unmerged"
  | "type-changed";

export interface DiffReview {
  repositoryRoot: string;
  scope: ReviewScope;
  groups: DiffGroup[];
  metadata?: CommitMetadata | RangeMetadata;
  generatedAt: number;
}

export interface DiffGroup {
  id: DiffGroupId;
  title: string;
  files: ChangedFile[];
}

export interface CommitMetadata {
  oid: string;
  shortOid: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  parentOids: string[];
}

export interface RangeMetadata {
  expression: string;
  mode: "two-dot" | "three-dot";
  leftOid: string;
  rightOid: string;
  effectiveBaseOid: string;
}

export interface ChangedFile {
  id: string; // `${group}:${newPath}`
  group: DiffGroupId;
  status: FileStatus;
  oldPath?: string;
  newPath: string;
  displayName: string;
  displayDirectory: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isOversized: boolean;
  rawPatch: string;
  patchFingerprint: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  index: number;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export type DiffLineKind = "context" | "addition" | "deletion" | "metadata";

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  noNewlineAtEnd?: boolean;
}

export interface SideBySideRow {
  left?: DiffCell;
  right?: DiffCell;
  hunkIndex: number;
}

export interface DiffCell {
  kind: "context" | "addition" | "deletion" | "empty" | "metadata";
  lineNumber?: number;
  content: string;
}

export interface HitTarget {
  row: number;
  columnStart: number;
  columnEnd: number;
  action:
    | { type: "select-source"; sourceId: string }
    | { type: "select-file"; fileId: string }
    | { type: "focus-diff" };
}

export type ReviewRequest =
  | { kind: "workspace"; initialSource: "working" | "staged" }
  | { kind: "commit"; revision: string }
  | { kind: "range"; left: string; right: string; mode: "two-dot" | "three-dot" };

/** One record from `git status --porcelain=v1 -z --untracked-files=all`. */
export interface StatusEntry {
  index: string; // X column, e.g. "M", "A", " ", "?"
  workTree: string; // Y column
  path: string; // new/current path
  origPath?: string; // for renames/copies
}

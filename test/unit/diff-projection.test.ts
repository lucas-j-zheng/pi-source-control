import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../../src/diff/unified-parser.ts";
import type {
  ChangedFile,
  DiffLine,
  SourceListItem,
} from "../../src/model/diff.ts";
import type { ReviewComment } from "../../src/model/review-comment.ts";
import {
  createInitialState,
  fileKey,
  reduce,
  type LineAnchor,
  type ReviewEnv,
} from "../../src/model/review-state.ts";
import {
  buildDiffProjection,
  createProjectionCache,
  type ProjectionKey,
} from "../../src/ui/diff-projection.ts";
import { computeLayout } from "../../src/ui/layout.ts";
import {
  buildSideBySideRows,
  renderSideBySide,
} from "../../src/ui/side-by-side-renderer.ts";
import { plainStyler, type Styler } from "../../src/ui/theme.ts";
import {
  buildUnifiedRows,
  renderUnifiedDiff,
} from "../../src/ui/unified-renderer.ts";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/", import.meta.url));

describe("diff projection", () => {
  it("a projection is built once per key and reused", () => {
    const file = generatedFile(1, 8);
    let builds = 0;
    const cache = createProjectionCache((_key, candidate) => {
      builds += 1;
      return buildDiffProjection({
        file: candidate,
        mode: "unified",
        width: 60,
        horizontalOffset: 0,
      });
    });
    const key = projectionKey(file);

    const first = cache.get(key, file);
    const second = cache.get({ ...key }, file);

    expect(second).toBe(first);
    expect(builds).toBe(1);
  });

  it("a changed fingerprint, width, mode or comment version rebuilds it", () => {
    const file = generatedFile(2, 8);
    let builds = 0;
    const cache = createProjectionCache((key, candidate) => {
      builds += 1;
      return buildDiffProjection({
        file: candidate,
        mode: key.mode,
        width: key.width,
        horizontalOffset: key.horizontalOffset,
      });
    });
    const key = projectionKey(file);

    cache.get(key, file);
    cache.get({ ...key, fingerprint: "changed" }, file);
    cache.get({ ...key, width: key.width + 1 }, file);
    cache.get({ ...key, mode: "side-by-side" }, file);
    cache.get({ ...key, commentsVersion: 1 }, file);

    expect(builds).toBe(5);
  });

  it("rowForAnchor matches the renderer's row for every anchor", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const file = generatedFile(seed, 10 + seed);
      const comments = generatedComments(file);
      const composing = {
        anchor: sourceAnchors(file)[Math.floor(sourceAnchors(file).length / 2)]!,
        buffer: { text: "draft text that wraps", caret: 8 },
      };

      for (const mode of ["unified", "side-by-side"] as const) {
        const width = mode === "unified" ? 47 + seed : 100 + seed;
        const projection = buildDiffProjection({
          file,
          mode,
          width,
          horizontalOffset: seed % 7,
          comments,
          composing,
        });
        const rows = mode === "unified"
          ? buildUnifiedRows(
              file,
              plainStyler,
              width,
              seed % 7,
              undefined,
              true,
              comments,
              composing,
            )
          : buildSideBySideRows(
              file,
              plainStyler,
              width,
              seed % 7,
              undefined,
              true,
              comments,
              composing,
            );

        for (const anchor of projection.anchors) {
          const renderedRow = rows.findIndex((row) => {
            const rowAnchors = (row as { anchors?: LineAnchor[] }).anchors;
            return rowAnchors?.some((candidate) =>
              sameAnchor(candidate, anchor)
            ) ?? sameAnchor(row.anchor, anchor);
          });
          expect(projection.rowForAnchor(anchor)).toBe(renderedRow);
        }
      }
    }
  });

  it("scrolling a 2,000-line file builds the row model a bounded number of times", () => {
    const file = generatedFile(29, 2_000);
    const source: SourceListItem = {
      kind: "working",
      id: "working",
      label: "Working Tree",
    };
    let builds = 0;
    const cache = createProjectionCache((key, candidate) => {
      builds += 1;
      return buildDiffProjection({
        file: candidate,
        mode: key.mode,
        width: key.width,
        horizontalOffset: key.horizontalOffset,
      });
    });
    const projection = (candidate: ChangedFile) =>
      cache.get(projectionKey(candidate), candidate);
    const env: ReviewEnv = {
      layout: computeLayout(160, 24),
      sources: [source],
      filesForSource: () => [file],
      fileById: (fileId) => fileId === file.id ? file : undefined,
      diffRowCount: (candidate) => projection(candidate).rowCount,
      hunkRows: () => [1],
      lineAnchors: (candidate) => [...projection(candidate).anchors],
      anchorsInRowRange: (candidate, _mode, startRow, endRow) => {
        const current = projection(candidate);
        return current.anchors.filter((anchor) => {
          const row = current.rowForAnchor(anchor);
          return row >= startRow && row < endRow;
        });
      },
      rowForAnchor: (candidate, anchor) =>
        projection(candidate).rowForAnchor(anchor),
    };
    let state = createInitialState("working", env);
    state = reduce(state, { type: "focus-diff" }, env).state;
    cache.clear();
    builds = 0;

    const started = performance.now();
    state = reduce(state, { type: "scroll-view", delta: 30 }, env).state;
    const elapsed = performance.now() - started;

    expect(state.verticalOffsetByFile.get(fileKey("", file.id))).toBe(30);
    expect(builds).toBeLessThan(5);
    expect(elapsed).toBeLessThan(250);
  });

  it("projection measurement leaves rendered bytes identical at several widths in both modes", () => {
    const patch = readFileSync(`${fixtureDirectory}/modified.diff`, "utf8");
    const file = parseUnifiedDiff(patch, { group: "working" })[0]!;
    const styler: Styler = {
      fg: (role, text) => `\u001b[3${role.length % 8}m${text}\u001b[0m`,
      bg: (_role, text) => `\u001b[47m${text}\u001b[0m`,
      bold: (text) => `\u001b[1m${text}\u001b[0m`,
    };

    for (const mode of ["unified", "side-by-side"] as const) {
      for (const width of [90, 130, 180]) {
        const render = () => mode === "unified"
          ? renderUnifiedDiff(
              {
                file,
                verticalOffset: 0,
                horizontalOffset: 3,
                height: 12,
                cursor: { hunkIndex: 0, lineIndex: 1 },
                focused: true,
              },
              width,
              styler,
            )
          : renderSideBySide(
              {
                file,
                verticalOffset: 0,
                horizontalOffset: 3,
                height: 12,
                cursor: { hunkIndex: 0, lineIndex: 1 },
                focused: true,
              },
              width,
              styler,
            );
        const before = render().join("\n");

        buildDiffProjection({
          file,
          mode,
          width: mode === "unified" ? width - 9 : width,
          horizontalOffset: 3,
        });

        expect(render().join("\n")).toBe(before);
      }
    }
  });
});

function projectionKey(file: ChangedFile): ProjectionKey {
  return {
    fileId: file.id,
    fingerprint: file.patchFingerprint,
    mode: "unified",
    width: 60,
    horizontalOffset: 0,
    commentsVersion: 0,
    composerVersion: 0,
  };
}

function generatedFile(seed: number, lineCount: number): ChangedFile {
  const lines: DiffLine[] = Array.from({ length: lineCount }, (_, index) => {
    const value = (index + seed) % 11;
    const kind = value === 0
      ? "metadata"
      : value < 3
        ? "deletion"
        : value < 5
          ? "addition"
          : "context";
    return {
      kind,
      content: `seed ${seed} line ${index} ${"x".repeat((seed + index) % 19)}`,
      ...(kind === "addition" || kind === "context"
        ? { newLineNumber: index + 1 }
        : {}),
      ...(kind === "deletion" || kind === "context"
        ? { oldLineNumber: index + 1 }
        : {}),
      ...(index % 37 === 0 ? { noNewlineAtEnd: true } : {}),
    };
  });
  return {
    id: `working:generated-${seed}.ts`,
    group: "working",
    status: "modified",
    newPath: `generated-${seed}.ts`,
    displayName: `generated-${seed}.ts`,
    displayDirectory: "",
    additions: lines.filter((line) => line.kind === "addition").length,
    deletions: lines.filter((line) => line.kind === "deletion").length,
    isBinary: false,
    isOversized: false,
    rawPatch: `generated-${seed}`,
    patchFingerprint: `fingerprint-${seed}`,
    hunks: [{
      index: 0,
      header: `@@ -1,${lineCount} +1,${lineCount} @@`,
      oldStart: 1,
      oldCount: lineCount,
      newStart: 1,
      newCount: lineCount,
      lines,
    }],
  };
}

function sourceAnchors(file: ChangedFile): LineAnchor[] {
  return file.hunks.flatMap((hunk) =>
    hunk.lines.flatMap((line, lineIndex) =>
      line.kind === "metadata" ? [] : [{ hunkIndex: hunk.index, lineIndex }]
    )
  );
}

function generatedComments(file: ChangedFile): ReviewComment[] {
  return sourceAnchors(file).filter((_anchor, index) => index % 7 === 0).map(
    (anchor, index) => ({
      id: `${file.id}:${index}`,
      fileId: file.id,
      filePath: file.newPath,
      anchor,
      lineKind: "context",
      lineText: "line",
      contextText: " line",
      scopeLabel: "working tree",
      body: `comment ${index} ${"wrap ".repeat(index % 4)}`,
      createdAt: index,
    }),
  );
}

function sameAnchor(
  left: LineAnchor | undefined,
  right: LineAnchor | undefined,
): boolean {
  return left !== undefined && right !== undefined &&
    left.hunkIndex === right.hunkIndex && left.lineIndex === right.lineIndex;
}

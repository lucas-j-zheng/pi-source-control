import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../../src/diff/unified-parser.ts";
import type { DiffReview } from "../../src/model/diff.ts";
import type { ReviewComment } from "../../src/model/review-comment.ts";
import { SourceControlView } from "../../src/ui/source-control-view.ts";
import { plainStyler } from "../../src/ui/theme.ts";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/", import.meta.url));
const files = parseUnifiedDiff(
  readFileSync(`${fixtureDirectory}/multi.diff`, "utf8"),
  { group: "working" },
);
const review: DiffReview = {
  repositoryRoot: "/repo",
  scope: { kind: "workspace" },
  groups: [
    { id: "working", title: "Working Tree", files },
    { id: "staged", title: "Staged Changes", files: [] },
  ],
  generatedAt: 0,
};

class Host {
  constructor(public rowCount: number) {}
  requestRender(): void {}
  rows(): number {
    return this.rowCount;
  }
}

function makeView(height: number, withComments = false): SourceControlView {
  const subject = new SourceControlView({
    data: {
      initialReview: review,
      recentCommits: [],
      async loadCommit() {
        return review;
      },
      async refresh() {
        return { review, recentCommits: [] };
      },
    },
    host: new Host(height),
    styler: plainStyler,
    initialSourceId: "working",
    composeComment: async () => undefined,
    submitReview: () => undefined,
    onClose() {},
  });
  const file = files[0];
  if (withComments && file !== undefined) {
    const comment: ReviewComment = {
      id: `${file.id}:0:0`,
      fileId: file.id,
      filePath: file.newPath,
      anchor: { hunkIndex: 0, lineIndex: 0 },
      oldLineNumber: 1,
      newLineNumber: 1,
      lineKind: "context",
      lineText: "# Project",
      contextText: " # Project",
      scopeLabel: "working tree",
      body: "A long inline review comment that wraps safely at every terminal width. ".repeat(4),
      createdAt: 1,
    };
    subject.dispatch({ type: "add-comment", comment });
  }
  return subject;
}

function expectFits(lines: string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
}

describe("source control render width", () => {
  it("every rendered line fits at all widths and heights", () => {
    for (const width of [50, 60, 89, 90, 110, 129, 130, 160, 220]) {
      for (const height of [8, 10, 16, 24, 40, 60]) {
        const subject = makeView(height, true);
        expectFits(subject.render(width), width);
        subject.dispatch({ type: "focus-diff" });
        subject.dispatch({ type: "end" });
        expectFits(subject.render(width), width);

        subject.dispatch({ type: "toggle-view" });
        expectFits(subject.render(width), width);
        subject.dispatch({ type: "toggle-help" });
        expectFits(subject.render(width), width);
      }
    }
  });

  it("initial view mode is unified at wide, medium and narrow widths", () => {
    for (const width of [60, 110, 220]) {
      const subject = makeView(24);
      subject.render(width);
      expect(subject.getState().viewMode).toBe("unified");
    }
  });

  it("reopening a view resets an earlier side-by-side selection to unified", () => {
    const first = makeView(24);
    first.render(220);
    first.dispatch({ type: "toggle-view" });
    expect(first.getState().viewMode).toBe("side-by-side");
    first.dispose();

    const reopened = makeView(24);
    reopened.render(220);
    expect(reopened.getState().viewMode).toBe("unified");
  });
});

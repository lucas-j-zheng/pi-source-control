import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HStack, VStack } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { parseUnifiedDiff } from "../../src/diff/unified-parser.ts";
import type { ChangedFile, DiffReview } from "../../src/model/diff.ts";
import { fileKey } from "../../src/model/review-state.ts";
import { buildUnifiedRows } from "../../src/ui/unified-renderer.ts";
import { computeLayout } from "../../src/ui/layout.ts";
import { SourceControlView } from "../../src/ui/source-control-view.ts";
import { plainStyler, type Styler } from "../../src/ui/theme.ts";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/", import.meta.url));
const layoutNodeSymbol = Symbol.for("@earendil-works/pi-tui/layout-node");

interface LayoutEntry {
  component: unknown;
  basis?: number | "auto";
  grow?: number;
  shrink?: number;
  minSize?: number;
}

interface LayoutNode {
  type: "vstack" | "hstack" | "scroll";
  entries?: LayoutEntry[];
}

function layoutNode(component: unknown): LayoutNode {
  const withNode = component as Partial<Record<symbol, () => LayoutNode>>;
  const getNode = withNode[layoutNodeSymbol];
  if (getNode === undefined) throw new Error("component has no layout node");
  return getNode.call(component);
}

function longFiles(): ChangedFile[] {
  const parsed = parseUnifiedDiff(
    readFileSync(`${fixtureDirectory}/multi.diff`, "utf8"),
    { group: "working" },
  );
  const first = parsed[0];
  if (first === undefined || first.hunks[0] === undefined) {
    throw new Error("multi.diff needs a file with a hunk");
  }
  const longFile: ChangedFile = {
    ...first,
    hunks: [
      {
        ...first.hunks[0],
        lines: Array.from({ length: 120 }, (_, index) => ({
          ...first.hunks[0]!.lines[index % first.hunks[0]!.lines.length]!,
        })),
      },
    ],
  };
  return [
    longFile,
    ...Array.from({ length: 12 }, (_, index) => ({
      ...first,
      id: `working:extra-${index}`,
      newPath: `src/extra-${index}.ts`,
      displayName: `extra-${index}.ts`,
      patchFingerprint: `extra-${index}`,
    })),
  ];
}

class Host {
  rowCount = 24;
  requestRender = vi.fn();

  rows(): number {
    return this.rowCount;
  }
}

function makeView(options: { host?: Host; styler?: Styler } = {}): {
  view: SourceControlView;
  host: Host;
  files: ChangedFile[];
} {
  const host = options.host ?? new Host();
  const files = longFiles();
  const review: DiffReview = {
    repositoryRoot: "/repo",
    scope: { kind: "workspace" },
    groups: [
      { id: "working", title: "Working Tree", files },
      { id: "staged", title: "Staged Changes", files: [] },
    ],
    generatedAt: 0,
  };
  const view = new SourceControlView({
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
    host,
    styler: options.styler ?? plainStyler,
    initialSourceId: "working",
    submitReview: () => undefined,
    onClose() {},
  });
  return { view, host, files };
}

describe("fullscreen layout", () => {
  it("view is a VStack with a layout node", () => {
    const { view } = makeView();

    expect(view).toBeInstanceOf(VStack);
    expect(layoutNode(view).type).toBe("vstack");
  });

  it("fullscreen entries in wide mode are header, border, body, border, footer with body basis equal to bodyHeight", () => {
    const { view } = makeView();
    view.rebuildFullscreenTree(160);
    const entries = layoutNode(view).entries!;

    expect(entries).toHaveLength(5);
    expect(entries[2]).toMatchObject({
      basis: computeLayout(160, 23).bodyHeight,
      grow: 0,
      shrink: 1,
      minSize: 6,
    });
  });

  it("wide body is an HStack of left column, divider and diff scroll view", () => {
    const { view } = makeView();
    view.rebuildFullscreenTree(160);
    const body = layoutNode(view).entries![2]!.component;
    const bodyNode = layoutNode(body);

    expect(body).toBeInstanceOf(HStack);
    expect(bodyNode.entries).toHaveLength(3);
    expect(bodyNode.entries![0]!.component).toBeInstanceOf(VStack);
    expect(bodyNode.entries![2]!.component).toBe(view.getPanes().diff);
  });

  it("narrow body contains only the focused pane", () => {
    const { view } = makeView();
    view.dispatch({ type: "focus-diff" });
    view.rebuildFullscreenTree(60);

    expect(layoutNode(view).entries![2]!.component).toBe(view.getPanes().diff);
  });

  it("pane contents render full unwindowed content", () => {
    const { view, files } = makeView();
    view.rebuildFullscreenTree(160);
    const layout = computeLayout(160, 23);
    const panes = view.getPanes();
    const diffLines = panes.diff.render(layout.rightWidth);
    const fileLines = panes.files.render(layout.leftWidth).join("\n");

    expect(diffLines).toHaveLength(
      buildUnifiedRows(
        files[0]!,
        plainStyler,
        layout.rightWidth - 11,
        0,
      ).length,
    );
    for (const file of files) expect(fileLines).toContain(file.displayName);
  });

  it("wheel scrollBy on the diff pane dispatches set-scroll and updates the selected file's vertical offset", () => {
    const { view, files } = makeView();
    const diff = view.getPanes().diff;
    diff.updateLayout(200, 20, () => undefined);

    diff.scrollBy(7);

    expect(
      view.getState().verticalOffsetByFile.get(
        fileKey("working tree", files[0]!.id),
      ),
    ).toBe(7);
  });

  it("keyboard scroll sets the desired scroll top which updateLayout applies", () => {
    const { view } = makeView();
    const diff = view.getPanes().diff;
    view.rebuildFullscreenTree(160);
    diff.render(computeLayout(160, 23).rightWidth);
    view.dispatch({ type: "focus-diff" });
    view.dispatch({ type: "page", delta: 1 });
    const offset = view.getState().verticalOffsetByFile.get(
      fileKey("working tree", view.getState().selectedFileId!),
    );

    diff.updateLayout(200, 20, () => undefined);

    expect(diff.scrollTop).toBe(offset);
  });

  it("set-scroll does not trigger requestRender", () => {
    const { view, host } = makeView();
    const diff = view.getPanes().diff;
    diff.updateLayout(200, 20, () => undefined);
    host.requestRender.mockClear();

    diff.scrollBy(4);

    expect(host.requestRender).not.toHaveBeenCalled();
  });

  it("no feedback loop between wheel and reducer", () => {
    const { view } = makeView();
    const diff = view.getPanes().diff;
    diff.updateLayout(200, 20, () => undefined);
    diff.scrollBy(6);
    const version = view.getState().version;

    diff.updateLayout(200, 20, () => undefined);

    expect(diff.scrollTop).toBe(6);
    expect(view.getState().version).toBe(version);
  });

  it("divider styling follows focus", () => {
    const fg = vi.fn((_role, text: string) => text);
    const styler: Styler = {
      fg,
      bg: (_role, text) => text,
      bold: (text) => text,
    };
    const { view } = makeView({ styler });
    view.dispatch({ type: "focus-diff" });
    view.rebuildFullscreenTree(160);
    const body = layoutNode(view).entries![2]!.component;
    const divider = layoutNode(body).entries![1]!.component as {
      render(width: number): string[];
    };
    fg.mockClear();

    divider.render(1);

    expect(fg).toHaveBeenCalledWith("borderAccent", "│");
  });

  it("rebuilding the tree keeps scroll view instances and scrollTop", () => {
    const { view } = makeView();
    const panes = view.getPanes();
    panes.diff.updateLayout(200, 20, () => undefined);
    panes.diff.scrollBy(9);

    view.rebuildFullscreenTree(160);

    expect(view.getPanes()).toEqual(panes);
    expect(view.getPanes().diff).toBe(panes.diff);
    expect(view.getPanes().diff.scrollTop).toBe(9);
  });

  it("regular-mode render output is unchanged by the fullscreen tree", () => {
    const { view } = makeView();
    const before = view.render(160);

    view.rebuildFullscreenTree(160);

    expect(view.render(160)).toEqual(before);
  });
});

import {
  VStack,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

import type {
  ChangedFile,
  DiffReview,
  HitTarget,
  SourceListItem,
} from "../model/diff.ts";
import {
  buildComment,
  describeScope,
  type ReviewComment,
} from "../model/review-comment.ts";
import {
  anchorEquals,
  createInitialState,
  reduce,
  type LineAnchor,
  type ReviewEffect,
  type ReviewEnv,
  type ReviewSessionState,
  type UiAction,
} from "../model/review-state.ts";
import { renderFileList } from "./file-list-renderer.ts";
import { renderFooter } from "./footer-renderer.ts";
import {
  buildFullscreenEntries,
  fullscreenHeight,
  type FullscreenPanes,
  type PaneContent,
} from "./fullscreen-layout.ts";
import { computeHitTargets } from "./hit-target-registry.ts";
import { actionForKey } from "./input-controller.ts";
import {
  UNIFIED_GUTTER_WIDTH,
  computeLayout,
  type Layout,
} from "./layout.ts";
import { renderHeader } from "./review-header-renderer.ts";
import {
  buildSideBySideRows,
  renderSideBySide,
  sideBySideFits,
  sbsHunkStartRows,
} from "./side-by-side-renderer.ts";
import { renderSourceList, type RenderedRows } from "./source-list-renderer.ts";
import { SyncedScrollView } from "./synced-scroll-view.ts";
import type { Styler } from "./theme.ts";
import {
  buildUnifiedRows,
  hunkStartRows,
  placeholderFor,
  renderUnifiedDiff,
} from "./unified-renderer.ts";

export interface ViewHost {
  requestRender(): void;
  rows(): number;
}

export interface ViewDataSource {
  initialReview: DiffReview;
  recentCommits: SourceListItem[];
  loadCommit(commitOid: string, signal?: AbortSignal): Promise<DiffReview>;
  refresh(signal?: AbortSignal): Promise<{
    review: DiffReview;
    recentCommits: SourceListItem[];
  }>;
}

export interface SourceControlViewOptions {
  data: ViewDataSource;
  host: ViewHost;
  styler: Styler;
  initialSourceId: string;
  composeComment(prefill: string | undefined): Promise<string | undefined>;
  submitReview(message: string): void;
  onClose(): void;
}

interface RenderCacheEntry {
  lines: string[];
  hitTargets: HitTarget[];
  layout: Layout;
}

const WORKSPACE_SOURCES: SourceListItem[] = [
  { kind: "working", id: "working", label: "Working Tree" },
  { kind: "staged", id: "staged", label: "Staged Changes" },
];

function filesInReview(review: DiffReview): ChangedFile[] {
  return review.groups.flatMap((group) => group.files);
}

function errorNotice(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/u)[0] || "Unable to load source";
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function commitSource(review: DiffReview): SourceListItem {
  if (review.scope.kind !== "commit") {
    throw new Error("A commit source requires a commit review");
  }
  const metadata =
    review.metadata !== undefined && "subject" in review.metadata
      ? review.metadata
      : undefined;
  const oid = metadata?.oid ?? review.scope.commitOid;
  return {
    kind: "commit",
    id: `commit:${oid}`,
    commitOid: oid,
    shortOid: metadata?.shortOid ?? oid.slice(0, 7),
    subject: metadata?.subject ?? "",
    author: metadata?.authorName ?? "",
    authoredAt: metadata?.authoredAt ?? "",
    parentOids:
      metadata?.parentOids ??
      (review.scope.parentOid === undefined ? [] : [review.scope.parentOid]),
  };
}

function sourcesFor(
  review: DiffReview,
  recentCommits: SourceListItem[],
): SourceListItem[] {
  if (review.scope.kind === "workspace") {
    return [
      ...WORKSPACE_SOURCES,
      ...recentCommits.filter((item) => item.kind === "commit"),
    ];
  }
  if (review.scope.kind === "commit") return [commitSource(review)];

  const metadata =
    review.metadata !== undefined && "expression" in review.metadata
      ? review.metadata
      : undefined;
  return [
    {
      kind: "range",
      id: "range",
      label: metadata?.expression ?? review.scope.requestedExpression,
    },
  ];
}

function logicalSourceRows(sources: SourceListItem[]): number {
  const only = sources[0];
  if (
    sources.length === 1 &&
    only !== undefined &&
    (only.kind === "commit" || only.kind === "range")
  ) {
    return 1;
  }
  return sources.length + 3;
}

class DynamicPaneContent implements PaneContent {
  constructor(
    private readonly beforeRender: (width: number) => void,
    private readonly renderLines: (width: number) => string[],
  ) {}

  render(width: number): string[] {
    this.beforeRender(width);
    return this.renderLines(width);
  }

  invalidate(): void {}
}

interface FullscreenBuild {
  width: number;
  rows: number;
  viewMode: ReviewSessionState["viewMode"];
  focusedPane: ReviewSessionState["focusedPane"];
}

export class SourceControlView extends VStack {
  private readonly data: ViewDataSource;
  private readonly host: ViewHost;
  private readonly styler: Styler;
  private readonly composeComment: SourceControlViewOptions["composeComment"];
  private readonly submitReview: SourceControlViewOptions["submitReview"];
  private readonly onClose: () => void;
  private primaryReview: DiffReview;
  private recentCommits: SourceListItem[];
  private sources: SourceListItem[];
  private state: ReviewSessionState;
  private lastLayout: Layout;
  private styleVersion = 0;
  private disposed = false;
  private operationEpoch = 0;
  private readonly commitCache = new Map<string, DiffReview>();
  private readonly attemptedSourceIds = new Set<string>();
  private readonly loadingSourceIds = new Set<string>();
  private readonly controllers = new Set<AbortController>();
  private readonly renderCache = new Map<string, RenderCacheEntry>();
  private hitTargets: HitTarget[] = [];
  private readonly fullscreenHeader: PaneContent;
  private readonly fullscreenFooter: PaneContent;
  private readonly fullscreenSources: PaneContent;
  private readonly fullscreenFiles: PaneContent;
  private readonly fullscreenDiff: PaneContent;
  private readonly fullscreenPanes: FullscreenPanes;
  private fullscreenBuild: FullscreenBuild | undefined;
  private rebuildingFullscreenTree = false;
  private fullscreenActive = false;

  constructor(options: SourceControlViewOptions) {
    super();
    this.data = options.data;
    this.host = options.host;
    this.styler = options.styler;
    this.composeComment = options.composeComment;
    this.submitReview = options.submitReview;
    this.onClose = options.onClose;
    this.primaryReview = options.data.initialReview;
    this.recentCommits = options.data.recentCommits;
    this.sources = sourcesFor(this.primaryReview, this.recentCommits);
    this.seedPrimaryCommit();
    this.lastLayout = computeLayout(80, this.host.rows());

    const initialSourceId = this.sources.some(
      (source) => source.id === options.initialSourceId,
    )
      ? options.initialSourceId
      : (this.sources[0]?.id ?? options.initialSourceId);
    this.state = createInitialState(initialSourceId, this.environment(this.lastLayout));

    this.fullscreenHeader = new DynamicPaneContent(
      (width) => this.ensureFullscreenTree(width, true),
      (width) =>
        renderHeader(
          this.reviewForSource(this.state.selectedSourceId),
          this.selectedFile(),
          this.state.viewMode,
          width,
          this.styler,
        ),
    );
    this.fullscreenFooter = new DynamicPaneContent(
      (width) => this.ensureFullscreenTree(width, true),
      (width) => this.renderFullscreenFooter(width),
    );
    this.fullscreenSources = new DynamicPaneContent(
      () => this.ensureFullscreenTree(undefined, false),
      (width) => this.renderSources(width, Number.MAX_SAFE_INTEGER, 0).lines,
    );
    this.fullscreenFiles = new DynamicPaneContent(
      () => this.ensureFullscreenTree(undefined, false),
      (width) => this.renderFiles(width, Number.MAX_SAFE_INTEGER, 0).lines,
    );
    this.fullscreenDiff = new DynamicPaneContent(
      () => this.ensureFullscreenTree(undefined, false),
      (width) => this.renderFullscreenDiff(width),
    );
    const scrollOptions = {
      overscroll: "contain" as const,
      scrollbar: "auto" as const,
    };
    this.fullscreenPanes = {
      sources: new SyncedScrollView(
        this.fullscreenSources,
        scrollOptions,
        (offset) =>
          this.dispatch({ type: "set-scroll", pane: "sources", offset }),
      ),
      files: new SyncedScrollView(
        this.fullscreenFiles,
        scrollOptions,
        (offset) =>
          this.dispatch({ type: "set-scroll", pane: "files", offset }),
      ),
      diff: new SyncedScrollView(
        this.fullscreenDiff,
        scrollOptions,
        (offset) =>
          this.dispatch({ type: "set-scroll", pane: "diff", offset }),
      ),
    };
    this.syncFullscreenScrollOffsets();
    this.rebuildFullscreenTree(80);

    const source = this.sourceById(initialSourceId);
    if (source?.kind === "commit" && !this.commitCache.has(source.commitOid)) {
      this.state = {
        ...this.state,
        pendingSourceId: source.id,
        version: this.state.version + 1,
      };
      this.startCommitLoad(source);
    }
  }

  render(width: number): string[] {
    this.fullscreenActive = false;
    const safeWidth = Math.max(0, Math.trunc(width));
    const height = Math.max(0, Math.trunc(this.host.rows()));
    const layout = computeLayout(safeWidth, height);
    const selectedFile = this.selectedFile();
    const cacheKey = JSON.stringify([
      safeWidth,
      height,
      this.state.version,
      selectedFile?.patchFingerprint,
      this.styleVersion,
    ]);
    const cached = this.renderCache.get(cacheKey);
    if (cached !== undefined) {
      this.lastLayout = cached.layout;
      this.hitTargets = cached.hitTargets;
      return cached.lines;
    }

    this.lastLayout = layout;
    const review = this.reviewForSource(this.state.selectedSourceId);
    const header = renderHeader(
      review,
      selectedFile,
      this.state.viewMode,
      safeWidth,
      this.styler,
    );
    const body = this.renderBody(layout, selectedFile);
    const selectedFiles = this.filesForSource(this.state.selectedSourceId);
    const reviewedCount = selectedFiles.filter((file) =>
      this.state.reviewedFingerprints.has(file.patchFingerprint),
    ).length;
    const footer = renderFooter(
      {
        reviewedCount,
        totalCount: selectedFiles.length,
        focusedPane: this.state.focusedPane,
        compact: layout.compactFooter,
        helpVisible: this.state.helpVisible,
        commentCount: this.state.comments.length,
        notice: this.state.notice,
      },
      safeWidth,
      this.styler,
    );
    const lines = [
      ...header,
      this.renderBorder(layout, "top"),
      ...body.lines,
      this.renderBorder(layout, "bottom"),
      ...footer,
    ].map((line) => fitLine(line, safeWidth));

    this.hitTargets = computeHitTargets({
      layout,
      sourceRowIds: body.sourceRows.rowIds,
      fileRowIds: body.fileRows.rowIds,
      sourceListTop: 2,
      fileListTop: 2 + body.sourceHeight,
      diffTop: 2,
    });
    const entry = { lines, hitTargets: this.hitTargets, layout };
    this.renderCache.set(cacheKey, entry);
    return lines;
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    const layout = this.interactionLayout();
    const action = actionForKey(data, this.state, layout);
    if (action !== undefined) this.dispatch(action);
  }

  invalidate(): void {
    this.styleVersion += 1;
    this.renderCache.clear();
    this.fullscreenHeader.invalidate();
    this.fullscreenFooter.invalidate();
    this.fullscreenPanes.sources.invalidate();
    this.fullscreenPanes.files.invalidate();
    this.fullscreenPanes.diff.invalidate();
    this.rebuildFullscreenTree(this.fullscreenBuild?.width ?? this.lastLayout.width);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operationEpoch += 1;
    this.abortControllers();
    this.loadingSourceIds.clear();
  }

  getState(): ReviewSessionState {
    return this.state;
  }

  getHitTargets(): HitTarget[] {
    return this.hitTargets;
  }

  getPanes(): FullscreenPanes {
    return this.fullscreenPanes;
  }

  getCommentEditorTitle(): string {
    const file = this.selectedFile();
    const anchor = file === undefined
      ? undefined
      : this.state.cursorByFile.get(file.id);
    const hunk = anchor === undefined
      ? undefined
      : file?.hunks.find((candidate) => candidate.index === anchor.hunkIndex);
    const line = anchor === undefined ? undefined : hunk?.lines[anchor.lineIndex];
    if (file === undefined || line === undefined || line.kind === "metadata") {
      return "Review comment";
    }
    const lineNumber = line.newLineNumber !== undefined
      ? String(line.newLineNumber)
      : `-${line.oldLineNumber ?? 0}`;
    return `Comment on ${file.newPath}:${lineNumber}`;
  }

  rebuildFullscreenTree(width: number): void {
    if (this.rebuildingFullscreenTree) return;
    this.rebuildingFullscreenTree = true;
    try {
      const safeWidth = Math.max(0, Math.trunc(width));
      const rows = fullscreenHeight(this.host.rows());
      const layout = computeLayout(safeWidth, rows);
      const entries = buildFullscreenEntries({
        layout,
        focusedPane: this.state.focusedPane,
        header: this.fullscreenHeader,
        footer: this.fullscreenFooter,
        panes: this.fullscreenPanes,
        styler: this.styler,
      });
      this.clear();
      for (const entry of entries) {
        if ("render" in entry) this.addChild(entry);
        else this.addChild(entry.component, entry);
      }
      this.fullscreenBuild = {
        width: safeWidth,
        rows: Math.max(0, Math.trunc(this.host.rows())),
        viewMode: this.state.viewMode,
        focusedPane: this.state.focusedPane,
      };
    } finally {
      this.rebuildingFullscreenTree = false;
    }
  }

  dispatch(action: UiAction): void {
    if (this.disposed) return;
    const previousFocus = this.state.focusedPane;
    const previousMode = this.state.viewMode;
    const layout = this.interactionLayout();
    const result = reduce(this.state, action, this.environment(layout));
    this.state = result.state;
    this.syncFullscreenScrollOffsets();
    if (
      this.state.focusedPane !== previousFocus ||
      this.state.viewMode !== previousMode
    ) {
      this.rebuildFullscreenTree(
        this.fullscreenBuild?.width ?? this.lastLayout.width,
      );
    }
    if (action.type !== "set-scroll") this.host.requestRender();

    for (const effect of result.effects) this.runEffect(effect);
  }

  private renderBody(
    layout: Layout,
    selectedFile: ChangedFile | undefined,
  ): {
    lines: string[];
    sourceRows: RenderedRows;
    fileRows: RenderedRows;
    sourceHeight: number;
  } {
    if (layout.mode === "narrow") {
      if (this.state.focusedPane === "sources") {
        const sourceRows = this.renderSources(layout.width, layout.bodyHeight);
        return {
          lines: this.padRows(sourceRows.lines, layout.bodyHeight, layout.width),
          sourceRows,
          fileRows: { lines: [], rowIds: [] },
          sourceHeight: 0,
        };
      }
      if (this.state.focusedPane === "files") {
        const fileRows = this.renderFiles(layout.width, layout.bodyHeight);
        return {
          lines: this.padRows(fileRows.lines, layout.bodyHeight, layout.width),
          sourceRows: { lines: [], rowIds: [] },
          fileRows,
          sourceHeight: 0,
        };
      }
      return {
        lines: this.renderDiff(selectedFile, layout.width, layout.bodyHeight),
        sourceRows: { lines: [], rowIds: [] },
        fileRows: { lines: [], rowIds: [] },
        sourceHeight: 0,
      };
    }

    const sourceHeight = Math.min(
      logicalSourceRows(this.sources),
      Math.floor(layout.bodyHeight / 2),
    );
    const fileHeight = layout.bodyHeight - sourceHeight;
    const sourceRows = this.renderSources(layout.leftWidth, sourceHeight);
    const fileRows = this.renderFiles(layout.leftWidth, fileHeight);
    const left = [
      ...this.padRows(sourceRows.lines, sourceHeight, layout.leftWidth),
      ...this.padRows(fileRows.lines, fileHeight, layout.leftWidth),
    ];
    const right = this.renderDiff(
      selectedFile,
      layout.rightWidth,
      layout.bodyHeight,
    );
    const divider = this.styler.fg(
      this.state.focusedPane === "diff" ? "borderAccent" : "borderMuted",
      "│",
    );
    return {
      lines: left.map((line, index) =>
        line + divider + (right[index] ?? " ".repeat(layout.rightWidth)),
      ),
      sourceRows,
      fileRows,
      sourceHeight,
    };
  }

  private renderSources(
    width: number,
    maxRows: number,
    scrollOffset = this.state.sourceScrollOffset,
  ): RenderedRows {
    const counts: Record<string, number | undefined> = {};
    for (const source of this.sources) {
      counts[source.id] =
        source.kind === "commit" && !this.commitCache.has(source.commitOid)
          ? undefined
          : this.filesForSource(source.id).length;
    }
    return renderSourceList(
      {
        items: this.sources,
        counts,
        selectedId: this.state.selectedSourceId,
        focused: this.state.focusedPane === "sources",
        scrollOffset,
        maxRows,
      },
      width,
      this.styler,
    );
  }

  private renderFiles(
    width: number,
    maxRows: number,
    scrollOffset = this.state.fileScrollOffset,
  ): RenderedRows {
    const files = this.filesForSource(this.state.selectedSourceId);
    const reviewedIds = new Set(
      files
        .filter((file) =>
          this.state.reviewedFingerprints.has(file.patchFingerprint),
        )
        .map((file) => file.id),
    );
    const loading = this.loadingSourceIds.has(this.state.selectedSourceId);
    const scopeLabel = this.scopeLabelForSource(this.state.selectedSourceId);
    const commentedIds = new Set(
      this.state.comments
        .filter((comment) => comment.scopeLabel === scopeLabel)
        .map((comment) => comment.fileId),
    );
    return renderFileList(
      {
        files,
        selectedId: this.state.selectedFileId,
        reviewed: reviewedIds,
        commented: commentedIds,
        focused: this.state.focusedPane === "files",
        scrollOffset,
        maxRows,
        title: this.fileTitle(this.state.selectedSourceId),
        emptyMessage: loading ? "Loading…" : undefined,
      },
      width,
      this.styler,
    );
  }

  private renderDiff(
    selectedFile: ChangedFile | undefined,
    width: number,
    height: number,
  ): string[] {
    if (this.loadingSourceIds.has(this.state.selectedSourceId)) {
      return Array.from({ length: height }, () => " ".repeat(width));
    }
    const verticalOffset =
      selectedFile === undefined
        ? 0
        : (this.state.verticalOffsetByFile.get(selectedFile.id) ?? 0);
    const horizontalOffset =
      selectedFile === undefined
        ? 0
        : (this.state.horizontalOffsetByFile.get(selectedFile.id) ?? 0);
    const input = {
      file: selectedFile,
      verticalOffset,
      horizontalOffset,
      height,
      cursor:
        selectedFile === undefined
          ? undefined
          : this.state.cursorByFile.get(selectedFile.id),
      focused: this.state.focusedPane === "diff",
    };
    return this.state.viewMode === "side-by-side"
      ? renderSideBySide(input, width, this.styler)
      : renderUnifiedDiff(input, width, this.styler);
  }

  private renderFullscreenDiff(width: number): string[] {
    const selectedFile = this.selectedFile();
    if (this.loadingSourceIds.has(this.state.selectedSourceId)) {
      return [fitLine(this.styler.fg("muted", "Loading…"), width)];
    }

    const placeholder = placeholderFor(selectedFile);
    if (placeholder !== undefined) return [fitLine(placeholder, width)];

    const horizontalOffset =
      this.state.horizontalOffsetByFile.get(selectedFile!.id) ?? 0;
    const cursor = this.state.cursorByFile.get(selectedFile!.id);
    const focused = this.state.focusedPane === "diff";
    if (this.state.viewMode === "side-by-side") {
      const height = sideBySideFits(width)
        ? buildSideBySideRows(
            selectedFile!,
            this.styler,
            width,
            horizontalOffset,
            cursor,
            focused,
          ).length
        : 1;
      return renderSideBySide(
        {
          file: selectedFile,
          verticalOffset: 0,
          horizontalOffset,
          height,
          cursor,
          focused,
        },
        width,
        this.styler,
      );
    }

    const height = buildUnifiedRows(
      selectedFile!,
      this.styler,
      Math.max(0, width - UNIFIED_GUTTER_WIDTH),
      horizontalOffset,
      cursor,
      focused,
    ).length;
    return renderUnifiedDiff(
      {
        file: selectedFile,
        verticalOffset: 0,
        horizontalOffset,
        height,
        cursor,
        focused,
      },
      width,
      this.styler,
    );
  }

  private renderFullscreenFooter(width: number): string[] {
    const files = this.filesForSource(this.state.selectedSourceId);
    const reviewedCount = files.filter((file) =>
      this.state.reviewedFingerprints.has(file.patchFingerprint),
    ).length;
    const compact =
      this.fullscreenBuild === undefined
        ? this.lastLayout.compactFooter
        : computeLayout(
            this.fullscreenBuild.width,
            fullscreenHeight(this.host.rows()),
          ).compactFooter;
    return renderFooter(
      {
        reviewedCount,
        totalCount: files.length,
        focusedPane: this.state.focusedPane,
        compact,
        helpVisible: this.state.helpVisible,
        commentCount: this.state.comments.length,
        notice: this.state.notice,
      },
      width,
      this.styler,
    );
  }

  private renderBorder(layout: Layout, edge: "top" | "bottom"): string {
    if (layout.mode === "narrow") {
      return this.styler.fg("borderAccent", "─".repeat(layout.width));
    }
    const leftRole =
      this.state.focusedPane === "diff" ? "borderMuted" : "borderAccent";
    const rightRole =
      this.state.focusedPane === "diff" ? "borderAccent" : "borderMuted";
    return (
      this.styler.fg(leftRole, "─".repeat(layout.leftWidth)) +
      this.styler.fg("borderMuted", edge === "top" ? "┬" : "┴") +
      this.styler.fg(rightRole, "─".repeat(layout.rightWidth))
    );
  }

  private padRows(lines: string[], height: number, width: number): string[] {
    return Array.from({ length: height }, (_, index) =>
      fitLine(lines[index] ?? "", width),
    );
  }

  private ensureFullscreenTree(
    width: number | undefined,
    hasRootWidth: boolean,
  ): void {
    if (this.rebuildingFullscreenTree) return;
    this.fullscreenActive = true;
    const build = this.fullscreenBuild;
    const nextWidth =
      hasRootWidth && width !== undefined
        ? Math.max(0, Math.trunc(width))
        : (build?.width ?? this.lastLayout.width);
    const rows = Math.max(0, Math.trunc(this.host.rows()));
    if (
      build === undefined ||
      build.width !== nextWidth ||
      build.rows !== rows ||
      build.viewMode !== this.state.viewMode ||
      build.focusedPane !== this.state.focusedPane
    ) {
      this.rebuildFullscreenTree(nextWidth);
    }
  }

  private interactionLayout(): Layout {
    if (this.fullscreenActive && this.fullscreenBuild !== undefined) {
      return computeLayout(
        this.fullscreenBuild.width,
        fullscreenHeight(this.host.rows()),
      );
    }
    return computeLayout(this.lastLayout.width, this.host.rows());
  }

  private syncFullscreenScrollOffsets(): void {
    this.fullscreenPanes.sources.setDesiredScrollTop(
      this.state.sourceScrollOffset,
    );
    this.fullscreenPanes.files.setDesiredScrollTop(this.state.fileScrollOffset);
    const selectedFileId = this.state.selectedFileId;
    this.fullscreenPanes.diff.setDesiredScrollTop(
      selectedFileId === undefined
        ? 0
        : (this.state.verticalOffsetByFile.get(selectedFileId) ?? 0),
    );
  }

  private environment(layout: Layout): ReviewEnv {
    return {
      layout,
      sources: this.sources,
      filesForSource: (sourceId) => this.filesForSource(sourceId),
      fileById: (fileId) => this.fileById(fileId),
      diffRowCount: (file, mode) =>
        mode === "side-by-side"
          ? buildSideBySideRows(
              file,
              this.styler,
              this.diffWidth(layout),
              this.state.horizontalOffsetByFile.get(file.id) ?? 0,
            ).length
          : buildUnifiedRows(
              file,
              this.styler,
              Math.max(0, this.diffWidth(layout) - UNIFIED_GUTTER_WIDTH),
              this.state.horizontalOffsetByFile.get(file.id) ?? 0,
            ).length,
      hunkRows: (file, mode) =>
        mode === "side-by-side"
          ? sbsHunkStartRows(file)
          : hunkStartRows(file),
      lineAnchors: (file) => this.lineAnchors(file),
      rowForAnchor: (file, anchor, mode) =>
        this.rowForAnchor(file, anchor, mode, layout),
    };
  }

  private lineAnchors(file: ChangedFile): LineAnchor[] {
    return file.hunks.flatMap((hunk) =>
      hunk.lines.flatMap((line, lineIndex) =>
        line.kind === "metadata"
          ? []
          : [{ hunkIndex: hunk.index, lineIndex }]
      )
    );
  }

  private rowForAnchor(
    file: ChangedFile,
    anchor: LineAnchor,
    mode: ReviewSessionState["viewMode"],
    layout: Layout,
  ): number {
    const horizontalOffset = this.state.horizontalOffsetByFile.get(file.id) ?? 0;
    if (mode === "side-by-side") {
      return buildSideBySideRows(
        file,
        this.styler,
        this.diffWidth(layout),
        horizontalOffset,
      ).findIndex((row) =>
        row.anchors?.some((candidate) => anchorEquals(candidate, anchor)) ??
        anchorEquals(row.anchor, anchor)
      );
    }
    return buildUnifiedRows(
      file,
      this.styler,
      Math.max(0, this.diffWidth(layout) - UNIFIED_GUTTER_WIDTH),
      horizontalOffset,
    ).findIndex((row) => anchorEquals(row.anchor, anchor));
  }

  private diffWidth(layout: Layout): number {
    return layout.mode === "narrow" ? layout.width : layout.rightWidth;
  }

  private filesForSource(sourceId: string): ChangedFile[] {
    const source = this.sourceById(sourceId);
    if (source?.kind === "working" || source?.kind === "staged") {
      return (
        this.primaryReview.groups.find((group) => group.id === source.kind)
          ?.files ?? []
      );
    }
    if (source?.kind === "commit") {
      const review = this.commitCache.get(source.commitOid);
      return review === undefined ? [] : filesInReview(review);
    }
    if (source?.kind === "range") return filesInReview(this.primaryReview);
    return [];
  }

  private fileById(fileId: string): ChangedFile | undefined {
    return (
      this.filesForSource(this.state.selectedSourceId).find(
        (file) => file.id === fileId,
      ) ??
      filesInReview(this.primaryReview).find((file) => file.id === fileId) ??
      [...this.commitCache.values()]
        .flatMap((review) => filesInReview(review))
        .find((file) => file.id === fileId)
    );
  }

  private selectedFile(): ChangedFile | undefined {
    if (this.state.selectedFileId === undefined) return undefined;
    return this.filesForSource(this.state.selectedSourceId).find(
      (file) => file.id === this.state.selectedFileId,
    );
  }

  private sourceById(sourceId: string): SourceListItem | undefined {
    return this.sources.find((source) => source.id === sourceId);
  }

  private reviewForSource(sourceId: string): DiffReview {
    const source = this.sourceById(sourceId);
    if (source?.kind !== "commit") return this.primaryReview;
    return (
      this.commitCache.get(source.commitOid) ?? {
        repositoryRoot: this.primaryReview.repositoryRoot,
        scope: {
          kind: "commit",
          requestedRevision: source.commitOid,
          commitOid: source.commitOid,
          parentOid: source.parentOids[0],
          parentCount: source.parentOids.length,
        },
        groups: [],
        metadata: {
          oid: source.commitOid,
          shortOid: source.shortOid,
          subject: source.subject,
          authorName: source.author,
          authoredAt: source.authoredAt,
          parentOids: source.parentOids,
        },
        generatedAt: this.primaryReview.generatedAt,
      }
    );
  }

  private fileTitle(sourceId: string): string {
    const source = this.sourceById(sourceId);
    if (source?.kind === "working" || source?.kind === "staged") {
      return (
        this.primaryReview.groups.find((group) => group.id === source.kind)
          ?.title ?? "FILES CHANGED"
      );
    }
    const review = this.reviewForSource(sourceId);
    return review.groups[0]?.title ?? "FILES CHANGED";
  }

  private runEffect(effect: ReviewEffect): void {
    if (effect.type === "close") {
      this.dispose();
      this.onClose();
      return;
    }
    if (effect.type === "refresh") {
      this.startRefresh();
      return;
    }
    if (effect.type === "compose-comment") {
      this.startCommentComposition(effect);
      return;
    }
    if (effect.type === "submit-review") {
      this.submitReview(effect.message);
      return;
    }
    const source = this.sourceById(effect.sourceId);
    if (source?.kind === "commit") this.startCommitLoad(source);
  }

  private startCommentComposition(
    effect: Extract<ReviewEffect, { type: "compose-comment" }>,
  ): void {
    const hunk = effect.file.hunks.find(
      (candidate) => candidate.index === effect.anchor.hunkIndex,
    );
    const line = hunk?.lines[effect.anchor.lineIndex];
    if (line === undefined || line.kind === "metadata") {
      this.setNotice("Nothing to comment on here.");
      this.host.requestRender();
      return;
    }
    const scopeLabel = this.scopeLabelForSource(this.state.selectedSourceId);
    void this.composeComment(effect.existingBody)
      .then((body) => {
        if (this.disposed || body === undefined || body.trim() === "") return;
        this.dispatch({
          type: "add-comment",
          comment: buildComment({
            file: effect.file,
            anchor: effect.anchor,
            body: body.trim(),
            scopeLabel,
            now: Date.now(),
          }),
        });
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        this.setNotice(errorNotice(error));
        this.host.requestRender();
      });
  }

  private startCommitLoad(source: Extract<SourceListItem, { kind: "commit" }>): void {
    if (this.disposed) return;
    if (this.commitCache.has(source.commitOid)) {
      this.clearPendingSource(source.id);
      return;
    }
    if (this.attemptedSourceIds.has(source.id)) return;

    this.attemptedSourceIds.add(source.id);
    this.loadingSourceIds.add(source.id);
    const controller = new AbortController();
    const epoch = this.operationEpoch;
    this.controllers.add(controller);
    void this.data
      .loadCommit(source.commitOid, controller.signal)
      .then((review) => {
        if (this.disposed || controller.signal.aborted || epoch !== this.operationEpoch) {
          return;
        }
        this.commitCache.set(source.commitOid, review);
        this.loadingSourceIds.delete(source.id);
        this.finishSourceLoad(source.id);
        this.host.requestRender();
      })
      .catch((error: unknown) => {
        if (this.disposed || controller.signal.aborted || epoch !== this.operationEpoch) {
          return;
        }
        this.loadingSourceIds.delete(source.id);
        this.setNotice(errorNotice(error));
        this.host.requestRender();
      })
      .finally(() => {
        this.controllers.delete(controller);
      });
  }

  private finishSourceLoad(sourceId: string): void {
    const files = this.filesForSource(sourceId);
    let selectedFileBySource = this.state.selectedFileBySource;
    let selectedFileId = this.state.selectedFileId;
    let selectedFile: ChangedFile | undefined;
    if (this.state.selectedSourceId === sourceId) {
      const remembered = selectedFileBySource.get(sourceId);
      selectedFile = files.find((file) => file.id === remembered) ?? files[0];
      selectedFileId = selectedFile?.id;
      if (selectedFile !== undefined && remembered !== selectedFile.id) {
        selectedFileBySource = new Map(selectedFileBySource);
        selectedFileBySource.set(sourceId, selectedFile.id);
      }
    }
    let cursorByFile = this.state.cursorByFile;
    if (
      selectedFile !== undefined &&
      cursorByFile.get(selectedFile.id) === undefined
    ) {
      const firstAnchor = this.lineAnchors(selectedFile)[0];
      if (firstAnchor !== undefined) {
        cursorByFile = new Map(cursorByFile);
        cursorByFile.set(selectedFile.id, firstAnchor);
      }
    }
    this.state = {
      ...this.state,
      selectedFileId,
      selectedFileBySource,
      cursorByFile,
      pendingSourceId:
        this.state.pendingSourceId === sourceId
          ? undefined
          : this.state.pendingSourceId,
      version: this.state.version + 1,
    };
    this.syncFullscreenScrollOffsets();
  }

  private clearPendingSource(sourceId: string): void {
    if (this.state.pendingSourceId !== sourceId) return;
    this.state = {
      ...this.state,
      pendingSourceId: undefined,
      version: this.state.version + 1,
    };
    this.syncFullscreenScrollOffsets();
    this.host.requestRender();
  }

  private startRefresh(): void {
    if (this.disposed) return;
    this.operationEpoch += 1;
    this.abortControllers();
    this.loadingSourceIds.clear();
    const epoch = this.operationEpoch;
    const controller = new AbortController();
    this.controllers.add(controller);
    void this.data
      .refresh(controller.signal)
      .then(({ review, recentCommits }) => {
        if (this.disposed || controller.signal.aborted || epoch !== this.operationEpoch) {
          return;
        }
        this.applyRefresh(review, recentCommits);
        this.host.requestRender();

        const selectedSource = this.sourceById(this.state.selectedSourceId);
        if (
          selectedSource?.kind === "commit" &&
          !this.commitCache.has(selectedSource.commitOid)
        ) {
          this.state = {
            ...this.state,
            pendingSourceId: selectedSource.id,
            version: this.state.version + 1,
          };
          this.startCommitLoad(selectedSource);
        }
      })
      .catch((error: unknown) => {
        if (this.disposed || controller.signal.aborted || epoch !== this.operationEpoch) {
          return;
        }
        this.setNotice(errorNotice(error));
        this.host.requestRender();
      })
      .finally(() => {
        this.controllers.delete(controller);
      });
  }

  private applyRefresh(review: DiffReview, recentCommits: SourceListItem[]): void {
    const previousSourceId = this.state.selectedSourceId;
    const previousReviews = [
      this.primaryReview,
      ...this.commitCache.values(),
    ];
    const currentReviews = [
      review,
      ...previousReviews.filter((candidate) => {
        if (candidate.scope.kind !== "commit") return false;
        const commitOid = candidate.scope.commitOid;
        return recentCommits.some(
          (source) =>
            source.kind === "commit" && source.commitOid === commitOid,
        );
      }),
    ];
    const previousFingerprints = new Map(
      this.state.comments.map((comment) => [
        comment.id,
        this.fingerprintForComment(comment, previousReviews),
      ]),
    );
    this.primaryReview = review;
    this.recentCommits = recentCommits;
    this.sources = sourcesFor(review, recentCommits);
    this.commitCache.clear();
    this.attemptedSourceIds.clear();
    this.seedPrimaryCommit();

    const selectedSourceId = this.sources.some(
      (source) => source.id === previousSourceId,
    )
      ? previousSourceId
      : (this.sources[0]?.id ?? previousSourceId);
    const files = this.filesForSource(selectedSourceId);
    const remembered = this.state.selectedFileBySource.get(selectedSourceId);
    const selectedFile = files.find((file) => file.id === remembered) ?? files[0];
    const selectedFileBySource = new Map(this.state.selectedFileBySource);
    if (selectedFile === undefined) selectedFileBySource.delete(selectedSourceId);
    else selectedFileBySource.set(selectedSourceId, selectedFile.id);

    const currentFingerprints = new Set(
      filesInReview(review).map((file) => file.patchFingerprint),
    );
    const reviewedFingerprints = new Set(
      [...this.state.reviewedFingerprints].filter((fingerprint) =>
        currentFingerprints.has(fingerprint),
      ),
    );
    const comments = this.state.comments.filter((comment) => {
      const previousFingerprint = previousFingerprints.get(comment.id);
      const currentFingerprint = this.fingerprintForComment(
        comment,
        currentReviews,
      );
      return previousFingerprint !== undefined &&
        previousFingerprint === currentFingerprint;
    });
    const droppedComments = this.state.comments.length - comments.length;
    const cursorByFile = new Map(this.state.cursorByFile);
    if (selectedFile !== undefined) {
      const anchors = this.lineAnchors(selectedFile);
      const current = cursorByFile.get(selectedFile.id);
      if (!anchors.some((anchor) => anchorEquals(anchor, current))) {
        const firstAnchor = anchors[0];
        if (firstAnchor === undefined) cursorByFile.delete(selectedFile.id);
        else cursorByFile.set(selectedFile.id, firstAnchor);
      }
    }
    this.state = {
      ...this.state,
      selectedSourceId,
      selectedFileId: selectedFile?.id,
      selectedFileBySource,
      sourceScrollOffset: 0,
      fileScrollOffset: 0,
      reviewedFingerprints,
      cursorByFile,
      comments,
      pendingSourceId: undefined,
      notice: droppedComments === 0
        ? undefined
        : `${droppedComments} ${droppedComments === 1 ? "comment" : "comments"} dropped after refresh.`,
      version: this.state.version + 1,
    };
    this.syncFullscreenScrollOffsets();
  }

  private seedPrimaryCommit(): void {
    if (this.primaryReview.scope.kind === "commit") {
      this.commitCache.set(
        this.primaryReview.scope.commitOid,
        this.primaryReview,
      );
    }
  }

  private scopeLabelForSource(sourceId: string): string {
    const source = this.sourceById(sourceId);
    if (source?.kind === "working") return "working tree";
    if (source?.kind === "staged") return "staged changes";
    return describeScope(this.reviewForSource(sourceId));
  }

  private fingerprintForComment(
    comment: ReviewComment,
    reviews: DiffReview[],
  ): string | undefined {
    for (const review of reviews) {
      for (const group of review.groups) {
        const scopeLabel = review.scope.kind === "workspace"
          ? group.id === "staged" ? "staged changes" : "working tree"
          : describeScope(review);
        if (scopeLabel !== comment.scopeLabel) continue;
        const file = group.files.find((candidate) => candidate.id === comment.fileId);
        if (file !== undefined) return file.patchFingerprint;
      }
    }
    return undefined;
  }

  private setNotice(notice: string): void {
    if (this.state.notice === notice) return;
    this.state = {
      ...this.state,
      notice,
      version: this.state.version + 1,
    };
  }

  private abortControllers(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}

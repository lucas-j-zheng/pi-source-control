import {
  ScrollView,
  type Component,
  type ScrollViewOptions,
} from "@earendil-works/pi-tui";

export class SyncedScrollView extends ScrollView {
  private desiredScrollTop: number | undefined;
  private readonly onUserScroll: (scrollTop: number) => void;

  constructor(
    child: Component,
    options: ScrollViewOptions,
    onUserScroll: (scrollTop: number) => void,
  ) {
    super(child, options);
    this.onUserScroll = onUserScroll;
  }

  setDesiredScrollTop(offset: number): void {
    this.desiredScrollTop = Number.isFinite(offset)
      ? Math.max(0, Math.trunc(offset))
      : 0;
  }

  override scrollBy(lines: number): number {
    const previous = this.scrollTop;
    const remainder = super.scrollBy(lines);
    if (this.scrollTop !== previous) this.onUserScroll(this.scrollTop);
    return remainder;
  }

  override updateLayout(
    contentHeight: number,
    viewportHeight: number,
    requestRender: () => void,
  ): void {
    super.updateLayout(contentHeight, viewportHeight, requestRender);
    const desired = this.desiredScrollTop;
    this.desiredScrollTop = undefined;
    if (desired !== undefined) super.scrollTo(desired);
  }
}

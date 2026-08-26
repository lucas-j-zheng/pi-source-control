import { matchesKey } from "@earendil-works/pi-tui";

import type {
  ReviewSessionState,
  UiAction,
} from "../model/review-state.ts";
import type { Layout } from "./layout.ts";

export function actionForKey(
  data: string,
  _state: ReviewSessionState,
  _layout: Layout,
): UiAction | undefined {
  if (matchesKey(data, "up") || matchesKey(data, "k")) {
    return { type: "move", delta: -1 };
  }
  if (matchesKey(data, "down") || matchesKey(data, "j")) {
    return { type: "move", delta: 1 };
  }
  if (matchesKey(data, "shift+tab")) return { type: "focus-prev" };
  if (matchesKey(data, "tab")) return { type: "focus-next" };
  if (matchesKey(data, "enter")) return { type: "enter" };
  if (matchesKey(data, "escape")) return { type: "back" };
  if (matchesKey(data, "q")) return { type: "close" };
  if (matchesKey(data, "n")) return { type: "next-hunk" };
  if (matchesKey(data, "p")) return { type: "prev-hunk" };
  if (matchesKey(data, "pageDown")) return { type: "page", delta: 1 };
  if (matchesKey(data, "pageUp")) return { type: "page", delta: -1 };
  if (matchesKey(data, "home")) return { type: "home" };
  if (matchesKey(data, "end")) return { type: "end" };
  if (matchesKey(data, "left")) {
    return { type: "scroll-horizontal", delta: -1 };
  }
  if (matchesKey(data, "right")) {
    return { type: "scroll-horizontal", delta: 1 };
  }
  if (matchesKey(data, "v")) return { type: "toggle-view" };
  if (matchesKey(data, "space")) return { type: "toggle-reviewed" };
  if (matchesKey(data, "g")) return { type: "refresh" };
  if (matchesKey(data, "?")) return { type: "toggle-help" };
  return undefined;
}

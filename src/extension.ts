import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  runDiffCommand,
  type DiffCommandDeps,
  type ExecLike,
} from "./command/diff-command.ts";
import type { ReviewDeliverySink } from "./command/review-delivery.ts";
import { stylerFromTheme } from "./ui/theme.ts";

/** The slice of Pi's `TUI` the reviewer needs. */
export interface DiffTui {
  requestRender(): void;
  terminal: { rows: number };
}

/** The slice of Pi's theme the reviewer needs. */
export interface DiffTheme {
  fg(role: string, text: string): string;
  bg(role: string, text: string): string;
  bold(text: string): string;
}

/**
 * The slice of Pi's `ExtensionCommandContext` the reviewer needs. Narrow on
 * purpose so tests can supply a faithful stand-in for the interactive mode.
 */
export interface DiffHostContext {
  cwd: string;
  mode: string;
  signal?: AbortSignal;
  ui: {
    notify(message: string, level?: "info" | "warning" | "error"): void;
    setEditorText(text: string): void;
    custom<T>(
      factory: (
        tui: DiffTui,
        theme: DiffTheme,
        keybindings: unknown,
        done: (result: T) => void,
      ) => unknown,
    ): Promise<T>;
  };
}

/**
 * Wire `runDiffCommand` to Pi's command context.
 *
 * Two ordering facts about Pi's `showExtensionCustom` drive this wiring:
 *
 *  1. It snapshots the prompt text when the view opens and restores it inside
 *     `close()` *before* resolving, so the review message must be written after
 *     `ui.custom` has resolved — never from inside the view.
 *  2. `ui.setEditorText` is `editor.setText(text)` with no `requestRender()`,
 *     and the renders queued by `restoreEditor()` and by the keypress that
 *     closed the view are `process.nextTick` callbacks, which Node drains
 *     *before* the promise continuation that writes the message. Without an
 *     explicit render request the message sits in the editor's model and the
 *     user stares at an empty prompt until something else repaints.
 */
export function createDiffCommandDeps(
  exec: ExecLike,
  ctx: DiffHostContext,
  sendUserMessage?: ReviewDeliverySink,
): DiffCommandDeps {
  let tui: DiffTui | undefined;
  return {
    exec,
    cwd: ctx.cwd,
    mode: ctx.mode,
    notify: (message, level) => ctx.ui.notify(message, level),
    sendUserMessage,
    setEditorText: (text) => {
      ctx.ui.setEditorText(text);
      // Pi's setEditorText does not repaint; ask for the frame ourselves.
      tui?.requestRender();
    },
    openView: async (factory) => {
      await ctx.ui.custom<void>((hostTui, theme, _keybindings, done) => {
        tui = hostTui;
        return factory(
          {
            requestRender: () => hostTui.requestRender(),
            rows: () => hostTui.terminal.rows,
          },
          stylerFromTheme(theme),
          () => done(undefined),
        );
      });
    },
    signal: ctx.signal,
  };
}

export default function register(pi: ExtensionAPI): void {
  pi.registerCommand("diff", {
    description:
      "Review workspace, commit, or revision-range changes (read-only)",
    handler: async (args, ctx) => {
      await runDiffCommand(
        args,
        createDiffCommandDeps(
          (cmd, commandArgs, options) => pi.exec(cmd, commandArgs, options),
          ctx as unknown as DiffHostContext,
          // `pi` outlives the command handler and `sendUserMessage` is
          // fire-and-forget, so calling it after the view has closed is safe.
          // Guarded so an older Pi build degrades to the prompt prefill.
          typeof pi.sendUserMessage === "function"
            ? (text) => {
              pi.sendUserMessage(text, { deliverAs: "followUp" });
            }
            : undefined,
        ),
      );
    },
  });
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { runDiffCommand } from "./command/diff-command.ts";
import { stylerFromTheme } from "./ui/theme.ts";

export default function register(pi: ExtensionAPI): void {
  pi.registerCommand("diff", {
    description:
      "Review workspace, commit, or revision-range changes (read-only)",
    handler: async (args, ctx) => {
      await runDiffCommand(args, {
        exec: (cmd, commandArgs, options) =>
          pi.exec(cmd, commandArgs, options),
        cwd: ctx.cwd,
        mode: ctx.mode,
        notify: (message, level) => ctx.ui.notify(message, level),
        setEditorText: (text) => ctx.ui.setEditorText(text),
        openView: async (factory) => {
          await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
            factory(
              {
                requestRender: () => tui.requestRender(),
                rows: () => tui.terminal.rows,
              },
              stylerFromTheme(theme),
              () => done(undefined),
            )
          );
        },
        signal: ctx.signal,
      });
    },
  });
}

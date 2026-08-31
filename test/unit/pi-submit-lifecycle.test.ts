/**
 * A faithful reproduction of Pi's `showExtensionCustom` lifecycle.
 *
 * Everything modelled here is transcribed from
 * node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js
 * and node_modules/@earendil-works/pi-tui/dist/tui.js:
 *
 *  - interactive-mode.js:2095-2160  showExtensionCustom: snapshot `savedText`
 *    at open, mount the component into `editorContainer`, focus it; `close()`
 *    runs `restoreEditor()` (clear container, re-add editor, `setText(savedText)`,
 *    `setFocus(editor)`, `requestRender()`) and only THEN `resolve(result)`,
 *    and only then `component.dispose()`.
 *  - interactive-mode.js:1864  `setEditorText: (text) => this.editor.setText(text)`
 *    — no `requestRender()`.
 *  - pi-tui/components/editor.js:850-869  `setText` mutates state; it does not
 *    request a render either.
 *  - pi-tui/tui.js:612-620  input goes to `focusedComponent.handleInput(data)`
 *    followed by `requestImmediateRender()`.
 *  - pi-tui/tui.js:495-521  `requestRender` / `requestImmediateRender` schedule
 *    through `process.nextTick`.
 *
 * The last point only bites because a keystroke arrives in an I/O callback: for
 * work started from a real macrotask Node drains the `nextTick` queue BEFORE the
 * promise microtasks that resume `await ui.custom(...)`. `deliverKey` therefore
 * runs `handleInput` inside a `setImmediate` callback rather than inside a
 * promise continuation — modelling that faithfully is the whole point of this
 * file, and a fake that dispatches keys from a microtask hides the bug.
 */
import { describe, expect, it } from "vitest";

import type {
  DiffCommandDeps,
  ExecLike,
} from "../../src/command/diff-command.ts";
import { runDiffCommand } from "../../src/command/diff-command.ts";
import { GIT_GLOBAL_FLAGS } from "../../src/git/git-client.ts";
import {
  createDiffCommandDeps,
  type DiffHostContext,
  type DiffTheme,
  type DiffTui,
} from "../../src/extension.ts";
import { actionForKey } from "../../src/ui/input-controller.ts";
import type { SourceControlView } from "../../src/ui/source-control-view.ts";

const ROOT = "/repo";
const COMMIT_OID = "a".repeat(40);
const PARENT_OID = "b".repeat(40);

const WORKING_PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,4 +1,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
  " const e = 6;",
  "",
].join("\n");

function logRecord(): string {
  return [
    COMMIT_OID,
    COMMIT_OID.slice(0, 7),
    PARENT_OID,
    "Ada",
    "2026-08-25T12:00:00Z",
    "A commit",
    "",
  ].join("\0");
}

const exec: ExecLike = async (_cmd, args) => {
  const ok = (stdout: string) => ({
    stdout,
    stderr: "",
    code: 0,
    killed: false,
  });
  let commandIndex = 0;
  while (GIT_GLOBAL_FLAGS.includes(args[commandIndex] ?? "")) {
    commandIndex += 1;
  }
  const gitArgs = args.slice(commandIndex);
  const command = gitArgs[0];
  if (command === "rev-parse" && gitArgs[1] === "--show-toplevel") {
    return ok(`${ROOT}\n`);
  }
  if (command === "status") return ok(" M src/app.ts\0");
  if (command === "diff" || command === "diff-files") {
    // `diff --cached ...` is the staged patch; the plain one is the work tree.
    return ok(gitArgs[1] === "--cached" ? "" : WORKING_PATCH);
  }
  if (command === "log") return ok(logRecord());
  return ok("");
};

// ---------------------------------------------------------------------------
// The fake
// ---------------------------------------------------------------------------

interface Focusable {
  handleInput?(data: string): void;
  dispose?(): void;
}

class FakeEditor {
  private text = "";
  /** CustomEditor.handleInput; nothing in these tests types into the prompt. */
  handleInput(_data: string): void {}
  getText(): string {
    return this.text;
  }
  setText(text: string): void {
    this.text = text;
  }
}

/** Mirrors InteractiveMode + TUI closely enough to catch lifecycle bugs. */
class FakePi {
  readonly editor = new FakeEditor();
  editorContainer: Focusable[] = [];
  focused: Focusable = this.editor;
  /** Every painted frame, in order. A frame is what the prompt area shows. */
  readonly frames: string[] = [];
  readonly notices: string[] = [];
  disposedComponents = 0;

  private renderRequested = false;
  private renderScheduled = false;
  private immediateScheduled = false;

  readonly theme: DiffTheme = {
    fg: (_role, text) => text,
    bg: (_role, text) => text,
    bold: (text) => text,
  };

  constructor() {
    this.editorContainer.push(this.editor);
  }

  get tui(): DiffTui {
    return {
      requestRender: () => this.requestRender(),
      terminal: { rows: 40 },
    };
  }

  // -- pi-tui/tui.js:495-521 -------------------------------------------------
  requestRender(): void {
    if (this.renderRequested) return;
    this.renderRequested = true;
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    process.nextTick(() => {
      this.renderScheduled = false;
      if (!this.renderRequested) return;
      this.renderRequested = false;
      this.doRender();
    });
  }

  requestImmediateRender(): void {
    this.renderRequested = true;
    if (this.immediateScheduled) return;
    this.immediateScheduled = true;
    process.nextTick(() => {
      this.immediateScheduled = false;
      if (!this.renderRequested) return;
      this.renderRequested = false;
      this.doRender();
    });
  }

  private doRender(): void {
    this.frames.push(
      this.editorContainer
        .map((child) =>
          child === this.editor ? this.editor.getText() : "<view>",
        )
        .join(""),
    );
  }

  setFocus(component: Focusable): void {
    this.focused = component;
  }

  /**
   * pi-tui/tui.js:612-620. The `setImmediate` is load-bearing: it puts
   * `handleInput` in a real macrotask, as stdin does, so the `process.nextTick`
   * renders it schedules are drained before the promise continuations.
   */
  deliverKey(data: string): Promise<void> {
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        this.focused.handleInput?.(data);
        this.requestImmediateRender();
        setTimeout(resolve, 0);
      });
    });
  }

  async deliverKeys(...keys: string[]): Promise<void> {
    for (const key of keys) await this.deliverKey(key);
  }

  // -- interactive-mode.js:2095-2160 -----------------------------------------
  showExtensionCustom<T>(
    factory: (
      tui: DiffTui,
      theme: DiffTheme,
      keybindings: unknown,
      done: (result: T) => void,
    ) => unknown,
  ): Promise<T> {
    const savedText = this.editor.getText();
    const restoreEditor = () => {
      this.editorContainer = [];
      this.editorContainer.push(this.editor);
      this.editor.setText(savedText);
      this.setFocus(this.editor);
      this.requestRender();
    };
    return new Promise<T>((resolve, reject) => {
      let component: Focusable | undefined;
      let closed = false;
      const close = (result: T) => {
        if (closed) return;
        closed = true;
        restoreEditor();
        resolve(result);
        try {
          component?.dispose?.();
          this.disposedComponents += 1;
        } catch {
          /* ignore dispose errors */
        }
      };
      Promise.resolve(factory(this.tui, this.theme, {}, close) as Focusable)
        .then((created) => {
          if (closed) return;
          component = created;
          this.editorContainer = [created];
          this.setFocus(created);
          this.requestRender();
        })
        .catch((error: unknown) => {
          if (closed) return;
          restoreEditor();
          reject(error as Error);
        });
    });
  }

  // -- interactive-mode.js:1840-1870 (createExtensionUIContext) --------------
  context(): DiffHostContext {
    return {
      cwd: ROOT,
      mode: "tui",
      ui: {
        notify: (message) => {
          this.notices.push(message);
        },
        // interactive-mode.js:1864 — deliberately no requestRender().
        setEditorText: (text) => this.editor.setText(text),
        custom: (factory) => this.showExtensionCustom(factory),
      },
    };
  }
}

/** Let every pending tick, microtask and timer drain. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}

interface Session {
  pi: FakePi;
  view: SourceControlView;
  finished: Promise<void>;
}

async function openReviewer(
  depsFrom: (pi: FakePi) => DiffCommandDeps = (pi) =>
    createDiffCommandDeps(exec, pi.context()),
): Promise<Session> {
  const pi = new FakePi();
  let view: SourceControlView | undefined;
  const deps = depsFrom(pi);
  const finished = runDiffCommand("", {
    ...deps,
    openView: (factory) =>
      deps.openView((host, styler, done) => {
        view = factory(host, styler, done);
        return view;
      }),
  });
  await settle();
  if (view === undefined) throw new Error("reviewer never mounted");
  return { pi, view, finished };
}

/** `c`, type a body, Enter — the real compose flow, byte for byte. */
async function addComment(pi: FakePi, body: string): Promise<void> {
  await pi.deliverKey("c");
  await pi.deliverKeys(...body.split(""));
  await pi.deliverKey("\r");
}

/** Tab twice: sources -> files -> diff. */
async function focusDiff(pi: FakePi): Promise<void> {
  await pi.deliverKeys("\t", "\t");
}

describe("Pi submit lifecycle", () => {
  it("maps the bytes a terminal sends for Shift+S", () => {
    const state = {} as never;
    const layout = {} as never;
    // Legacy terminals send the bare uppercase byte.
    expect(actionForKey("S", state, layout)).toEqual({
      type: "submit-comments",
    });
    // Kitty keyboard protocol / modifyOtherKeys encodings.
    for (
      const encoded of ["\x1b[115;2u", "\x1b[115:83;2u", "\x1b[83;2u", "\x1b[27;2;83~"]
    ) {
      expect(actionForKey(encoded, state, layout)).toEqual({
        type: "submit-comments",
      });
    }
    // Lowercase must not submit.
    expect(actionForKey("s", state, layout)).toBeUndefined();
  });

  it("reaches submit-comments with two queued comments and builds a message", async () => {
    const { pi, view, finished } = await openReviewer();

    await focusDiff(pi);
    await addComment(pi, "first");
    await pi.deliverKey("j");
    await addComment(pi, "second");

    expect(view.getState().comments).toHaveLength(2);
    expect(view.getState().composing).toBeUndefined();

    await pi.deliverKey("S");
    await finished;
    await settle();

    expect(view.getState().comments).toHaveLength(0);
    expect(pi.editor.getText()).toMatch(/^Review of /u);
    expect(pi.editor.getText()).toContain("first");
    expect(pi.editor.getText()).toContain("second");
  });

  it("leaves the review message in the editor after restoreEditor runs", async () => {
    const { pi, finished } = await openReviewer();
    await focusDiff(pi);
    await addComment(pi, "please rename this");
    await pi.deliverKey("S");
    await finished;
    await settle();

    expect(pi.editor.getText()).toContain("please rename this");
    expect(pi.disposedComponents).toBe(1);
  });

  it("REGRESSION: paints a frame containing the review message", async () => {
    // Pi's setEditorText does not repaint, and the renders queued by
    // restoreEditor()/requestImmediateRender() are process.nextTick callbacks
    // that run BEFORE the `await ui.custom(...)` continuation. Without an
    // explicit requestRender() the user is left staring at an empty prompt.
    const { pi, finished } = await openReviewer();
    await focusDiff(pi);
    await addComment(pi, "needs a test");
    await pi.deliverKey("S");
    await finished;
    await settle();

    expect(pi.frames.at(-1)).toContain("needs a test");
  });

  it("proves the fake catches the missing repaint", async () => {
    // The same run, wired the way Pi ships it: setEditorText with no render.
    const { pi, finished } = await openReviewer((instance) => {
      const ctx = instance.context();
      return {
        ...createDiffCommandDeps(exec, ctx),
        setEditorText: (text) => ctx.ui.setEditorText(text),
      };
    });
    await focusDiff(pi);
    await addComment(pi, "invisible comment");
    await pi.deliverKey("S");
    await finished;
    await settle();

    // The text is in the editor's model...
    expect(pi.editor.getText()).toContain("invisible comment");
    // ...but the last painted frame never showed it: the reported symptom.
    expect(pi.frames.at(-1)).not.toContain("invisible comment");
  });

  it("nothing clears the editor after the message is set", async () => {
    const { pi, view, finished } = await openReviewer();
    await focusDiff(pi);
    await addComment(pi, "still here");
    await pi.deliverKey("S");
    await finished;
    // Give any in-flight async refresh / dispose / re-render a chance to fire.
    await settle();
    await settle();
    view.dispose();
    await settle();

    expect(pi.editor.getText()).toContain("still here");
    expect(pi.frames.at(-1)).toContain("still here");
  });

  it("does not submit when there are no comments", async () => {
    const { pi, view, finished } = await openReviewer();
    await pi.deliverKey("S");

    expect(view.getState().notice).toBe("No comments to submit.");
    expect(pi.editor.getText()).toBe("");

    await pi.deliverKey("q");
    await finished;
  });
});

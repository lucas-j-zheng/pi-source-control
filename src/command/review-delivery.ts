/**
 * Delivery of a composed review message to Pi.
 *
 * `Shift+S` in the reviewer produces a message and a comment count; this module
 * decides how it reaches the agent. Pi's `ExtensionAPI.sendUserMessage` submits a
 * user turn directly, which is what the user wants (the review starts working on
 * its own). When that API is missing or refuses, the message is typed into the
 * prompt instead so the queued comments are never lost.
 *
 * Every path notifies. A review that silently disappears is the worst outcome
 * here, so "no notification" is not a valid state.
 *
 * What the notice can honestly claim: `pi.sendUserMessage` is fire-and-forget.
 * Pi's `AgentSession` wraps it as `sendUserMessage(...).catch(err => emitError(...))`
 * (`dist/core/agent-session.js`), so the promise never reaches this module and an
 * asynchronous failure is invisible here. The `try` below therefore catches only a
 * synchronous throw — a missing/uninitialized runtime, a stale extension. The
 * notice says the review was handed to the agent, which is exactly what we know;
 * it does not claim the model received it.
 */

export type ReviewDeliverySink = (text: string) => void;

export interface ReviewDeliveryDeps {
  /**
   * Submit the review as a user turn. Omitted when the host Pi build has no
   * `sendUserMessage`, in which case delivery falls back to the prompt.
   */
  sendUserMessage?: ReviewDeliverySink;
  /** Type the review into the core input editor (fallback path). */
  setEditorText: ReviewDeliverySink;
  notify(msg: string, level: "info" | "warning" | "error"): void;
}

export type ReviewDeliveryOutcome = "sent" | "prefilled";

export function describeCommentCount(count: number): string {
  return `${count} ${count === 1 ? "comment" : "comments"}`;
}

function reasonFor(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length > 0 ? firstLine : "unknown error";
}

/**
 * Hand `message` to Pi and tell the user what happened.
 *
 * Returns "sent" when the send call returned without throwing, "prefilled" when
 * the message was left in the prompt for the user to send with Enter.
 */
export function deliverReview(
  message: string,
  commentCount: number,
  deps: ReviewDeliveryDeps,
): ReviewDeliveryOutcome {
  const counted = describeCommentCount(commentCount);

  if (deps.sendUserMessage !== undefined) {
    try {
      deps.sendUserMessage(message);
      // The send is fire-and-forget (see the module comment): returning without
      // throwing is the whole of what we know, so the notice claims no more.
      deps.notify(`Review sent to the agent — ${counted}`, "info");
      return "sent";
    } catch (error) {
      // Fall through to the prompt rather than losing the review, but say why.
      deps.setEditorText(message);
      deps.notify(
        `Could not send the review (${reasonFor(error)}) — copied to the ` +
          `prompt, press Enter to send (${counted})`,
        "warning",
      );
      return "prefilled";
    }
  }

  deps.setEditorText(message);
  deps.notify(
    `Review copied to the prompt — press Enter to send (${counted})`,
    "info",
  );
  return "prefilled";
}

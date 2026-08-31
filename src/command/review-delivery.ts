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
 * Returns "sent" when a turn was submitted, "prefilled" when the message was
 * left in the prompt for the user to send with Enter.
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
      deps.notify(`Review sent — ${counted}`, "info");
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

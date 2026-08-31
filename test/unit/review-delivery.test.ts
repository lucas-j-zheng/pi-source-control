import { describe, expect, it, vi } from "vitest";

import {
  deliverReview,
  describeCommentCount,
  type ReviewDeliveryDeps,
} from "../../src/command/review-delivery.ts";

function deps(overrides: Partial<ReviewDeliveryDeps> = {}): {
  deps: ReviewDeliveryDeps;
  sendUserMessage: ReturnType<typeof vi.fn>;
  setEditorText: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
} {
  const sendUserMessage = vi.fn();
  const setEditorText = vi.fn();
  const notify = vi.fn();
  return {
    sendUserMessage,
    setEditorText,
    notify,
    deps: { sendUserMessage, setEditorText, notify, ...overrides },
  };
}

describe("review delivery", () => {
  it("sends the review as a user turn when the host can send", () => {
    const subject = deps();

    const outcome = deliverReview("Review body", 2, subject.deps);

    expect(outcome).toBe("sent");
    expect(subject.sendUserMessage).toHaveBeenCalledWith("Review body");
    expect(subject.setEditorText).not.toHaveBeenCalled();
    expect(subject.notify).toHaveBeenCalledWith(
      "Review sent — 2 comments",
      "info",
    );
  });

  it("confirms a single comment in the singular", () => {
    const subject = deps();

    deliverReview("Review body", 1, subject.deps);

    expect(subject.notify).toHaveBeenCalledWith(
      "Review sent — 1 comment",
      "info",
    );
  });

  it("falls back to the prompt when the host cannot send", () => {
    const subject = deps({ sendUserMessage: undefined });

    const outcome = deliverReview("Review body", 3, subject.deps);

    expect(outcome).toBe("prefilled");
    expect(subject.setEditorText).toHaveBeenCalledWith("Review body");
    expect(subject.notify).toHaveBeenCalledWith(
      "Review copied to the prompt — press Enter to send (3 comments)",
      "info",
    );
  });

  it("a failed send still leaves the review in the prompt and says why", () => {
    const subject = deps();
    subject.sendUserMessage.mockImplementation(() => {
      throw new Error("Extension is stale\ninternal detail");
    });

    const outcome = deliverReview("Review body", 2, subject.deps);

    expect(outcome).toBe("prefilled");
    expect(subject.setEditorText).toHaveBeenCalledWith("Review body");
    expect(subject.notify).toHaveBeenCalledWith(
      "Could not send the review (Extension is stale) — copied to the prompt, " +
        "press Enter to send (2 comments)",
      "warning",
    );
  });

  it("never delivers without notifying", () => {
    for (const sink of [vi.fn(), undefined]) {
      for (const count of [1, 2]) {
        const subject = deps({ sendUserMessage: sink });
        deliverReview("Review body", count, subject.deps);
        expect(subject.notify).toHaveBeenCalledOnce();
        expect(subject.notify.mock.calls[0]?.[0]).toContain(
          describeCommentCount(count),
        );
      }
    }
  });

  it("a non-Error throw is still reported with a readable reason", () => {
    const subject = deps();
    subject.sendUserMessage.mockImplementation(() => {
      throw "nope";
    });

    deliverReview("Review body", 1, subject.deps);

    expect(subject.notify.mock.calls[0]?.[0]).toContain("(nope)");
    expect(subject.notify.mock.calls[0]?.[1]).toBe("warning");
  });
});

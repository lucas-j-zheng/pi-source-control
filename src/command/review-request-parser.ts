import type { ReviewRequest } from "../model/diff.ts";

const USAGE = [
  "Usage: /diff",
  "       /diff working",
  "       /diff staged",
  "       /diff commit <revision>",
  "       /diff range <base>..<head>",
  "       /diff range <base>...<head>",
].join("\n");

const INVALID_REVISION_HELP =
  "Use /diff commit <revision> or /diff range <base>...<head>.";

export class ReviewRequestError extends Error {
  constructor(
    message: string,
    public readonly input: string,
  ) {
    super(message);
    this.name = "ReviewRequestError";
  }
}

export function isSafeRevision(token: string): boolean {
  return (
    token.length > 0 &&
    !token.startsWith("-") &&
    !token.includes("..") &&
    !/[\s\p{Cc}]/u.test(token)
  );
}

export function parseReviewRequest(args: string): ReviewRequest {
  const input = args.trim();
  if (input.length === 0) {
    return { kind: "workspace", initialSource: "working" };
  }

  const tokens = input.split(/\s+/);
  const command = tokens[0];

  if (command === "working" || command === "staged") {
    if (tokens.length !== 1) {
      throw usageError(input);
    }

    return { kind: "workspace", initialSource: command };
  }

  if (command === "commit") {
    if (tokens.length !== 2) {
      throw usageError(input);
    }

    const revision = tokens[1]!;
    if (!isSafeRevision(revision)) {
      throw revisionError(revision, input);
    }

    return { kind: "commit", revision };
  }

  if (command === "range") {
    if (tokens.length !== 2) {
      throw usageError(input);
    }

    const expression = tokens[1]!;
    const tripleDotIndex = expression.indexOf("...");
    const separatorIndex =
      tripleDotIndex >= 0 ? tripleDotIndex : expression.indexOf("..");

    if (separatorIndex < 0) {
      throw usageError(input);
    }

    const mode = tripleDotIndex >= 0 ? "three-dot" : "two-dot";
    const separatorLength = mode === "three-dot" ? 3 : 2;
    const left = expression.slice(0, separatorIndex);
    const right = expression.slice(separatorIndex + separatorLength);

    if (left.length === 0 || right.length === 0) {
      throw revisionError(expression, input);
    }
    if (!isSafeRevision(left)) {
      throw revisionError(left, input);
    }
    if (!isSafeRevision(right)) {
      throw revisionError(right, input);
    }

    return { kind: "range", left, right, mode };
  }

  throw usageError(input);
}

function usageError(input: string): ReviewRequestError {
  return new ReviewRequestError(USAGE, input);
}

function revisionError(token: string, input: string): ReviewRequestError {
  return new ReviewRequestError(
    `Could not resolve revision: ${token}\n${INVALID_REVISION_HELP}`,
    input,
  );
}

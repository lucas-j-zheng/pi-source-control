import { describe, expect, it } from "vitest";

import {
  isSafeRevision,
  parseReviewRequest,
  ReviewRequestError,
} from "../../src/command/review-request-parser.ts";

describe("parseReviewRequest", () => {
  it("empty input maps to workspace mode", () => {
    const expected = { kind: "workspace", initialSource: "working" };

    expect(parseReviewRequest("")).toEqual(expected);
    expect(parseReviewRequest("   ")).toEqual(expected);
  });

  it("working maps to workspace mode", () => {
    expect(parseReviewRequest("working")).toEqual({
      kind: "workspace",
      initialSource: "working",
    });
  });

  it("staged maps to workspace mode with staged initial source", () => {
    expect(parseReviewRequest("staged")).toEqual({
      kind: "workspace",
      initialSource: "staged",
    });
  });

  it("commit HEAD maps to one commit request", () => {
    expect(parseReviewRequest("commit HEAD")).toEqual({
      kind: "commit",
      revision: "HEAD",
    });
  });

  it("range main..feature maps to two-dot mode", () => {
    expect(parseReviewRequest("range main..feature")).toEqual({
      kind: "range",
      left: "main",
      right: "feature",
      mode: "two-dot",
    });
  });

  it("range main...feature maps to three-dot mode", () => {
    expect(parseReviewRequest("range main...feature")).toEqual({
      kind: "range",
      left: "main",
      right: "feature",
      mode: "three-dot",
    });
  });

  it("range with three-dot containing dots in names splits on the first triple dot", () => {
    expect(parseReviewRequest("range v1.2..v1.3")).toEqual({
      kind: "range",
      left: "v1.2",
      right: "v1.3",
      mode: "two-dot",
    });
  });

  it("empty range endpoints are rejected", () => {
    for (const input of ["range ..b", "range a..", "range a..."]) {
      expect(() => parseReviewRequest(input)).toThrowError(ReviewRequestError);
      expect(() => parseReviewRequest(input)).toThrowError(/^Could not resolve revision/);
    }
  });

  it("extra arguments are rejected", () => {
    for (const input of ["working now", "commit a b", "staged x"]) {
      expect(() => parseReviewRequest(input)).toThrowError(ReviewRequestError);
      expect(() => parseReviewRequest(input)).toThrowError(/^Usage: \/diff/);
    }
  });

  it("unknown subcommand is rejected", () => {
    expect(() => parseReviewRequest("foo")).toThrowError(ReviewRequestError);
    expect(() => parseReviewRequest("foo")).toThrowError(/^Usage: \/diff/);
  });

  it("strings beginning with - are never interpreted as git options", () => {
    for (const input of [
      "commit --help",
      "commit -n",
      "range -a..b",
      "range a..--x",
    ]) {
      expect(() => parseReviewRequest(input)).toThrowError(ReviewRequestError);
      expect(() => parseReviewRequest(input)).toThrowError(/^Could not resolve revision/);
    }
  });

  it("isSafeRevision rejects whitespace, control chars, leading dash and empty", () => {
    for (const token of ["", "two words", "tab\tname", "line\nname", "nul\0name", "-n"]) {
      expect(isSafeRevision(token)).toBe(false);
    }

    for (const token of ["HEAD~2", "v1.0", "abc123", "origin/main", "HEAD^{commit}"]) {
      expect(isSafeRevision(token)).toBe(true);
    }
  });
});

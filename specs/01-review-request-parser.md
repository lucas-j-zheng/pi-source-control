# 01 — Review request parser

## Goal
Parse the text after `/diff` into a typed `ReviewRequest` before any git command runs. It exists so user input can never reach git as a flag or shell fragment.

## Depends on
none (uses `ReviewRequest` from `src/model/diff.ts`; read `specs/00-architecture.md`).

## Files
- create `src/command/review-request-parser.ts`
- create `test/unit/review-request-parser.test.ts`

## Interfaces
```ts
export class ReviewRequestError extends Error {
  constructor(message: string, public readonly input: string);
}
export function parseReviewRequest(args: string): ReviewRequest; // throws ReviewRequestError
export function isSafeRevision(token: string): boolean;
```

## Behavior
- Input is split on whitespace after trimming; empty input → `{ kind: "workspace", initialSource: "working" }`.
- `working` → workspace/working; `staged` → workspace/staged.
- `commit <rev>` → `{ kind: "commit", revision }`.
- `range <l>..<r>` → two-dot; `range <l>...<r>` → three-dot. Split on the first `...` if present, else the first `..`.
- Any other first token, wrong token count (e.g. `commit` alone, `commit a b`, `range`, `working extra`) → `ReviewRequestError` whose message starts with `Usage: /diff` and lists the accepted forms.
- A revision/endpoint is accepted only if `isSafeRevision` is true: non-empty, does not start with `-`, contains no whitespace, no control chars, and none of `..` (for `commit`) — for range endpoints the endpoint itself must not contain `..` either. Otherwise error `Could not resolve revision: <token>` followed by a newline and `Use /diff commit <revision> or /diff range <base>...<head>.`
- Empty endpoint (`range ..b`, `range a..`, `range a...`) → same `Could not resolve revision` error with the full expression.
- Tokens are case-sensitive; `Commit HEAD` is a usage error.
- Never mutate or normalize the revision text beyond trimming the whole input.

## Tests
`test/unit/review-request-parser.test.ts`
- "empty input maps to workspace mode" → `parseReviewRequest("")` and `("   ")` equal `{kind:"workspace", initialSource:"working"}`
- "working maps to workspace mode"
- "staged maps to workspace mode with staged initial source"
- "commit HEAD maps to one commit request" → `{kind:"commit", revision:"HEAD"}`
- "range main..feature maps to two-dot mode" → `{kind:"range", left:"main", right:"feature", mode:"two-dot"}`
- "range main...feature maps to three-dot mode"
- "range with three-dot containing dots in names splits on the first triple dot" → `range v1.2..v1.3` → two-dot left `v1.2` right `v1.3`
- "empty range endpoints are rejected" → `range ..b`, `range a..`, `range a...` throw ReviewRequestError with message starting `Could not resolve revision`
- "extra arguments are rejected" → `working now`, `commit a b`, `staged x` throw with message starting `Usage: /diff`
- "unknown subcommand is rejected" → `foo` throws `Usage: /diff`
- "strings beginning with - are never interpreted as git options" → `commit --help`, `commit -n`, `range -a..b`, `range a..--x` throw `Could not resolve revision`
- "isSafeRevision rejects whitespace, control chars, leading dash and empty" and accepts `HEAD~2`, `v1.0`, `abc123`, `origin/main`, `HEAD^{commit}`

## Out of scope
- Resolving revisions with git (spec 04).
- Any UI or notify calls.

## Done when
`pnpm check` exits 0 with 12 new tests passing.

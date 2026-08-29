# 23 — Orchestration plan in the review message

## Goal
Group queued comments into independent work units and state, in the submitted message, which units may be worked in parallel and which must not. Parallelism is a correctness question — two workers editing one file clobber each other — so the grouping is computed mechanically here rather than left to the model's judgment.

## Depends on
- 20-inline-review-comments (`ReviewComment`, `buildReviewMessage` in `src/model/review-comment.ts`)

## Files
- create `src/model/review-plan.ts`
- modify `src/model/review-comment.ts` (`buildReviewMessage` renders the plan)
- modify `test/unit/review-comment.test.ts`; create `test/unit/review-plan.test.ts`

## Interfaces
```ts
// review-plan.ts
export interface WorkUnit {
  index: number;          // 1-based, stable
  filePaths: string[];    // always exactly one path in this version
  commentIds: string[];   // in the order they appear in the message
}
export interface ReviewPlan {
  units: WorkUnit[];
  parallelSafe: boolean;  // true when there is more than one unit
}
export function buildReviewPlan(comments: ReviewComment[]): ReviewPlan;
export function renderPlan(plan: ReviewPlan): string;  // "" when plan.units.length < 2
```

## Behavior
- `buildReviewPlan` groups comments by `filePath`. **Every comment on a file lands in exactly one unit** — a file is never split across units, because concurrent edits to one file conflict. Units are ordered by file path; `commentIds` keep the message's ordering.
- `parallelSafe` is `true` only when there are 2 or more units. A single unit means there is nothing to parallelize and `renderPlan` returns `""`, so short reviews stay uncluttered.
- `renderPlan` output, appended by `buildReviewMessage` after the numbered comments:
  ```

  Suggested plan — <n> independent units, one per file:

    Unit 1: <path>  (comments 1, 3)
    Unit 2: <path>  (comment 2)

  Units touch disjoint files and may be worked in parallel, one worker per unit.
  Do not split a unit across workers: comments in a unit edit the same file.
  Merge units into one worker if the changes turn out to be coupled — for example a
  rename whose call sites live in another unit's file.
  ```
- The wording is capability-neutral: it never names a specific subagent or task tool, because Pi has no built-in one (its `subagent` tool ships only as an optional example extension). The agent applies the plan with whatever parallel execution it has, or works the units in order when it has none.
- `buildReviewMessage`'s existing header, numbering, ordering and per-comment format from spec 20 are unchanged; the plan is purely appended.
- Comment numbering referenced in the plan matches the numbers in the message body exactly.

## Tests
`test/unit/review-plan.test.ts`
- "comments on one file form a single unit"
- "comments on different files form one unit per file ordered by path"
- "every comment appears in exactly one unit"
- "parallelSafe is false for a single unit and true for two or more"
- "renderPlan is empty for a single unit"
- "renderPlan lists units with the comment numbers from the message body"
`test/unit/review-comment.test.ts`
- "buildReviewMessage appends the plan when comments span multiple files"
- "buildReviewMessage omits the plan for a single-file review"

## Out of scope
- Spawning agents from the extension (it cannot; it only composes text), splitting a file's comments across workers, dependency ordering between units, grouping by semantic similarity rather than by file.

## Done when
`pnpm check` exits 0 with 8 new tests passing and all existing tests passing.

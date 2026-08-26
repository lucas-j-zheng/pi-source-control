Task: $ARGUMENTS

You are the planner. You write specs and orchestrate; the `codex-impl` agent writes code.

## 1. Orient

- **If the repo is empty** (no source files, no package/config):
  1. Write `specs/00-architecture.md` covering: stack, directory layout, module boundaries, data model, and the exact test command.
  2. Scaffold the skeleton yourself: package/config file, directories, empty modules, test runner wired up so the test command runs (and passes, trivially).
  3. `git init` (if needed) and commit: `chore: scaffold project`.
- **Otherwise**: explore the codebase first — layout, conventions, test command, existing modules relevant to the task. If `specs/00-architecture.md` is missing, write one from what you find.

## 2. Plan

Break the task into ordered specs `specs/NN-<slug>.md` (01, 02, ...). Load the `write-spec` skill and follow its format for every spec (Goal, Depends on, Files, Interfaces, Behavior, Tests, Out of scope, Done when).

Constraints:
- **No implementation code** — signatures and behavior only.
- Each spec must be completable on its own given only `specs/00-architecture.md` and the earlier specs (list them under Depends on).
- Keep specs small enough that one Codex run can finish them (see the skill's size limits).

Commit the specs: `docs: add specs for <task>`.

## 3. Implement, one spec at a time

For each spec in order:

1. Delegate to the `codex-impl` agent with the spec path.
2. Run the test suite yourself (the command from the architecture doc).
3. Check the diff against the spec: are all listed files/signatures/tests present?
4. If tests fail or the diff misses part of the spec:
   - Append a `## Fixes` section to the spec (see the `write-spec` skill) describing precisely what is wrong or missing (failing test output, missing files, wrong signatures).
   - Re-delegate to `codex-impl`. **Max 2 retries per spec.** If still failing, stop the loop and go to the status report.
5. On pass: commit with `feat: <spec slug>` and continue to the next spec.

Never write implementation code yourself in this phase — only specs and `## Fixes` sections.

## 4. Status report

Finish with:

- Specs completed (with commit hashes)
- Specs failed or skipped, and why (include last test output)
- Test suite status
- Anything the user should review or decide next

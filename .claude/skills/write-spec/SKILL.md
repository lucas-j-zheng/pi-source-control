---
name: write-spec
description: How to write an implementation spec for Codex. Use whenever creating or editing a specs/NN-*.md file (including adding a Fixes section).
---
A spec is a contract for an agent with no other context. It must be implementable alone.

Required sections:
1. Goal — one sentence of what, one sentence of why (the why resolves ambiguities).
2. Depends on — earlier specs this relies on, with the symbols used, e.g. `01-parser (parseLine from src/parser.ts)`. Write `none` if none.
3. Files — exact paths to create/modify. Nothing else may be modified except test files and exports needed to expose the interfaces listed.
4. Interfaces — function/class signatures with types. Codex implements bodies only.
5. Behavior — bullet rules. Include edge cases and error handling.
6. Tests — concrete cases: input → expected output, with the test file path. Codex writes these tests before implementing; each case must appear verbatim as a test name or assertion.
7. Out of scope — what NOT to do.
8. Done when — the exact test command from specs/00-architecture.md and the expected result, e.g. `pnpm test` passes with N new tests.

Optional:
- `## Fixes` — appended by the build loop after a failed attempt. It overrides everything above it; address it first.

Rules:
- No implementation code beyond signatures.
- Under 150 lines and ≤ ~6 files. If larger, split into two specs.
- Reference specs/00-architecture.md instead of repeating it.
- Every bullet in Behavior must map to at least one test.

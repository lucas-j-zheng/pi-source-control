# 15 — Package and document

## Goal
Make the package installable and understandable by a second user without reading source. Documentation must accurately describe read-only MVP behavior and known limits.

## Depends on
- 14-pi-extension-adapter (command forms and behaviors to document)

## Files
- create `README.md`
- create `LICENSE` (MIT, copyright holder "Lucas Zheng")
- modify `package.json` (only: `license: "MIT"`, `files`, `engines.node: ">=22"`, `repository` placeholder allowed)
- create `test/unit/package-manifest.test.ts`

## Interfaces
none (documentation).

## Behavior
- README sections, in order: title + one-paragraph description; **Install** (`pi install /absolute/path/to/pi-source-control` and `pi -e ./src/extension.ts` for trying it; `pnpm install` for development); **Usage** with the exact command forms from `docs/plan.md` §4; **Keyboard reference** table identical to plan §4 keybindings; **Layouts** (wide ≥130, medium 90–129, narrow <90, unified default, `v` opt-in); **Supported Git states** (list of statuses incl. untracked/unmerged placeholders, binary/oversized placeholders, merge commit parent-1 note, three-dot multiple-merge-base limitation); **Safety** (read-only command list, no shell, resolved OIDs, no network/model calls, no state written to repo); **Limitations / not in MVP** (from plan §3 excluded list, plus "no mouse support: Pi exposes no pointer contract"); **Development** (`pnpm check`, test layout); **License**.
- `package.json.files` includes `src`, `README.md`, `LICENSE`; no runtime `dependencies` key with entries.

## Tests
`test/unit/package-manifest.test.ts`
- "package manifest declares the extension entry and pi-package keyword"
- "package has no runtime dependencies"
- "README documents every command form and keybinding" (reads README, asserts each of the 7 `/diff` forms and each key from the keybinding list appears)

## Out of scope
- Publishing to npm, screenshots/recordings (leave a TODO line in README).

## Done when
`pnpm check` exits 0 with 3 new tests passing.

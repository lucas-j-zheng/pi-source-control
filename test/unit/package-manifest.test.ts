import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, string>;
  keywords?: string[];
  peerDependencies?: Record<string, string>;
  pi?: { extensions?: string[] };
}

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(`${projectRoot}/package.json`, "utf8"),
) as PackageManifest;
const readme = readFileSync(`${projectRoot}/README.md`, "utf8");
const inputController = readFileSync(
  `${projectRoot}/src/ui/input-controller.ts`,
  "utf8",
);

/** Every key id the input controller actually answers to. */
function boundKeyIds(): Set<string> {
  const ids = new Set<string>();
  for (const match of inputController.matchAll(/matchesKey\(data, "([^"]+)"\)/g)) {
    const id = match[1];
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/** Translate a README key cell such as `Shift+↑` into pi-tui's key id. */
function keyIdForDocumentedKey(documented: string): string {
  const named: Record<string, string> = {
    "↑": "up",
    "↓": "down",
    "←": "left",
    "→": "right",
    Tab: "tab",
    Enter: "enter",
    Esc: "escape",
    Backspace: "backspace",
    Space: "space",
    Home: "home",
    End: "end",
    PageUp: "pageUp",
    PageDown: "pageDown",
  };

  const modifier = /^(Ctrl|Shift)\+(.+)$/.exec(documented);
  if (modifier !== null) {
    const [, prefix = "", rest = ""] = modifier;
    // The modifier is already explicit, so `Ctrl+D` is `ctrl+d`, not `ctrl+shift+d`.
    const base = /^[A-Za-z]$/.test(rest)
      ? rest.toLowerCase()
      : keyIdForDocumentedKey(rest);
    return `${prefix.toLowerCase()}+${base}`;
  }
  const mapped = named[documented];
  if (mapped !== undefined) return mapped;
  // A bare uppercase letter in the table means the shifted key.
  if (/^[A-Z]$/.test(documented)) return `shift+${documented.toLowerCase()}`;
  return documented;
}

/** Key ids the README's keyboard table claims to support. */
function documentedKeyIds(): Set<string> {
  const table = readme.slice(readme.indexOf("## Keyboard reference"));
  const ids = new Set<string>();
  for (const line of table.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cell = line.split("|")[1]?.trim() ?? "";
    for (const key of cell.split("/")) {
      const bare = key.trim().replace(/`/g, "");
      if (bare.length === 0) continue;
      ids.add(keyIdForDocumentedKey(bare));
    }
  }
  return ids;
}

describe("package and documentation", () => {
  it("package manifest declares the extension entry and pi-package keyword", () => {
    expect(manifest.pi?.extensions).toContain("./src/extension.ts");
    expect(manifest.keywords).toContain("pi-package");
  });

  it("package has no runtime dependencies", () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it("the manifest declares an exports map and pinned peer ranges", () => {
    // Pi loads the extension by filesystem path (package.json `pi.extensions`
    // resolved against the install directory), so the exports map never gates
    // loading; it only stops strangers deep-importing internals as de-facto API.
    expect(manifest.exports).toEqual({ ".": "./src/extension.ts" });
    expect(manifest.exports?.["."]).toBe(manifest.pi?.extensions?.[0]);
    expect(manifest.peerDependencies).toEqual({
      "@earendil-works/pi-coding-agent": "^0.84.1",
      "@earendil-works/pi-tui": "^0.84.1",
    });
  });

  it("the README documents the npm install command and the published package name", () => {
    expect(manifest.name).toBe("@lucas-j-zheng/pi-source-control");
    expect(readme).toContain(`pi install npm:${manifest.name}`);
    expect(readme).toContain(`pi install npm:${manifest.name}@`);
    expect(readme).toContain("pi install /absolute/path/to/pi-source-control");
  });

  it("the README does not claim the extension makes no model calls", () => {
    expect(readme).not.toContain("no network or model calls");
    expect(readme).not.toMatch(/makes no (network|model)/);
    // The truth it must state instead: Shift+S reaches the user's model.
    expect(readme).toMatch(/Shift\+S.+sends your review to your agent/);
    expect(readme).toContain("model provider");
  });

  it("every keybinding in the README maps to a real binding, and every binding is documented", () => {
    const bound = boundKeyIds();
    const documented = documentedKeyIds();

    expect(bound.size).toBeGreaterThan(20);
    expect([...documented].filter((id) => !bound.has(id))).toEqual([]);
    expect([...bound].filter((id) => !documented.has(id))).toEqual([]);
  });

  it("README documents every command form and keybinding", () => {
    const commands = [
      "/diff",
      "/diff working",
      "/diff staged",
      "/diff commit HEAD",
      "/diff commit <revision>",
      "/diff range <base>..<head>",
      "/diff range <base>...<head>",
    ];
    const keybindings = [
      "`↑` / `↓`",
      "`j` / `k`",
      "`Tab`",
      "`Shift+Tab`",
      "`Enter`",
      "`Esc`",
      "`q`",
      "`n` / `p`",
      "`PageDown` / `PageUp`",
      "`Home` / `End`",
      "`←` / `→`",
      "`v`",
      "`Space`",
      "`g`",
      "`?`",
    ];

    for (const command of commands) expect(readme).toContain(command);
    for (const keybinding of keybindings) expect(readme).toContain(keybinding);
  });
});

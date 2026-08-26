import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  dependencies?: Record<string, string>;
  keywords?: string[];
  pi?: { extensions?: string[] };
}

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(`${projectRoot}/package.json`, "utf8"),
) as PackageManifest;
const readme = readFileSync(`${projectRoot}/README.md`, "utf8");

describe("package and documentation", () => {
  it("package manifest declares the extension entry and pi-package keyword", () => {
    expect(manifest.pi?.extensions).toContain("./src/extension.ts");
    expect(manifest.keywords).toContain("pi-package");
  });

  it("package has no runtime dependencies", () => {
    expect(manifest.dependencies ?? {}).toEqual({});
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

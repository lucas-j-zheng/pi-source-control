import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  pathKey,
  sanitizeContent,
  sanitizeLabel,
} from "../../src/diff/sanitize.ts";
import { parseUnifiedDiff } from "../../src/diff/unified-parser.ts";
import { renderFileList } from "../../src/ui/file-list-renderer.ts";
import { renderSideBySide } from "../../src/ui/side-by-side-renderer.ts";
import { renderUnifiedDiff } from "../../src/ui/unified-renderer.ts";
import { plainStyler, type Styler } from "../../src/ui/theme.ts";

const ESC = "\u001b";
const BEL = "\u0007";
const ST = `${ESC}\\`;
const REPLACEMENT = "\ufffd";

describe("sanitizeContent", () => {
  it("OSC 52 clipboard sequences are removed", () => {
    expect(sanitizeContent(`${ESC}]52;c;cGF5bG9hZA==${BEL}`)).toBe("");
    expect(sanitizeContent(`${ESC}]52;c;cGF5bG9hZA==${ST}`)).toBe("");
    expect(sanitizeContent(`${ESC}]0;pwned${BEL}`)).toBe("");
    // Unterminated: a terminal would swallow the rest of the row, so do we.
    expect(sanitizeContent(`before${ESC}]52;c;cGF5bG9hZA==`)).toBe("before");
    expect(sanitizeContent(`a${ESC}]52;c;x${BEL}b`)).toBe("ab");
  });

  it("a bare CR cannot rewrite the line", () => {
    const sanitized = sanitizeContent("evil();\r// harmless");

    expect(sanitized).toBe(`evil();${REPLACEMENT}// harmless`);
    expect(sanitized).toContain("evil();");
    expect(sanitized).toContain("// harmless");
    expect(sanitized).not.toContain("\r");
  });

  it("CSI, APC and DCS sequences are removed", () => {
    expect(sanitizeContent(`${ESC}[31mred${ESC}[0m`)).toBe("red");
    expect(sanitizeContent(`${ESC}[2J${ESC}[HH`)).toBe("H");
    expect(sanitizeContent(`${ESC}[?1049h`)).toBe("");
    expect(sanitizeContent(`a${ESC}_payload${ST}b`)).toBe("ab");
    expect(sanitizeContent(`a${ESC}Pq;payload${ST}b`)).toBe("ab");
    expect(sanitizeContent(`a${ESC}^privacy${ST}b`)).toBe("ab");
    expect(sanitizeContent(`a${ESC}X${ST}b`)).toBe("ab");
    // Non-CSI escapes: charset select, save cursor, and a lone trailing ESC.
    expect(sanitizeContent(`a${ESC}(0b`)).toBe("ab");
    expect(sanitizeContent(`a${ESC}7b`)).toBe("ab");
    expect(sanitizeContent(`ab${ESC}`)).toBe("ab");
    // C1 introducers are live in a UTF-8 terminal, so they are neutralised too.
    expect(sanitizeContent("\u009b31m")).toBe(`${REPLACEMENT}31m`);
    // Whatever the shape, no escape byte survives.
    expect(sanitizeContent(`${ESC}[31m${ESC}]52;c;x${BEL}${ESC}_a${ST}`))
      .not.toContain(ESC);
  });

  it("ordinary text, tabs, emoji and CJK are untouched", () => {
    const samples = [
      "const token = issueToken(userId);",
      "\tif (x) {\n\t\treturn 1;\n\t}",
      "// 変更点: 日本語のコメント 漢字",
      "emoji: 🙂🚀👩‍💻 and accents: café naïve",
      "punctuation \\ / \" ' ` $ % ^ & * ( ) [ ] { } < > ~ | ?",
      "",
    ];

    for (const sample of samples) {
      expect(sanitizeContent(sample)).toBe(sample);
    }
    // The label form only differs on line breaks.
    expect(sanitizeLabel("src/api/セッション.ts")).toBe("src/api/セッション.ts");
    expect(sanitizeLabel("a\tb")).toBe("a\tb");
  });

  it("sanitizeLabel collapses newlines", () => {
    expect(sanitizeLabel("first\nsecond")).toBe(`first${REPLACEMENT}second`);
    expect(sanitizeLabel("first\r\nsecond")).toBe(
      `first${REPLACEMENT}${REPLACEMENT}second`,
    );
    expect(sanitizeLabel("a\nb")).not.toContain("\n");
    // Content keeps `\n` (it may still be split into rows); a label may not.
    expect(sanitizeContent("first\nsecond")).toBe("first\nsecond");
  });
});

describe("pathKey", () => {
  it("distinguishes byte sequences that share a display string", () => {
    expect(pathKey([0x61, 0xe8, 0x62])).toBe("61e862");
    expect(pathKey([0x61, 0xe8, 0x62])).not.toBe(pathKey([0x61, 0xe9, 0x62]));
    expect(pathKey([])).toBe("");
  });
});

const HOSTILE_PATCH = [
  "diff --git a/src/evil.ts b/src/evil.ts",
  "--- a/src/evil.ts",
  "+++ b/src/evil.ts",
  `@@ -1,3 +1,5 @@ ${ESC}]0;pwned${BEL}`,
  " const safe = 1;",
  "-const removed = 2;",
  "+evil();\r// harmless",
  `+const clip = "${ESC}]52;c;cGF5bG9hZA==${BEL}";`,
  `+const color = "${ESC}[31mred${ESC}[0m";`,
  "+\tconst tabbed = 漢字 + '🙂';",
  "",
].join("\n");

const WIDTHS = [50, 60, 89, 90, 110, 129, 130, 160, 220];

function ansiStyler(): Styler {
  return {
    fg: (_role, text) => `${ESC}[31m${text}${ESC}[39m`,
    bg: (_role, text) => `${ESC}[41m${text}${ESC}[49m`,
    bold: (text) => `${ESC}[1m${text}${ESC}[22m`,
  };
}

function renderAll(width: number, styler: Styler): string[] {
  const [file] = parseUnifiedDiff(HOSTILE_PATCH, { group: "working" });
  if (file === undefined) throw new Error("expected a parsed file");

  return [
    ...renderUnifiedDiff(
      { file, verticalOffset: 0, horizontalOffset: 0, height: 20 },
      width,
      styler,
    ),
    ...renderSideBySide(
      { file, verticalOffset: 0, horizontalOffset: 0, height: 20 },
      width,
      styler,
    ),
    ...renderFileList(
      {
        files: [file],
        selectedId: file.id,
        reviewed: new Set<string>(),
        focused: true,
        scrollOffset: 0,
        maxRows: 10,
        title: "FILES CHANGED",
      },
      width,
      styler,
    ).lines,
  ];
}

describe("hostile diff content reaching the terminal", () => {
  it("a hunk header carrying control bytes still parses into a hunk", () => {
    const hostileHeader = [
      "diff --git a/src/header.ts b/src/header.ts",
      "--- a/src/header.ts",
      "+++ b/src/header.ts",
      `@@ -1,1 +1,1 @@ function A${ESC}]52;c;cGF5bG9hZA==${BEL}B${ESC}]0;pwned${BEL}C${ESC}[31mD\rE\u009b31mF() {`,
      "-  return 1;",
      "+  return 2;",
      "",
    ].join("\n");

    const [file] = parseUnifiedDiff(hostileHeader, { group: "working" });

    expect(file?.hunks).toHaveLength(1);
    expect(file?.hunks[0]).toMatchObject({
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
      header: `@@ -1,1 +1,1 @@ function ABCD${REPLACEMENT}E${REPLACEMENT}31mF() {`,
    });
    expect(file?.hunks[0]?.lines).toHaveLength(2);
    const rendered = renderUnifiedDiff(
      { file: file!, verticalOffset: 0, horizontalOffset: 0, height: 10 },
      160,
      plainStyler,
    ).join("\n");
    expect(rendered).toContain(
      `function ABCD${REPLACEMENT}E${REPLACEMENT}31mF() {`,
    );
    for (const output of [JSON.stringify(file?.hunks[0]), rendered]) {
      expect(output).not.toContain(ESC);
      expect(output).not.toContain(BEL);
      expect(output).not.toContain("\r");
      expect(output).not.toContain("\u009b");
    }
  });

  it("renders with no escape byte in any row", () => {
    const [file] = parseUnifiedDiff(HOSTILE_PATCH, { group: "working" });

    // The model itself is clean, because sanitizing happens at the parse
    // boundary rather than in each renderer.
    const modelText = JSON.stringify(file);
    expect(modelText).not.toContain(ESC);
    expect(modelText).not.toContain(BEL);
    expect(file?.hunks[0]?.header).not.toContain(ESC);
    expect(file?.hunks[0]?.lines[2]?.content).toBe(
      `evil();${REPLACEMENT}// harmless`,
    );

    for (const width of WIDTHS) {
      for (const row of renderAll(width, plainStyler)) {
        expect(row).not.toContain(ESC);
        expect(row).not.toContain(BEL);
        expect(row).not.toContain("\r");
        expect(visibleWidth(row)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("keeps the extension's own styling and its width accounting", () => {
    const styler = ansiStyler();

    for (const width of WIDTHS) {
      const rows = renderAll(width, styler);
      // The renderers wrap clean text in Styler escapes *after* parsing, so
      // those escapes must survive untouched.
      expect(rows.some((row) => row.includes(`${ESC}[31m`))).toBe(true);

      for (const row of rows) {
        // Every escape in the output is one the Styler put there.
        const withoutStyling = row.replaceAll(
          /\u001b\[(?:31|39|41|49|1|22)m/g,
          "",
        );
        expect(withoutStyling).not.toContain(ESC);
        expect(withoutStyling).not.toContain(BEL);
        expect(visibleWidth(row)).toBeLessThanOrEqual(width);
      }
    }
  });
});
